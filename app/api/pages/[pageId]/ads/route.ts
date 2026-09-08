import type { NextRequest } from "next/server";
import { getPageAds } from "@/lib/read/pages";
import { badRequest, readRoute } from "@/lib/read/guard";
import { signArchivedPreviews } from "@/lib/media/presentation";
import { filterValue, isPageId, pageOffset, pageSize, sortKey } from "@/lib/read/request";
import { pageSignal, parseScope, recentDays } from "@/lib/pages/scope";

export const runtime = "nodejs";

/**
 * The evidence behind a Page signal.
 *
 * Filtering and paging happen in SQL, and the scope is required rather than
 * defaulted: a request with no scope has not said what its numbers would be
 * about, and answering it with "everything" would be the silent scope mixing
 * this feature exists to avoid.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const { pageId } = await params;
  const query = request.nextUrl.searchParams;

  return readRoute(async () => {
    if (!isPageId(pageId)) return badRequest("page id must be numeric");

    const scope = parseScope(query.get("scope"));
    if (!scope) return badRequest("scope must be all, dataset:<uuid> or category:<uuid>");

    // An unrecognised signal is refused rather than ignored: silently dropping
    // it would return every ad under a heading that promises a subset.
    const rawSignal = filterValue(query.get("signal"));
    const signal = rawSignal === null ? null : pageSignal(rawSignal);
    if (rawSignal !== null && signal === null) return badRequest("signal is not one of the supported keys");

    const sort = sortKey(query.get("sort"));
    if (!sort.ok) return badRequest("sort is not one of the supported keys");

    const limit = pageSize(query.get("limit"));
    const offset = pageOffset(query.get("offset"));

    const { rows, total } = await getPageAds(scope, pageId, {
      signal,
      recentDays: recentDays(query.get("recentDays")),
      format: filterValue(query.get("format")),
      cta: filterValue(query.get("cta")),
      platform: filterValue(query.get("platform")),
      sort: sort.value,
      limit,
      offset,
    });

    // One signing round trip for the page. The URL is short-lived; the object it
    // points at is the durable part.
    const signed = await signArchivedPreviews(rows);

    return {
      rows: rows.map(({ total_count, ...row }) => {
        void total_count;
        return { ...row, archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null };
      }),
      total,
      limit,
      offset,
    };
  });
}
