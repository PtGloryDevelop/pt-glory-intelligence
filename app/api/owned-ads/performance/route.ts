import { NextResponse } from "next/server";
import { ownedReportRoute } from "@/lib/owned-ads/store";
import { OwnedPerformanceQueryError } from "@/lib/owned-ads/performance";
import { getOwnedPerformance } from "@/lib/owned-ads/performance-read";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return ownedReportRoute(async () => {
    try { return NextResponse.json(await getOwnedPerformance(new URL(request.url).searchParams)); }
    catch (error) {
      if (error instanceof OwnedPerformanceQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ error: "ข้อมูลผลลัพธ์รายวันยังไม่พร้อมใช้งาน" }, { status: 503 });
    }
  });
}
