import {NextResponse} from 'next/server';
import {requireRole} from '@/lib/auth/roles';
import {AuthorizationError} from '@/lib/auth/role-model';
import {getUnitOffers} from '@/lib/rivals/offers';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Offers in one unit's ad copy beside its matched rivals'. Analysts only: our side is company data. */
export async function GET(request:Request){
  try{
    await requireRole('analyst');
    const unit=new URL(request.url).searchParams.get('unit')??'';
    if(!UUID.test(unit))return NextResponse.json({error:'ยูนิตไม่ถูกต้อง'},{status:400,headers});
    return NextResponse.json(await getUnitOffers(unit),{headers});
  }catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers});
    console.error('Unit offers unavailable',{code:(error as {code?:string}).code??'unknown'});
    return NextResponse.json({error:'เปิดข้อเสนอเทียบคู่แข่งไม่สำเร็จ'},{status:503,headers});
  }
}
