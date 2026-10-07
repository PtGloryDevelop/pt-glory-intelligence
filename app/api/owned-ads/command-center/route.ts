import { NextResponse } from "next/server";
import { ownedReportRoute } from "@/lib/owned-ads/store";
import { OwnedPerformanceQueryError } from "@/lib/owned-ads/performance";
import { getCommandCenter } from "@/lib/owned-ads/command-center-read";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return ownedReportRoute(async () => {
    try {
      const data = await getCommandCenter(new URL(request.url).searchParams);
      return data ? NextResponse.json(data) : NextResponse.json({ error: "ข้อมูลรายวันยังไม่พร้อม" }, { status: 503 });
    } catch (error) {
      if (error instanceof OwnedPerformanceQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ error: "Command Center ยังไม่พร้อมใช้งาน" }, { status: 503 });
    }
  });
}
