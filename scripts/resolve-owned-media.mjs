import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';

// Local bridge, like the inventory worker. Never write to Management or expose its token.
let stage='input';
try {
  const items=JSON.parse(process.argv[2]);
  const includeVideo=process.argv[3]==='video';
  if(!Array.isArray(items)||items.length>24||items.some(x=>!/^\d{1,32}$/.test(x.ad_id)||! /^(act_)?\d+$/.test(x.account_id)))throw new Error('Invalid ads');
  stage='source_config';const sourcePath=process.env.OWNED_MANAGEMENT_PROJECT_PATH;
  const env=parseEnv(await readFile(resolve(sourcePath,'.env.local'),'utf8'));
  const db=createClient(env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const member=await db.from('workspace_members').select('role,status').eq('normalized_email',process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL).single();
  if(member.error||member.data?.role!=='admin'||member.data?.status!=='active')throw new Error('Source authorization required');
  const config=await db.from('workspace_config').select('primary_connection_id').eq('singleton',true).single();
  if(config.error)throw new Error('Source unavailable');
  const accounts=await db.from('meta_ad_accounts').select('id,meta_account_id').eq('connection_id',config.data.primary_connection_id).eq('is_selected',true);
  if(accounts.error)throw new Error('Source unavailable');
  let token;
  stage='token_file';
  const tokenFile=process.env.OWNED_MANAGEMENT_ACCESS_TOKEN_FILE??resolve(sourcePath,'Token Facebook.txt');
  try{
    const content=await readFile(tokenFile,'utf8');
    const matches=[...new Set(content.match(/EAA[A-Za-z0-9]+/g)??[])];
    if(matches.length!==1||matches[0].length<50)throw new Error('Invalid token file');
    token=matches[0];
  }catch(error){
    if(error.code!=='ENOENT'||process.env.OWNED_MANAGEMENT_ACCESS_TOKEN_FILE)throw error;
  }
  if(!token){
    const connection=await db.from('meta_connections').select('token_ciphertext').eq('id',config.data.primary_connection_id).eq('status','active').single();
    if(connection.error)throw new Error('Source connection unavailable');
    stage='decrypt';process.env.TOKEN_ENCRYPTION_KEY=env.TOKEN_ENCRYPTION_KEY;
    const {decryptToken}=await import(pathToFileURL(resolve(sourcePath,'src/lib/secret-crypto.ts')).href);
    try{token=decryptToken(connection.data.token_ciphertext);}catch(error){
      if(!process.env.OWNED_MANAGEMENT_TOKEN_ENV_PATH)throw error;
      const tokenEnv=parseEnv(await readFile(process.env.OWNED_MANAGEMENT_TOKEN_ENV_PATH,'utf8'));
      process.env.TOKEN_ENCRYPTION_KEY=tokenEnv.TOKEN_ENCRYPTION_KEY;
      token=decryptToken(connection.data.token_ciphertext);
    }
  }
  const graph=async(id,fields,params={},edge='')=>{
    if(!/^[\d_]+$/.test(id??''))return null;
    if(edge&&edge!=='previews')return null;
    const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION||'v25.0'}/${id}${edge?'/'+edge:''}`);
    url.searchParams.set('fields',fields);
    for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(6000)}).catch(()=>null);
    const body=await response?.json().catch(()=>null);
    if(!response?.ok){console.error('Owned Graph read failed',JSON.stringify({fields,status:response?.status,code:body?.error?.code,subcode:body?.error?.error_subcode}));return null;}
    return body;
  };
  const safe=url=>{
    try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.searchParams.has('access_token')&&!parsed.username&&!parsed.password?url:null;}catch{return null;}
  };
  const previewSource=html=>{
    const src=typeof html==='string'?html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&'):null;
    const url=safe(src);
    if(!url)return null;
    const parsed=new URL(url);
    return ['www.facebook.com','business.facebook.com'].includes(parsed.hostname)&&parsed.pathname==='/ads/api/preview_iframe.php'&&!parsed.port?url:null;
  };
  stage='graph';const results=[];
  async function publish(item,image,videoId){
    const video=includeVideo&&videoId?await graph(videoId,'source'):null;
    const videoUrl=safe(video?.source);
    // Marketing access can provide an official playable preview when Page video
    // source access is denied. Return only a validated iframe URL, never raw HTML.
    const preview=includeVideo&&videoId&&!videoUrl?await graph(item.ad_id,'body',{ad_format:'MOBILE_FEED_STANDARD'},'previews'):null;
    results.push({...item,url:safe(image),video_id:videoId??null,...(includeVideo?{video_url:videoUrl,video_preview_url:previewSource(preview?.data?.[0]?.body)}:{})});
  }
  async function read(item){
    const account=accounts.data.find(a=>a.meta_account_id===item.account_id);
    if(!account)return;
    const stored=await db.from('meta_entities').select('creative_id,creative_video_id').eq('ad_account_id',account.id).eq('level','ad').eq('meta_entity_id',item.ad_id).maybeSingle();
    if(stored.error||!stored.data)return;
    const creativeId=stored.data.creative_id??(await graph(item.ad_id,'creative'))?.creative?.id;
    // Marketing creative access is sufficient; avoid slow Page/video reads when
    // the token lacks those permissions. Most ads finish in a single Graph call.
    const large=await graph(creativeId,'thumbnail_url',{thumbnail_width:'1080',thumbnail_height:'1080'});
    if(safe(large?.thumbnail_url)){
      const videoId=stored.data.creative_video_id??(includeVideo?(await graph(creativeId,'video_id'))?.video_id:null);
      await publish(item,large.thumbnail_url,videoId);return;
    }
    let creative=await graph(creativeId,'image_url,object_story_spec,effective_object_story_id,video_id');
    if(!creative)creative=(await graph(item.ad_id,'creative{image_url,object_story_spec,effective_object_story_id,video_id}'))?.creative;
    const story=creative?.effective_object_story_id?await graph(creative.effective_object_story_id,'full_picture,attachments{media{image}}'):null;
    let image=story?.full_picture??story?.attachments?.data?.[0]?.media?.image?.src??creative?.image_url??creative?.object_story_spec?.photo_data?.url??creative?.object_story_spec?.link_data?.picture??null;
    const videoId=creative?.video_id??creative?.object_story_spec?.video_data?.video_id??stored.data.creative_video_id;
    if(videoId){
      const video=await graph(videoId,'thumbnails');
      const largest=video?.thumbnails?.data?.sort((a,b)=>(b.width*b.height)-(a.width*a.height))[0];
      if(largest?.uri)image=largest.uri;
    }
    await publish(item,image,videoId);
  }
  // Only the visible page, four ads at a time; never sweep 73,000 ads through Graph.
  for(let offset=0;offset<items.length;offset+=4)await Promise.all(items.slice(offset,offset+4).map(read));
  console.log(JSON.stringify(results));
}catch(error){console.error('Owned media resolution unavailable',stage,error.code??error.name,stage==='decrypt'?['Unsupported token ciphertext','TOKEN_ENCRYPTION_KEY is not configured','TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes','Unsupported state or unable to authenticate data'].find(message=>error.message===message)??'decrypt/import failed':'');process.exitCode=1;}
