import pg from "pg";
import { normalize } from "../../lib/collector/normalize.ts";
import { validate } from "../../lib/collector/validate.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { goldenExport } from "../fixtures/load.ts";

/** Tables whose counts a rollback proof must leave untouched. */
export const WRITTEN_TABLES = [
  "collection_runs", "datasets", "pages", "page_observations", "ads",
  "ad_observations", "dataset_ads", "dataset_quality", "import_quarantine",
  "audit_logs",
] as const;

export type TableCounts = Record<string, number>;

export async function countAll(client: pg.Client): Promise<TableCounts> {
  const counts: TableCounts = {};
  for (const table of WRITTEN_TABLES) {
    const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
    counts[table] = Number(rows[0].n);
  }
  return counts;
}

/**
 * Distinguishes a broken pooler from a broken assertion.
 *
 * The DEV pooler drops DNS and times out intermittently. Reporting that as a
 * test failure would be a false alarm, and retrying inside the app would hide
 * real faults, so connection errors are surfaced under their own name.
 */
export function isInfrastructureError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET"
    || code === "ECONNREFUSED" || code === "EAI_AGAIN";
}

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    if (isInfrastructureError(error)) {
      throw new Error(`INFRASTRUCTURE: cannot reach the database (${(error as Error).message})`);
    }
    throw error;
  }
  return client;
}

/** Wipes every table this gate writes to, so each case starts from zero. */
export async function resetTables(client: pg.Client): Promise<void> {
  await client.query(`truncate table
    public.audit_logs, public.import_quarantine, public.dataset_quality,
    public.dataset_ads, public.ad_observations, public.ads,
    public.page_observations, public.pages, public.datasets,
    public.collection_runs, public.categories
    restart identity cascade`);
}

export async function seedCategory(client: pg.Client, name = "gate-c"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  return rows[0].id;
}

/** The pinned 500-ad export, validated and normalized. */
export function goldenCanonical(overrides: { collectedAt?: string } = {}): CanonicalImport {
  const file = goldenExport();
  if (overrides.collectedAt) file.generated_at = overrides.collectedAt;
  const result = validate(file);
  if (!result.ok) throw new Error(`golden fixture failed validation: ${result.reason}`);
  return normalize(result.file);
}

/** A one-ad canonical import, for ordering and monotonicity cases. */
export function singleAdCanonical(options: {
  collectedAt: string;
  isActive?: boolean | null;
  displayFormat?: string | null;
  publisherPlatform?: string[];
  collationId?: string | null;
  pageProfileUri?: string | null;
  pageProfileNumericId?: string | null;
  adArchiveId?: string;
  pageId?: string;
}): CanonicalImport {
  const adArchiveId = options.adArchiveId ?? "900000000000001";
  const pageId = options.pageId ?? "910000000000001";
  return {
    run: {
      sourceProduct: "PT Glory Meta Ad Library Extension",
      collectionMethod: "network_response_observation",
      collectorSchemaVersion: "pt-glory-meta-ad-library-export.v1",
      sourceUrl: null,
      completenessClaim: null,
      scope: { country: "TH", query: null, activeStatus: null, adType: null, mediaType: null },
      collectedAt: options.collectedAt,
      stopReason: null,
      reported: { sourceRows: 1, uniqueAds: 1, uniquePages: 1, unresolvedCount: 0, qualitySummary: null },
      computed: { sourceRows: 1, uniqueAds: 1, uniquePages: 1, unresolvedCount: 0 },
    },
    pages: [{
      pageId,
      pageProfileNumericId: options.pageProfileNumericId ?? null,
      pageProfileUri: options.pageProfileUri ?? null,
    }],
    pageObservations: [{
      pageId, pageName: "Ordering Page", pageLikeCount: 10, pageCategories: ["Health/beauty"],
    }],
    ads: [{
      adArchiveId,
      pageId,
      collationId: options.collationId ?? null,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: null,
      isActive: options.isActive ?? null,
      displayFormat: options.displayFormat ?? null,
      publisherPlatform: options.publisherPlatform ?? [],
    }],
    adObservations: [{
      adArchiveId,
      isActive: options.isActive ?? null,
      collationCount: 1,
      displayFormat: options.displayFormat ?? null,
      publisherPlatform: options.publisherPlatform ?? [],
      ctaType: null, ctaText: null, title: null, bodyText: "ordering fixture",
      caption: null, linkUrl: null, linkDescription: null,
      media: { images: [], videos: [], cards: [] },
      provenance: { recordKey: `ad:${adArchiveId}`, startDateRaw: null, networkEndDateRaw: null, collectorMeta: null },
    }],
    quarantine: [],
  };
}
