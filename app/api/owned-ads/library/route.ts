import { NextResponse } from "next/server";
import { dbUser } from "@/lib/db/user";
import { ownedReportRoute } from "@/lib/owned-ads/store";
import {cachedOwnedImage} from '@/lib/owned-ads/media-cache';
import type {CompanyAd} from '@/lib/owned-ads/source-rows';
const withCachedMedia=(row:CompanyAd)=>({...row,creative_url:cachedOwnedImage(row)});

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return ownedReportRoute(async () => {
    const db = await dbUser();
    const [latest, progress] = await Promise.all([
      db.from("owned_library_syncs").select("*").eq("status","completed").order("finished_at",{ascending:false}).limit(1).maybeSingle(),
      db.from("owned_library_syncs").select("*").order("started_at",{ascending:false}).limit(1).maybeSingle(),
    ]);
    if (latest.error || progress.error) return NextResponse.json({error:"คลังแอดบริษัทยังไม่พร้อมใช้งาน"},{status:503});
    const snapshot = latest.data;
    const params = new URL(request.url).searchParams;
    if (params.get("progress") === "1") return NextResponse.json({progress:progress.data});
    const page = Number(params.get("page") ?? 0);
    const account = params.get("account") ?? ""; const status = params.get("status") ?? "";
    const search = (params.get("q") ?? "").trim();
    const hasSpend=params.get('spend')==='reported';
    if(params.has('spend')&&!['reported','all'].includes(params.get('spend')!))return NextResponse.json({error:'ตัวกรองค่าแอดไม่ถูกต้อง'},{status:400});
    if (!Number.isSafeInteger(page) || page<0 || page>100000 || search.length>160 || account.length>128 || status.length>64) {
      return NextResponse.json({error:"ตัวกรองไม่ถูกต้อง"},{status:400});
    }
    if (!snapshot) return NextResponse.json({snapshot:null,progress:progress.data,rows:[],total:0,page,pageSize:24});
    const filtered = Boolean(account || status || search || hasSpend);
    if (filtered) {
      const result=await db.rpc("owned_library_filtered_page",{p_sync:snapshot.id,p_search:search,p_account:account,p_status:status,p_page:page,...(hasSpend?{p_has_spend:true}:{})});
      if(result.error)return NextResponse.json({error:"เปิดคลังแอดไม่สำเร็จ"},{status:503});
      return NextResponse.json({snapshot,progress:progress.data,...result.data,rows:result.data.rows.map(withCachedMedia),page,pageSize:24});
    }
    const query = db.from("owned_library_ads").select("data").eq("sync_id",snapshot.id);
    const result = await query.order("spend",{ascending:false,nullsFirst:false}).order("account_id").order("ad_id").range(page*24,page*24+23);
    if (result.error) {
      console.error("Owned library read failed",result.error.code);
      return NextResponse.json({error:"เปิดคลังแอดไม่สำเร็จ"},{status:503});
    }
    return NextResponse.json({snapshot,progress:progress.data,rows:(result.data ?? []).map(row=>withCachedMedia(row.data)),total:snapshot.ad_count,page,pageSize:24});
  });
}
