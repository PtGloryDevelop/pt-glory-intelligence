import type { PoolClient } from "pg";

const UNIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether a round's pages are the unit's rivals as they stand: a page link asked for that one page, and an
 * exact phrase (a brand in quotes) finds only ads carrying it. A loose word search finds anyone using the
 * word, so its pages wait for a ใช่ / ไม่ใช่ instead.
 */
export function adoptsPages(params: Record<string, unknown>): boolean {
  if (typeof params.page_id === "string") return true;
  return typeof params.keyword === "string" && /^".+"$/.test(params.keyword.trim());
}

/**
 * After a round with a unit is imported: its pages become that unit's rivals (when `adoptsPages`), and its
 * words become one of the unit's keywords, so later rounds' new pages are suggested too. Every write is
 * "only if not there yet": a page the team already answered for keeps the team's answer, and a retry
 * changes nothing. Runs on the server's own connection, as the person who asked for the round.
 */
export async function adoptRivals(
  client: PoolClient,
  request: { id: string; requestedBy: string; runId: string; params: Record<string, unknown> },
): Promise<{ pages: number; keyword: string | null } | null> {
  const unitId = request.params.unit_id;
  const unitName = typeof request.params.unit_name === "string" ? request.params.unit_name.trim() : "";
  if (typeof unitId !== "string" || !UNIT_ID.test(unitId) || unitName === "" || unitName.length > 120) return null;

  let pages = 0;
  if (adoptsPages(request.params)) {
    const adopted = await client.query(
      `insert into public.rival_page_units (page_id, unit_id, unit_name, relation, decided_by)
       select distinct p.page_id, $2, $3, 'direct', $4::uuid
         from public.ad_observations o
         join public.ads a on a.id = o.ad_ref
         join public.pages p on p.id = a.page_ref
        where o.collection_run_id = $1
       on conflict (page_id, unit_id) do nothing`,
      [request.runId, unitId, unitName, request.requestedBy],
    );
    pages = adopted.rowCount ?? 0;
  }

  // A page round's keyword is only the page's label, not words anyone searched.
  const word = typeof request.params.page_id === "string" || typeof request.params.keyword !== "string"
    ? "" : request.params.keyword.replace(/^"+|"+$/g, "").trim();
  const keyword = word.length >= 2 && word.length <= 60 ? word : null;
  let keywordAdded = false;
  if (keyword) {
    const added = await client.query(
      `insert into public.unit_keywords (unit_id, unit_name, keyword, created_by)
       values ($1, $2, $3, $4::uuid)
       on conflict do nothing`,
      [unitId, unitName, keyword, request.requestedBy],
    );
    keywordAdded = (added.rowCount ?? 0) > 0;
  }

  // A retry that changed nothing leaves no second record.
  if (pages > 0 || keywordAdded) await client.query(
    `insert into public.audit_logs (actor, action, entity_type, entity_id, after)
     values ($1, 'collection.rivals_adopted', 'collection_request', $2, $3::jsonb)`,
    [request.requestedBy, request.id, JSON.stringify({ unit_id: unitId, pages, keyword })],
  );
  return { pages, keyword: keywordAdded ? keyword : null };
}
