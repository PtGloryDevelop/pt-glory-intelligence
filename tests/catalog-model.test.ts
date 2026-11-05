import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogMediaFilter, catalogObservationMatches, catalogPageKey, catalogSearchFilter, catalogSource, type CatalogMembership, type CatalogObservation } from '../lib/read/catalog-model.ts';
import type { ExplorerRow } from '../lib/read/queries.ts';
import { mediaFilter } from '../lib/read/request.ts';

test('views of new-this-week within the day share a kept page; other days, rounds and filters do not', () => {
  const at = (firstSeenSince: string, stamp = '16:t', limit = 6) => catalogPageKey(stamp, { firstSeenSince, limit } as { firstSeenSince: string });
  assert.equal(at('2026-10-28T10:15:01.123Z'), at('2026-10-28T10:59:44.900Z'));
  assert.notEqual(at('2026-10-28T23:59:59.900Z'), at('2026-10-29T00:00:00.000Z'));
  assert.notEqual(at('2026-10-28T10:15:01.123Z'), at('2026-10-28T10:15:01.123Z', '17:t'));
  assert.notEqual(at('2026-10-28T10:15:01.123Z'), at('2026-10-28T10:15:01.123Z', '16:t', 4));
});

test('kept pages of the catalog are not shared across media or page filters', () => {
  const at = (options: object) => catalogPageKey('16:t', options);
  assert.notEqual(at({ media: 'image' }), at({ media: 'video' }));
  assert.notEqual(at({ media: 'image' }), at({}));
  assert.notEqual(at({ pageIds: ['1'] }), at({ pageIds: ['1', '2'] }));
});

test('every collected display_format answers to the media filter that describes it', () => {
  const matches = (media: 'image' | 'video' | 'other', format: string | null) => {
    const filter = catalogMediaFilter(media)!;
    const listed = (group: string) => (filter.match(new RegExp(group + '\\(([^)]*)\\)'))?.[1] ?? '').split(',');
    return media === 'other' ? format === null || !listed('not\\.in\\.').includes(format) : format !== null && listed('\\.in\\.').includes(format);
  };
  const expected: [string | null, boolean, boolean, boolean][] = [
    ['IMAGE', true, false, false], ['MULTI_IMAGES', true, false, false],
    ['VIDEO', false, true, false], ['MULTI_VIDEOS', false, true, false],
    ['MULTI_MEDIAS', true, true, false],
    ['CAROUSEL', false, false, true], ['DPA', false, false, true], ['DCO', false, false, true],
    ['PAGE_LIKE', false, false, true], ['TEXT', false, false, true], [null, false, false, true],
  ];
  for (const [format, image, video, other] of expected) {
    assert.deepEqual([matches('image', format), matches('video', format), matches('other', format)], [image, video, other], String(format));
  }
  assert.equal(catalogMediaFilter(null), null);
});

test('the media filter refuses a word it cannot read instead of widening the list', () => {
  assert.deepEqual(mediaFilter(null), { ok: true, value: null });
  assert.deepEqual(mediaFilter('video'), { ok: true, value: 'video' });
  for (const bad of ['', 'VIDEO', 'audio']) assert.deepEqual(mediaFilter(bad), { ok: false });
});

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
