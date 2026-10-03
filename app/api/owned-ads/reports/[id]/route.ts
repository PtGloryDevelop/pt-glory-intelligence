import { NextResponse } from "next/server";
import { isUuid } from "../../../../../lib/read/request.ts";
import { getOwnedAdReport, ownedReportRoute } from "../../../../../lib/owned-ads/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return ownedReportRoute(async () => {
    const { id } = await context.params;
    if (!isUuid(id)) return NextResponse.json({ error: "รหัสรายงานไม่ถูกต้อง" }, { status: 400 });
    const report = await getOwnedAdReport(id);
    if (!report) return NextResponse.json({ error: "ไม่พบรายงาน" }, { status: 404 });
    return NextResponse.json({ report });
  });
}
