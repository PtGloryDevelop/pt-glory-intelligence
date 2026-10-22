import { NextResponse } from "next/server";
import { ownedReportRoute } from "@/lib/owned-ads/store";
import { OwnedPerformanceQueryError } from "@/lib/owned-ads/performance";
import { getOwnedMediaMembers } from "@/lib/owned-ads/performance-read";

export const dynamic = "force-dynamic";
/** The ads behind one creative card, with the library page's filters. */
export async function GET(request: Request) {
  return ownedReportRoute(async () => {
    try { return NextResponse.json(await getOwnedMediaMembers(new URL(request.url).searchParams)); }
    catch (error) {
      if (error instanceof OwnedPerformanceQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ error: "เปิดรายการแอดของสื่อนี้ไม่สำเร็จ" }, { status: 503 });
    }
  });
}
