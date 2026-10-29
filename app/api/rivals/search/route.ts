import {NextResponse,type NextRequest} from 'next/server';
import {requireRole} from '@/lib/auth/roles';
import {AuthorizationError} from '@/lib/auth/role-model';
import {getSearchPages} from '@/lib/rivals/board';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};

/** The pages behind a ส่องแอด search, for confirming rivals where they were found. Analysts: it names our units. */
export async function GET(request:NextRequest){
  try{
    await requireRole('analyst');
    const query=(request.nextUrl.searchParams.get('q')??'').replace(/^"+|"+$/g,'').trim();
    if(query.length<2||query.length>60)return NextResponse.json({error:'คำค้นต้องยาว 2–60 ตัวอักษร'},{status:400,headers});
    return NextResponse.json(await getSearchPages(query),{headers});
  }catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers});
    console.error('Search pages unavailable');return NextResponse.json({error:'เปิดรายชื่อเพจไม่สำเร็จ'},{status:503,headers});
  }
}
