import { searchValue } from './request.ts';
import type { ExplorerRow } from './queries.ts';
import { isDeepStrictEqual } from 'node:util';

/** A selectable catalog card is pinned to a visible dataset and its own run. */
export type CatalogAdRow = Omit<ExplorerRow, 'total_count'> & {
  dataset_id: string; dataset_name: string; collected_at: string;
  collection_run_id: string; observed_at: string | null; archive_url: string | null;
};
export type CatalogMembership = {
  ad_ref: string; dataset_id: string;
  dataset: { id: string; name: string; collection_run_id: string; run: { collected_at: string } };
};
export type CatalogObservation = Pick<ExplorerRow, 'is_active'|'display_format'|'publisher_platform'|'cta_type'|'cta_text'|'title'|'body_text'|'media'> & {
  id: number; observed_at: string;
};

/** A concurrent import must not pair old copy/media with a newer run link. */
export function catalogObservationMatches(row: ExplorerRow, observation: CatalogObservation): boolean {
  return ['is_active', 'display_format', 'cta_type', 'cta_text', 'title', 'body_text'].every(key =>
    row[key as keyof ExplorerRow] === observation[key as keyof CatalogObservation])
    && isDeepStrictEqual(row.publisher_platform ?? [], observation.publisher_platform ?? [])
    && isDeepStrictEqual(row.media, observation.media);
}

/** Quoted PostgREST values keep punctuation in user copy inside the pattern.
 * Escape SQL wildcard characters too, so % and _ remain literal search text. */
export function catalogSearchFilter(raw: string | null | undefined): string | null {
  const value = searchValue(raw ?? null);
  if (!value) return null;
  const literal = value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
  const pattern = JSON.stringify(`%${literal}%`);
  return ['body_text', 'title', 'page_name', 'ad_archive_id'].map(field => `${field}.ilike.${pattern}`).join(',');
}

/** Never pair latest copy with an older dataset merely because it contains the
 * same ad. Multiple datasets may share a run; choose one deterministically. */
export function catalogSource(
  adRef: string, runId: string, memberships: CatalogMembership[], datasetId?: string,
): CatalogMembership | null {
  return memberships.filter(row => row.ad_ref === adRef && row.dataset.collection_run_id === runId
    && (!datasetId || row.dataset_id === datasetId))
    .sort((a, b) => a.dataset_id.localeCompare(b.dataset_id))[0] ?? null;
}
