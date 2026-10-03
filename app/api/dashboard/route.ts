import {NextResponse} from 'next/server';
import {requireRole} from '@/lib/auth/roles';
import {AuthorizationError} from '@/lib/auth/role-model';
import {getDashboard} from '@/lib/dashboard/read';
import {parseReviewOptions} from '@/lib/dashboard/review-model';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    const actor=await requireRole('viewer');
    let options;
    try{options=parseReviewOptions(new URL(request.url).searchParams);}catch{return NextResponse.json({error:'ช่วงวันที่หรือตัวกรองไม่ถูกต้อง'},{status:400,headers:{'Cache-Control':'private, no-store'}});}
    return NextResponse.json(await getDashboard(actor,options),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers:{'Cache-Control':'private, no-store'}});
    console.error('Dashboard unavailable',{code:(error as {code?:string}).code??'unknown'});
    return NextResponse.json({error:'เปิดภาพรวมไม่สำเร็จ'},{status:503,headers:{'Cache-Control':'private, no-store'}});
  }
}
