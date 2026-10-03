import { NextResponse } from "next/server";
import { parseOwnedAdImport, readOwnedImportRequest } from "../../../../lib/owned-ads/import.ts";
import { createOwnedAdReport, listOwnedAdReports, ownedReportRoute } from "../../../../lib/owned-ads/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ownedReportRoute(async () => NextResponse.json({ reports: await listOwnedAdReports() }));
}

export async function POST(request: Request) {
  return ownedReportRoute(async (actor) => {
    const input = parseOwnedAdImport(await readOwnedImportRequest(request));
    const report = await createOwnedAdReport(input, actor);
    return NextResponse.json({ report }, { status: 201 });
  });
}
