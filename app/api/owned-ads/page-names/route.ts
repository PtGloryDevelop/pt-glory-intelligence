import {NextResponse} from 'next/server';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {ownedReportRoute} from '@/lib/owned-ads/store';

export const runtime='nodejs';
export const maxDuration=300;
export async function POST(){
 return ownedReportRoute(async actor=>{
  if(!process.env.OWNED_MANAGEMENT_PROJECT_PATH||!process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL)return NextResponse.json({error:'ยังไม่ได้เชื่อมเว็บ Ads Management'},{status:503});
  try{
   const result=await promisify(execFile)(process.execPath,['--experimental-strip-types',resolve(process.cwd(),'scripts/refresh-owned-page-names.mjs'),actor.userId],{
    cwd:process.cwd(),env:process.env,windowsHide:true,timeout:270000,maxBuffer:128*1024,
   });
   const report=JSON.parse(result.stdout);
   return NextResponse.json({pages:report.pages,named:report.named,unresolved:report.unresolved});
  }catch{return NextResponse.json({error:'อัปเดตชื่อเพจไม่สำเร็จ กรุณาตรวจสิทธิ์เพจหรือรอการซิงค์แอดเสร็จก่อน'},{status:503})}
 });
}
