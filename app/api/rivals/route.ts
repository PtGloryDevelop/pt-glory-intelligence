import {NextResponse} from 'next/server';
import {requireRole} from '@/lib/auth/roles';
import {AuthorizationError} from '@/lib/auth/role-model';
import {applyRivalAction,getRivalBoard,RivalInputError} from '@/lib/rivals/board';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

export async function GET(){
  try{return NextResponse.json(await getRivalBoard(await requireRole('viewer')),{headers});}
  catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers});
    console.error('Rival board unavailable');return NextResponse.json({error:'เปิดข้อมูลคู่แข่งของยูนิตไม่สำเร็จ'},{status:503,headers});
  }
}

export async function POST(request:Request){
  try{
    await requireRole('analyst');
    if(Number(request.headers.get('content-length'))>2000)return NextResponse.json({error:'คำขอใหญ่เกินไป'},{status:400,headers});
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object')return NextResponse.json({error:'คำขอไม่ถูกต้อง'},{status:400,headers});
    await applyRivalAction(body);
    return NextResponse.json({ok:true},{headers});
  }catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers});
    if(error instanceof RivalInputError)return NextResponse.json({error:error.message},{status:400,headers});
    console.error('Rival write failed');return NextResponse.json({error:'บันทึกไม่สำเร็จ ลองอีกครั้ง'},{status:503,headers});
  }
}
