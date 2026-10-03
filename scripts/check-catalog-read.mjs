/** Read-only proof against an already running build. No seed, provider call,
 * write to application data, or auth credential is printed by this script. */
import assert from 'node:assert/strict';
import { request } from '@playwright/test';

const baseURL = process.env.CATALOG_CHECK_URL ?? 'http://localhost:3188';
const api = await request.newContext({ baseURL, storageState: 'e2e/.auth/trial.json', timeout: 30_000 });
try {
  const get = async (path) => {
    const started = performance.now();
    const response = await api.get(path);
    assert.equal(response.status(), 200, `${path} must return JSON successfully`);
    const body = await response.json();
    console.log(JSON.stringify({ path, ms: Math.round(performance.now() - started), total: body.total, rows: body.rows?.length }));
    return body;
  };
  const first = await get('/api/catalog/ads');
  assert.equal(first.rows.length, Math.min(first.total, 24));
  assert.equal(new Set(first.rows.map(row => row.ad_archive_id)).size, first.rows.length);
  assert.ok(first.rows.every(row => row.dataset_id && row.collection_run_id && row.observed_at));
  const second = await get('/api/catalog/ads?offset=24');
  assert.equal(second.total, first.total);
  assert.ok(second.rows.every(row => !first.rows.some(other => other.ad_archive_id === row.ad_archive_id)));
  if (first.rows.length) {
    const selected = first.rows[0];
    const exact = await get(`/api/catalog/ads?ad=${selected.ad_archive_id}&limit=1`);
    assert.equal(exact.total, 1);
    assert.equal(exact.rows[0].dataset_id, selected.dataset_id);
    const source = await get(`/api/ads/${selected.ad_archive_id}?datasetId=${selected.dataset_id}`);
    assert.equal(source.detail.collection_run_id, selected.collection_run_id);
    assert.equal(source.detail.body_text, selected.body_text);
    assert.deepEqual(source.detail.media, selected.media);
    const copySearch = await get(`/api/catalog/ads?search=${selected.ad_archive_id}`);
    assert.ok(copySearch.rows.some(row => row.ad_archive_id === selected.ad_archive_id));
  }
  await get('/api/catalog/ads?search=' + encodeURIComponent('x"),is_active.eq.true,body_text.ilike.(100%_\\'));
  const capped = await get('/api/catalog/ads?limit=100000');
  assert.equal(capped.limit, 24);
  assert.ok(capped.rows.length <= 24);
  const outside = await get('/api/catalog/ads?offset=100000');
  assert.equal(outside.total, first.total);
  assert.equal(outside.rows.length, 0);
  for (const active of ['active', 'inactive', 'unknown']) {
    const page = await get('/api/catalog/ads?active=' + active);
    assert.ok(page.rows.every(row => row.is_active === (active === 'unknown' ? null : active === 'active')));
  }
  assert.equal((await api.get('/api/catalog/ads?ad=bad')).status(), 400);
  assert.equal((await api.get('/api/catalog/ads?active=bad')).status(), 400);
  const dashboard = await get('/api/dashboard');
  assert.ok(!dashboard.errors.includes('rivalAds'));
  const recent = dashboard.rivals.recentAds;
  assert.ok(recent.length <= 6);
  assert.ok(recent.every(row => row.dataset_id && row.observed_at && Date.parse(row.first_seen_at)>=Date.parse(dashboard.rivals.week.from)));
  const week=await get('/api/catalog/ads?period=week');
  assert.equal(week.total,dashboard.rivals.week.newAds);
  const anon = await request.newContext({ baseURL });
  try { assert.equal((await anon.get('/api/catalog/ads')).status(), 401); }
  finally { await anon.dispose(); }
  console.log('Catalog search, pagination, latest source pinning and anonymous denial passed.');
} catch (error) {
  console.error('Catalog proof failed:', String(error.message).split('\n')[0]);
  process.exitCode = 1;
} finally { await api.dispose(); }
