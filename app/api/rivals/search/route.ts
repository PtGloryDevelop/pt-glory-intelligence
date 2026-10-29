import {NextResponse,type NextRequest} from 'next/server';
import {requireRole} from '@/lib/auth/roles';
import {AuthorizationError} from '@/lib/auth/role-model';
import {getSearchPages,type PageSource} from '@/lib/rivals/board';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Pages to confirm rivals on, where they were found: a ส่องแอด search (`q`), a pasted page link (`page`) or
 * a finished round (`dataset`). Analysts: it names our units.
 */
export async function GET(request:NextRequest){
  try{
    await requireRole('analyst');
    const params=request.nextUrl.searchParams;
    const page=params.get('page'),dataset=params.get('dataset');
    let source:PageSource;
    if(page!==null){
      if(!/^\d{1,32}$/.test(page))return NextResponse.json({error:'เลขเพจไม่ถูกต้อง'},{status:400,headers});
      source={pageId:page};
    }else if(dataset!==null){
      if(!UUID.test(dataset))return NextResponse.json({error:'รอบที่เก็บไม่ถูกต้อง'},{status:400,headers});
      source={datasetId:dataset};
    }else{
      const query=(params.get('q')??'').replace(/^"+|"+$/g,'').trim();
      if(query.length<2||query.length>60)return NextResponse.json({error:'คำค้นต้องยาว 2–60 ตัวอักษร'},{status:400,headers});
      source={query};
    }
    return NextResponse.json(await getSearchPages(source),{headers});
  }catch(error){
    if(error instanceof AuthorizationError)return NextResponse.json({error:error.message},{status:error.status,headers});
    console.error('Search pages unavailable');return NextResponse.json({error:'เปิดรายชื่อเพจไม่สำเร็จ'},{status:503,headers});
  }
}
