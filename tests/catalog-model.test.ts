import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogObservationMatches, catalogSearchFilter, catalogSource, type CatalogMembership, type CatalogObservation } from '../lib/read/catalog-model.ts';
import type { ExplorerRow } from '../lib/read/queries.ts';

test('catalog search keeps PostgREST punctuation and SQL wildcards literal', () => {
  assert.equal(catalogSearchFilter('  '), null);
  const pattern = JSON.stringify('%Scotch%');
  assert.equal(catalogSearchFilter(' Scotch '), ['body_text', 'title', 'page_name', 'ad_archive_id'].map(field => `${field}.ilike.${pattern}`).join(','));
  const unsafe = 'x"),is_active.eq.true,body_text.ilike.(100%_\\';
  const literal = unsafe.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
  const quoted = JSON.stringify(`%${literal}%`);
  assert.equal(catalogSearchFilter(unsafe), ['body_text', 'title', 'page_name', 'ad_archive_id'].map(field => `${field}.ilike.${quoted}`).join(','));
});

test('a concurrently replaced observation cannot silently change a selected card snapshot', () => {
  const observation: CatalogObservation = { id: 1, observed_at: '2026-10-01T00:00:00Z', is_active: true,
    display_format: 'IMAGE', publisher_platform: ['FACEBOOK'], cta_type: 'SHOP_NOW', cta_text: 'ซื้อเลย',
    title: 'โปรเดิม', body_text: 'ราคา 390', media: { images: [{ resized_image_url: 'https://example.com/old.jpg' }] } };
  const row = { ...observation } as unknown as ExplorerRow;
  assert.equal(catalogObservationMatches(row, observation), true);
  assert.equal(catalogObservationMatches(row, { ...observation, body_text: 'ราคา 490' }), false);
  assert.equal(catalogObservationMatches(row, { ...observation, media: { images: [{ resized_image_url: 'https://example.com/new.jpg' }] } }), false);
  assert.equal(catalogObservationMatches(row, { ...observation, is_active: false }), false);
});

test('catalog pinning never reopens newer copy through an older or unrelated dataset', () => {
  const membership = (ad: string, dataset: string, run: string): CatalogMembership => ({
    ad_ref: ad, dataset_id: dataset,
    dataset: { id: dataset, name: dataset, collection_run_id: run, run: { collected_at: '2026-10-01T00:00:00Z' } },
  });
  const rows = [membership('ad', 'old', 'old-run'), membership('other', 'foreign', 'new-run'),
    membership('ad', 'z-new', 'new-run'), membership('ad', 'a-new', 'new-run')];
  assert.equal(catalogSource('ad', 'new-run', rows)?.dataset_id, 'a-new');
  assert.equal(catalogSource('ad', 'new-run', rows, 'z-new')?.dataset_id, 'z-new');
  assert.equal(catalogSource('ad', 'new-run', rows, 'old'), null);
  assert.equal(catalogSource('missing', 'new-run', rows), null);
});
