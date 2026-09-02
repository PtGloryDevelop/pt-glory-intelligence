import type { NextRequest } from "next/server";
import { getDatasetAds, getDatasetFacets } from "@/lib/read/queries";
import { badRequest, readRoute } from "@/lib/read/guard";
import { activeFilter, filterValue, isUuid, pageOffset, pageSize, searchValue } from "@/lib/read/request";

export const runtime = "nodejs";

/** Filtering and search happen in SQL; the browser never receives the full set. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = request.nextUrl.searchParams;

  return readRoute(async () => {
    if (!isUuid(id)) return badRequest("dataset id must be a UUID");

    const active = activeFilter(query.get("active"));
    if (!active.ok) return badRequest("active must be active, inactive or unknown");

    // Clamped, never trusted: there is no request that reads the whole dataset.
    const limit = pageSize(query.get("limit"));
    const offset = pageOffset(query.get("offset"));

    const { rows, total } = await getDatasetAds(id, {
      active: active.value,
      format: filterValue(query.get("format")),
      cta: filterValue(query.get("cta")),
      platform: filterValue(query.get("platform")),
      category: filterValue(query.get("category")),
      search: searchValue(query.get("search")),
      limit,
      offset,
    });

    return {
      rows: rows.map(({ total_count, ...row }) => { void total_count; return row; }),
      total,
      limit,
      offset,
      facets: query.get("facets") === "1" ? await getDatasetFacets(id) : undefined,
    };
  });
}
