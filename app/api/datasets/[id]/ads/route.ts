import type { NextRequest } from "next/server";
import { getDatasetAds, getDatasetFacets, type ExplorerFilters } from "@/lib/read/queries";
import { badRequest, readRoute } from "@/lib/read/guard";
import {
  activeFilter, boolFilter, dateFilter, filterValue, intFilter, isUuid,
  pageOffset, pageSize, searchValue, sortKey,
} from "@/lib/read/request";

export const runtime = "nodejs";

/** Filtering, sorting and search happen in SQL; the browser never receives the full set. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = request.nextUrl.searchParams;

  return readRoute(async () => {
    if (!isUuid(id)) return badRequest("dataset id must be a UUID");

    const active = activeFilter(query.get("active"));
    if (!active.ok) return badRequest("active must be active, inactive or unknown");

    const sort = sortKey(query.get("sort"));
    if (!sort.ok) return badRequest("sort is not one of the supported keys");

    // Each of these is refused rather than coerced: a filter the server cannot
    // parse must not turn into "no filter" and return a wider set than asked for.
    const dates = {
      startedFrom: dateFilter(query.get("startedFrom")),
      startedTo: dateFilter(query.get("startedTo")),
      firstSeenFrom: dateFilter(query.get("firstSeenFrom")),
      firstSeenTo: dateFilter(query.get("firstSeenTo")),
      lastSeenFrom: dateFilter(query.get("lastSeenFrom")),
      lastSeenTo: dateFilter(query.get("lastSeenTo")),
    };
    for (const [name, parsed] of Object.entries(dates)) {
      if (!parsed.ok) return badRequest(`${name} must be a date`);
    }

    const numbers = {
      ageMin: intFilter(query.get("ageMin")),
      ageMax: intFilter(query.get("ageMax")),
      reuseMin: intFilter(query.get("reuseMin")),
    };
    for (const [name, parsed] of Object.entries(numbers)) {
      if (!parsed.ok) return badRequest(`${name} must be a non-negative number`);
    }

    const flags = {
      evergreen: boolFilter(query.get("evergreen")),
      hasVideo: boolFilter(query.get("hasVideo")),
      hasImage: boolFilter(query.get("hasImage")),
      hasTitle: boolFilter(query.get("hasTitle")),
      hasDestination: boolFilter(query.get("hasDestination")),
    };
    for (const [name, parsed] of Object.entries(flags)) {
      if (!parsed.ok) return badRequest(`${name} must be true or false`);
    }

    // Clamped, never trusted: there is no request that reads the whole dataset.
    const limit = pageSize(query.get("limit"));
    const offset = pageOffset(query.get("offset"));

    const filters: ExplorerFilters = {
      active: active.value,
      format: filterValue(query.get("format")),
      cta: filterValue(query.get("cta")),
      platform: filterValue(query.get("platform")),
      category: filterValue(query.get("category")),
      search: searchValue(query.get("search")),
      page: filterValue(query.get("page")),
      startedFrom: dates.startedFrom.ok ? dates.startedFrom.value : null,
      startedTo: dates.startedTo.ok ? dates.startedTo.value : null,
      firstSeenFrom: dates.firstSeenFrom.ok ? dates.firstSeenFrom.value : null,
      firstSeenTo: dates.firstSeenTo.ok ? dates.firstSeenTo.value : null,
      lastSeenFrom: dates.lastSeenFrom.ok ? dates.lastSeenFrom.value : null,
      lastSeenTo: dates.lastSeenTo.ok ? dates.lastSeenTo.value : null,
      ageMin: numbers.ageMin.ok ? numbers.ageMin.value : null,
      ageMax: numbers.ageMax.ok ? numbers.ageMax.value : null,
      evergreen: flags.evergreen.ok ? flags.evergreen.value : null,
      reuseMin: numbers.reuseMin.ok ? numbers.reuseMin.value : null,
      hasVideo: flags.hasVideo.ok ? flags.hasVideo.value : null,
      hasImage: flags.hasImage.ok ? flags.hasImage.value : null,
      hasTitle: flags.hasTitle.ok ? flags.hasTitle.value : null,
      hasDestination: flags.hasDestination.ok ? flags.hasDestination.value : null,
      sort: sort.value,
      limit,
      offset,
    };

    const { rows, total } = await getDatasetAds(id, filters);

    return {
      rows: rows.map(({ total_count, ...row }) => { void total_count; return row; }),
      total,
      limit,
      offset,
      sort: sort.value,
      facets: query.get("facets") === "1" ? await getDatasetFacets(id) : undefined,
    };
  });
}
