import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { computeCoverage } from "../collector/coverage.ts";
import type { CanonicalImport } from "../domain/types.ts";
import { AuthorizationError, satisfies, type Role } from "../auth/role-model.ts";

/**
 * Writes one validated, normalized import inside a single transaction.
 *
 * Authorization must already have passed: this runs on the privileged
 * connection, which bypasses RLS entirely.
 *
 * Rows are written set-at-a-time with unnest rather than one statement per
 * record. A 500-ad file is ~1,400 round trips per-row against a remote pooler,
 * which made the gate's repeated imports impractical to run.
 */

export type CommitInput = {
  canonical: CanonicalImport;
  categoryId: string;
  datasetName: string;
  actorId: string | null;
};

export type CommitResult = {
  datasetId: string;
  collectionRunId: string;
  saved: { ads: number; pages: number; adObservations: number; pageObservations: number };
  quarantined: { count: number; reasons: Record<string, number> };
  status: "completed" | "partial";
};

/** Steps a test can interrupt to prove the rollback is real. */
export type FailurePoint = "after_ads" | "before_commit";
export type CommitOptions = { failAt?: FailurePoint };

export async function commitImport(
  input: CommitInput,
  options: CommitOptions = {},
): Promise<CommitResult> {
  return withTransaction((client) => writeAll(client, input, options));
}

/**
 * Authorization gate for the import.
 *
 * The privileged connection bypasses RLS, so the role check has to happen
 * before any connection is opened — not inside the transaction, and not as a
 * UI-level guard. The HTTP route resolves the actor with requireRole() and
 * hands the result here.
 */
export async function commitImportAsRole(
  role: Role | null,
  input: CommitInput,
  options: CommitOptions = {},
): Promise<CommitResult> {
  if (!role) throw new AuthorizationError(401, "Sign in required");
  if (!satisfies(role, "analyst")) throw new AuthorizationError(403, "Requires analyst role");
  return commitImport(input, options);
}

async function writeAll(
  client: PoolClient,
  { canonical, categoryId, datasetName, actorId }: CommitInput,
  options: CommitOptions,
): Promise<CommitResult> {
  const { run } = canonical;
  const collectedAt = run.collectedAt;

  // The collector can repeat an identity within one file, and the repeats can
  // disagree — the real 500-ad export has 87 pages appearing on more than one
  // ad, of which 22 disagree on page_categories, 8 on page_like_count and 3 on
  // page_name. The unique index on (collection_run_id, ad_ref) would abort the
  // import, so duplicates collapse here under one fixed rule:
  //
  //   the FIRST occurrence in source order wins.
  //
  // File order is the collector's own emission order (_pt_glory.source_position
  // ascends with it), so the winner is a property of the file rather than of
  // whatever order rows happen to reach the database. The normalizer already
  // resolves pages the same way.
  const pages = dedupe(canonical.pages, (page) => page.pageId);
  const pageObservations = dedupe(canonical.pageObservations, (obs) => obs.pageId);
  const ads = dedupe(canonical.ads, (ad) => ad.adArchiveId);
  const adObservations = dedupe(canonical.adObservations, (obs) => obs.adArchiveId);

  const status: "completed" | "partial" = canonical.quarantine.length > 0 ? "partial" : "completed";

  // 1. collection_runs
  const runRow = await client.query<{ id: string }>(
    `insert into public.collection_runs (
       source_product, collection_method, collector_schema_version, source_url,
       completeness_claim, scope_country, scope_query, scope_active_status,
       scope_ad_type, scope_media_type, collected_at, stop_reason,
       reported_source_rows, reported_unique_ads, reported_unique_pages,
       reported_unresolved_count, reported_quality_summary,
       computed_source_rows, computed_unique_ads, computed_unique_pages,
       computed_unresolved_count, status, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     returning id`,
    [
      run.sourceProduct, run.collectionMethod, run.collectorSchemaVersion, run.sourceUrl,
      run.completenessClaim, run.scope.country, run.scope.query, run.scope.activeStatus,
      run.scope.adType, run.scope.mediaType, collectedAt, run.stopReason,
      run.reported.sourceRows, run.reported.uniqueAds, run.reported.uniquePages,
      run.reported.unresolvedCount, run.reported.qualitySummary,
      run.computed.sourceRows, run.computed.uniqueAds, run.computed.uniquePages,
      run.computed.unresolvedCount, status, actorId,
    ],
  );
  const collectionRunId = runRow.rows[0].id;

  // 2. datasets
  const datasetRow = await client.query<{ id: string }>(
    `insert into public.datasets (category_id, collection_run_id, name, created_by)
     values ($1,$2,$3,$4) returning id`,
    [categoryId, collectionRunId, datasetName, actorId],
  );
  const datasetId = datasetRow.rows[0].id;

  // 3. page masters. Monotonic on last_seen_at, but identity metadata keeps the
  //    latest NON-NULL value: a newer run omitting page_profile_numeric_id means
  //    "not observed", not "the page lost its identity". An older run may still
  //    fill a gap we never had.
  const pageRefs = new Map<string, string>();
  if (pages.length > 0) {
    const result = await client.query<{ id: string; page_id: string }>(
      `insert into public.pages (page_id, page_profile_numeric_id, page_profile_uri, last_seen_at)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
       on conflict (page_id) do update set
         last_seen_at = greatest(pages.last_seen_at, excluded.last_seen_at),
         page_profile_uri = case
           when excluded.last_seen_at >= pages.last_seen_at
             then coalesce(excluded.page_profile_uri, pages.page_profile_uri)
           else coalesce(pages.page_profile_uri, excluded.page_profile_uri) end,
         page_profile_numeric_id = case
           when excluded.last_seen_at >= pages.last_seen_at
             then coalesce(excluded.page_profile_numeric_id, pages.page_profile_numeric_id)
           else coalesce(pages.page_profile_numeric_id, excluded.page_profile_numeric_id) end,
         updated_at = now()
       returning id, page_id`,
      [
        pages.map((page) => page.pageId),
        pages.map((page) => page.pageProfileNumericId),
        pages.map((page) => page.pageProfileUri),
        pages.map(() => collectedAt),
      ],
    );
    for (const row of result.rows) pageRefs.set(row.page_id, row.id);
  }

  // 4. page_observations
  if (pageObservations.length > 0) {
    await client.query(
      // unnest flattens multidimensional arrays, so a text[] column cannot be
      // fed from a text[][] parameter. Array values travel as jsonb and are
      // rebuilt per row instead.
      `insert into public.page_observations
         (page_ref, collection_run_id, observed_at, page_name, page_like_count, page_categories)
       select page_ref, run_id, seen, name, likes, jsonb_text_array(cats)
         from unnest(
           $1::uuid[], $2::uuid[], $3::timestamptz[], $4::text[], $5::bigint[], $6::jsonb[]
         ) as t(page_ref, run_id, seen, name, likes, cats)`,
      [
        pageObservations.map((obs) => pageRefs.get(obs.pageId)),
        pageObservations.map(() => collectionRunId),
        pageObservations.map(() => collectedAt),
        pageObservations.map((obs) => obs.pageName),
        pageObservations.map((obs) => obs.pageLikeCount),
        pageObservations.map((obs) => JSON.stringify(obs.pageCategories)),
      ],
    );
  }

  // 5. ad masters. Current state only moves forward, and there is deliberately
  //    no coalesce: a null from the newest observation means UNKNOWN, so reusing
  //    the previous value would present an old fact as a current one.
  const adRefs = new Map<string, string>();
  if (ads.length > 0) {
    const result = await client.query<{ id: string; ad_archive_id: string }>(
      `insert into public.ads (
         ad_archive_id, page_ref, collation_id, start_date, end_date, is_active,
         display_format, publisher_platform, first_seen_at, last_seen_at
       )
       select ad_id, page_ref, coll_id, start_at, end_at, active, fmt,
              jsonb_text_array(platform), seen, seen
         from unnest(
           $1::text[], $2::uuid[], $3::text[], $4::timestamptz[], $5::timestamptz[],
           $6::boolean[], $7::text[], $8::jsonb[], $9::timestamptz[]
         ) as t(ad_id, page_ref, coll_id, start_at, end_at, active, fmt, platform, seen)
       on conflict (ad_archive_id) do update set
         first_seen_at = least   (ads.first_seen_at, excluded.first_seen_at),
         last_seen_at  = greatest(ads.last_seen_at,  excluded.last_seen_at),
         page_ref = case when excluded.last_seen_at >= ads.last_seen_at
                         then excluded.page_ref else ads.page_ref end,
         collation_id = case when excluded.last_seen_at >= ads.last_seen_at
                             then excluded.collation_id else ads.collation_id end,
         start_date = case when excluded.last_seen_at >= ads.last_seen_at
                           then excluded.start_date else ads.start_date end,
         end_date = case when excluded.last_seen_at >= ads.last_seen_at
                         then excluded.end_date else ads.end_date end,
         is_active = case when excluded.last_seen_at >= ads.last_seen_at
                          then excluded.is_active else ads.is_active end,
         display_format = case when excluded.last_seen_at >= ads.last_seen_at
                               then excluded.display_format else ads.display_format end,
         publisher_platform = case when excluded.last_seen_at >= ads.last_seen_at
                                   then excluded.publisher_platform
                                   else ads.publisher_platform end,
         updated_at = now()
       returning id, ad_archive_id`,
      [
        ads.map((ad) => ad.adArchiveId),
        ads.map((ad) => pageRefs.get(ad.pageId)),
        ads.map((ad) => ad.collationId),
        ads.map((ad) => ad.startDate),
        ads.map((ad) => ad.endDate),
        ads.map((ad) => ad.isActive),
        ads.map((ad) => ad.displayFormat),
        ads.map((ad) => JSON.stringify(ad.publisherPlatform)),
        ads.map(() => collectedAt),
      ],
    );
    for (const row of result.rows) adRefs.set(row.ad_archive_id, row.id);
  }

  if (options.failAt === "after_ads") throw new Error("injected failure after ads upsert");

  // 6. ad_observations
  if (adObservations.length > 0) {
    await client.query(
      `insert into public.ad_observations (
         ad_ref, collection_run_id, observed_at, record_key, is_active, collation_count,
         display_format, publisher_platform, cta_type, cta_text, title, body_text,
         caption, link_url, link_description, start_date_raw, network_end_date_raw,
         media, collector_meta
       )
       select ad_ref, run_id, seen, rec_key, active, coll, fmt,
              jsonb_text_array(platform), cta_t, cta_x, ttl, body, cap,
              url, link_desc, start_raw, end_raw, media_json, meta_json
         from unnest(
           $1::uuid[], $2::uuid[], $3::timestamptz[], $4::text[], $5::boolean[], $6::int[],
           $7::text[], $8::jsonb[], $9::text[], $10::text[], $11::text[], $12::text[],
           $13::text[], $14::text[], $15::text[], $16::text[], $17::text[],
           $18::jsonb[], $19::jsonb[]
         ) as t(ad_ref, run_id, seen, rec_key, active, coll, fmt, platform, cta_t, cta_x,
                ttl, body, cap, url, link_desc, start_raw, end_raw, media_json, meta_json)`,
      [
        adObservations.map((obs) => adRefs.get(obs.adArchiveId)),
        adObservations.map(() => collectionRunId),
        adObservations.map(() => collectedAt),
        adObservations.map((obs) => obs.provenance.recordKey),
        adObservations.map((obs) => obs.isActive),
        adObservations.map((obs) => obs.collationCount),
        adObservations.map((obs) => obs.displayFormat),
        adObservations.map((obs) => JSON.stringify(obs.publisherPlatform)),
        adObservations.map((obs) => obs.ctaType),
        adObservations.map((obs) => obs.ctaText),
        adObservations.map((obs) => obs.title),
        adObservations.map((obs) => obs.bodyText),
        adObservations.map((obs) => obs.caption),
        adObservations.map((obs) => obs.linkUrl),
        adObservations.map((obs) => obs.linkDescription),
        adObservations.map((obs) => obs.provenance.startDateRaw),
        adObservations.map((obs) => obs.provenance.networkEndDateRaw),
        adObservations.map((obs) => JSON.stringify(obs.media)),
        adObservations.map((obs) => JSON.stringify(obs.provenance.collectorMeta)),
      ],
    );
  }

  // 7. dataset_ads
  if (ads.length > 0) {
    await client.query(
      `insert into public.dataset_ads (dataset_id, ad_ref)
       select * from unnest($1::uuid[], $2::uuid[])
       on conflict (dataset_id, ad_ref) do nothing`,
      [ads.map(() => datasetId), ads.map((ad) => adRefs.get(ad.adArchiveId))],
    );
  }

  // 8. dataset_quality — server calculator only. The collector's own
  //    quality_summary stays provenance on the run and is never canonical.
  const coverage = computeCoverage(canonical);
  if (coverage.length > 0) {
    await client.query(
      `insert into public.dataset_quality (dataset_id, field, present_count, total_count, tier)
       select * from unnest($1::uuid[], $2::text[], $3::int[], $4::int[], $5::text[])`,
      [
        coverage.map(() => datasetId),
        coverage.map((row) => row.field),
        coverage.map((row) => row.presentCount),
        coverage.map((row) => row.totalCount),
        coverage.map((row) => row.tier),
      ],
    );
  }

  // 9. import_quarantine
  const reasons: Record<string, number> = {};
  for (const row of canonical.quarantine) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  }
  if (canonical.quarantine.length > 0) {
    await client.query(
      `insert into public.import_quarantine (collection_run_id, reason, payload)
       select * from unnest($1::uuid[], $2::text[], $3::jsonb[])`,
      [
        canonical.quarantine.map(() => collectionRunId),
        canonical.quarantine.map((row) => row.reason),
        canonical.quarantine.map((row) => JSON.stringify(row.payload)),
      ],
    );
  }

  // 10. audit_logs
  await client.query(
    `insert into public.audit_logs (actor, action, entity_type, entity_id, after)
     values ($1,'import.commit','dataset',$2,$3)`,
    [
      actorId, datasetId,
      {
        collectionRunId, ads: ads.length, pages: pages.length,
        quarantined: canonical.quarantine.length,
      },
    ],
  );

  if (options.failAt === "before_commit") throw new Error("injected failure before commit");

  return {
    datasetId,
    collectionRunId,
    saved: {
      ads: ads.length,
      pages: pages.length,
      adObservations: adObservations.length,
      pageObservations: pageObservations.length,
    },
    quarantined: { count: canonical.quarantine.length, reasons },
    status,
  };
}

/** Keeps the first entry per key, in source order. */
function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}
