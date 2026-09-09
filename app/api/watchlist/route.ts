import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createWatchItem } from "@/lib/read/watchlist";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor } from "@/lib/auth/roles";
import { isPageInScope } from "@/lib/read/compare";
import { pageScopeFromWatch, normalizeSignals, parseWatchScope, scopeColumns } from "@/lib/watchlist/contract";
import { isPageId, isUuid } from "@/lib/read/request";

export const runtime = "nodejs";

/**
 * Saves a watch.
 *
 * The write goes through the user's own client, so `watch_items` RLS decides
 * whether it is allowed — this route validates shape and membership, not
 * ownership. A viewer may keep a watchlist: it is personal research state and
 * changes no dataset, ad or observation.
 */
export async function POST(request: NextRequest) {
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("body must be JSON");

    const targetType = body.targetType === "category" ? "category" : "page";
    const scope = parseWatchScope(typeof body.scope === "string" ? body.scope : null);
    if (!scope) return badRequest("scope must be all, dataset:<uuid> or category:<uuid>");

    const signals = normalizeSignals(targetType, body.signals);
    if (!signals.ok) return badRequest(signals.reason);

    if (targetType === "page") {
      const pageId = typeof body.pageId === "string" ? body.pageId : "";
      if (!isPageId(pageId)) return badRequest("page id must be numeric");

      // A page with no representation in the chosen scope cannot be watched
      // there: the watch would answer a question about data that does not exist,
      // and every count would be a zero meaning "not here" rather than "none".
      const columns = scopeColumns(scope);
      const pageScope = pageScopeFromWatch({
        scope_kind: columns.scope_kind,
        scope_dataset_id: columns.scope_dataset_id,
        scope_category_id: columns.scope_category_id,
      });
      if (!pageScope) return badRequest("scope is not usable");
      if (!(await isPageInScope(pageScope, pageId))) {
        return badRequest("this page is not represented in the selected scope");
      }

      const created = await createWatchItem({
        actorId: actor.userId, targetType: "page", targetPageId: pageId,
        scope, signals: signals.value,
      });
      if (!created.ok) {
        return NextResponse.json(
          { error: created.message, duplicate: created.duplicate },
          { status: created.duplicate ? 409 : 400 },
        );
      }
      return NextResponse.json({ id: created.id }, { status: 201 });
    }

    const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
    if (!isUuid(categoryId)) return badRequest("category id must be a UUID");
    // A category watch is always about its own category; the database enforces
    // the same invariant.
    if (scope.kind !== "category" || scope.categoryId !== categoryId) {
      return badRequest("a category watch must use its own category as the scope");
    }

    const created = await createWatchItem({
      actorId: actor.userId, targetType: "category", targetCategoryId: categoryId,
      scope, signals: signals.value,
    });
    if (!created.ok) {
      return NextResponse.json(
        { error: created.message, duplicate: created.duplicate },
        { status: created.duplicate ? 409 : 400 },
      );
    }
    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}
