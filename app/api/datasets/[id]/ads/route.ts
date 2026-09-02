import { NextResponse, type NextRequest } from "next/server";
import { getDatasetAds, getDatasetFacets } from "@/lib/read/queries";

export const runtime = "nodejs";

/** Filtering and search happen in SQL; the browser never receives the full set. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = request.nextUrl.searchParams;
  const limit = Math.min(Number(query.get("limit") ?? 30) || 30, 100);
  const offset = Math.max(Number(query.get("offset") ?? 0) || 0, 0);

  const { rows, total } = await getDatasetAds(id, {
    active: query.get("active"),
    format: query.get("format"),
    cta: query.get("cta"),
    platform: query.get("platform"),
    category: query.get("category"),
    search: query.get("search"),
    limit,
    offset,
  });

  return NextResponse.json({
    rows: rows.map(({ total_count, ...row }) => { void total_count; return row; }),
    total,
    limit,
    offset,
    facets: query.get("facets") === "1" ? await getDatasetFacets(id) : undefined,
  });
}
