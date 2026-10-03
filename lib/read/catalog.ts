import { dbUser } from '../db/user.ts';
import { type ExplorerRow } from './queries.ts';
import { signArchivedPreviews } from '../media/presentation.ts';
import { catalogObservationMatches, catalogSearchFilter, catalogSource, type CatalogAdRow, type CatalogMembership, type CatalogObservation } from './catalog-model.ts';

export type { CatalogAdRow } from './catalog-model.ts';
export type CatalogOptions = { search?: string | null; active?: string | null; format?: string | null; adArchiveId?: string | null; firstSeenSince?:string; limit?: number; offset?: number };
export type CatalogPage = { rows: CatalogAdRow[]; total: number; limit: number; offset: number; lastCollectedAt: string | null };
type ScopeRow = { ad_ref: string; observation_id: number; collection_run_id: string; collected_at: string };

/** Resolve provenance for this small page only, using the caller's JWT for
 * every read. A missing run membership fails closed rather than inventing a
 * dataset link that would reopen different creative/copy in comparison. */
async function pinSources(
  db: Awaited<ReturnType<typeof dbUser>>, rows: ExplorerRow[],
): Promise<CatalogAdRow[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => row.ad_archive_id);
  if (new Set(ids).size !== ids.length) throw new Error('Catalog observations are not unique');
  const ads = await db.from('ads').select('id,ad_archive_id').in('ad_archive_id', ids);
  if (ads.error) throw ads.error;
  const refs = (ads.data ?? []).map(row => row.id as string);
  if (refs.length !== ids.length) throw new Error('Catalog identity unavailable');
  const scope = await db.rpc('page_scope_observations', {
    p_scope: 'all', p_scope_id: null,
  }).in('ad_ref', refs);
  if (scope.error) throw scope.error;
  const observations = (scope.data ?? []) as ScopeRow[];
  if (observations.length !== refs.length) throw new Error('Catalog observation unavailable');
  const runs = [...new Set(observations.map(row => row.collection_run_id))];
  const membershipQuery = db.from('dataset_ads')
    .select('ad_ref,dataset_id,dataset:datasets!inner(id,name,collection_run_id,run:collection_runs!inner(collected_at))')
    .in('ad_ref', refs).in('dataset.collection_run_id', runs);
  const [memberships, times, signed] = await Promise.all([
    membershipQuery,
    db.from('ad_observations').select('id,observed_at,is_active,display_format,publisher_platform,cta_type,cta_text,title,body_text,media')
      .in('id', observations.map(row => row.observation_id)),
    signArchivedPreviews(rows),
  ]);
  if (memberships.error) throw memberships.error;
  if (times.error) throw times.error;
  const byId = new Map((ads.data ?? []).map(row => [row.ad_archive_id as string, row.id as string]));
  const byRef = new Map(observations.map(row => [row.ad_ref, row]));
  const byObservation = new Map(((times.data ?? []) as CatalogObservation[]).map(row => [Number(row.id), row]));
  const sources = (memberships.data ?? []) as unknown as CatalogMembership[];
  return rows.map(({ total_count, ...row }) => {
    void total_count;
    const ref = byId.get(row.ad_archive_id)!;
    const observation = byRef.get(ref)!;
    const recorded = byObservation.get(Number(observation.observation_id));
    if (!recorded || !catalogObservationMatches({ ...row, total_count: 0 }, recorded)) throw new Error('Catalog observation changed during read');
    const source = catalogSource(ref, observation.collection_run_id, sources);
    if (!source) throw new Error('Catalog dataset unavailable');
    return {
      ...row, dataset_id: source.dataset_id, dataset_name: source.dataset.name,
      collection_run_id: observation.collection_run_id, collected_at: source.dataset.run.collected_at,
      observed_at: recorded.observed_at,
      archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null,
    };
  });
}

/** Reuse the existing latest-in-scope SQL read. PostgREST applies search,
 * exact count and the 24-row range in the database, after deduplication. The
 * large inner limit leaves pagination to the outer query; it does not transfer
 * the entire catalog to either Node or the browser. No new SQL or paid call. */
export async function getCatalogAds(options: CatalogOptions = {}): Promise<CatalogPage> {
  const db = await dbUser();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 24), 1), 24);
  const offset = Math.min(Math.max(Math.trunc(options.offset ?? 0), 0), 100_000);
  let query = db.rpc('trend_evidence', {
    p_scope: 'all', p_scope_id: null, p_limit: 2_147_483_647, p_offset: 0,
  }, { count: 'exact' }).select('*')
    .order('last_seen_at', { ascending: false }).order('ad_archive_id');
  const search = catalogSearchFilter(options.search);
  if (search) query = query.or(search);
  if (options.adArchiveId) query = query.eq('ad_archive_id', options.adArchiveId);
  if (options.firstSeenSince) query = query.gte('first_seen_at', options.firstSeenSince);
  if (options.active === 'active') query = query.eq('is_active', true);
  else if (options.active === 'inactive') query = query.eq('is_active', false);
  else if (options.active === 'unknown') query = query.is('is_active', null);
  if (options.format) query = query.eq('display_format', options.format);
  const [page, latest] = await Promise.all([
    query.range(offset, offset + limit - 1),
    db.rpc('dataset_list').select('collected_at').order('collected_at', { ascending: false }).limit(1),
  ]);
  let result = page;
  // PostgREST answers an offset beyond the last match with 416 and discards
  // its count. A one-row read recovers the same filtered denominator, so a
  // saved page URL can remain empty without pretending the catalog is empty.
  if (result.error?.code === 'PGRST103' && offset > 0) {
    const first = await query.range(0, 0);
    if (first.error) throw first.error;
    result = { ...first, data: [] };
  }
  if (result.error) throw result.error;
  if (latest.error) throw latest.error;
  if (result.count === null) throw new Error('Catalog count unavailable');
  const latestRows = (latest.data ?? []) as { collected_at: string }[];
  return {
    rows: await pinSources(db, (result.data ?? []) as ExplorerRow[]),
    total: result.count ?? 0, limit, offset, lastCollectedAt: latestRows[0]?.collected_at ?? null,
  };
}
