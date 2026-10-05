import {NextResponse} from 'next/server';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {dbUser} from '@/lib/db/user';
import {ownedReportRoute} from '@/lib/owned-ads/store';
import {readOwnedImportRequest} from '@/lib/owned-ads/import';
import {ownedMediaCache as cache,ownedMediaKey as key,type OwnedMedia as Media} from '@/lib/owned-ads/media-cache';
import {metaReadConfigured,resolveWithToken} from '@/lib/owned-ads/meta-media';

export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request:Request){
  return ownedReportRoute(async()=>{
    if(Number(request.headers.get('content-length'))>10000)return NextResponse.json({error:'Invalid request'},{status:400});
    const input=await readOwnedImportRequest(request) as {items?:Media[];video?:boolean}|null;
    if(!input||!Array.isArray(input.items)||input.items.length>24||input.items.some((x:Media)=>!x||typeof x.ad_id!=='string'||typeof x.account_id!=='string'||!/^\d{1,32}$/.test(x.ad_id)||! /^(act_)?\d+$/.test(x.account_id)))return NextResponse.json({error:'Invalid ads'},{status:400});
    if(input.video!==undefined&&(typeof input.video!=='boolean'||input.video&&input.items.length!==1))return NextResponse.json({error:'Invalid video request'},{status:400});
    const cacheKey=(row:Media|{account_id:string;ad_id:string})=>key(row)+(input.video?':video':'');
    const requested=input.items;
    const db=await dbUser();
    const snapshot=await db.from('owned_library_syncs').select('id').eq('status','completed').order('finished_at',{ascending:false}).limit(1).single();
    if(snapshot.error)return NextResponse.json({error:'Library unavailable'},{status:503});
    const rows=await db.from('owned_library_ads').select('account_id,ad_id,creative_id:data->>creative_id,video_id:data->>video_id').eq('sync_id',snapshot.data.id).in('ad_id',requested.map((x:Media)=>x.ad_id));
    if(rows.error)return NextResponse.json({error:'Library unavailable'},{status:503});
    const items=(rows.data??[]).filter(row=>requested.some((x:Media)=>x.account_id===row.account_id&&x.ad_id===row.ad_id));
    const missing=items.filter(x=>(cache.get(cacheKey(x))?.until??0)<Date.now());
    if(missing.length){
      try{
        // Hosted: our own read token. Local without one: the Ads Management bridge.
        const resolved:Media[]=metaReadConfigured()?await resolveWithToken(missing,Boolean(input.video))
          :JSON.parse((await promisify(execFile)(process.execPath,['--experimental-strip-types',resolve('scripts/resolve-owned-media.mjs'),JSON.stringify(missing.map(({account_id,ad_id})=>({account_id,ad_id}))),...(input.video?['video']:[])],{env:process.env,windowsHide:true,timeout:110000,maxBuffer:1024*1024})).stdout);
        if(cache.size>1000)cache.clear();
        for(const media of resolved)cache.set(cacheKey(media),{until:Date.now()+(input.video?(media.video_url||media.video_preview_url?5*60000:60000):media.url?30*60000:60000),media});
      }catch(error){console.error('Owned media worker failed',(error as {stderr?:string}).stderr?.split('\n').filter(line=>line.startsWith('Owned media resolution unavailable')).join(''));return NextResponse.json({error:input.video?'ยังโหลดวิดีโอจากต้นทางไม่ได้':'โหลดภาพต้นฉบับไม่ได้ ใช้ภาพย่อสำรอง'},{status:503});}
    }
    return NextResponse.json({items:items.map(x=>cache.get(cacheKey(x))?.media).filter(Boolean)});
  });
}
