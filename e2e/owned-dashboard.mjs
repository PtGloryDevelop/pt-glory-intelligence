/** Isolated browser/API check. Auth/PostgREST are local test doubles, not a proof of SQL/RLS. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:3188';
const users = { analyst: '10000000-0000-4000-8000-000000000001', viewer: '10000000-0000-4000-8000-000000000002' };
const reports = new Map();
let writes = 0;
let storeAvailable = true;
const service = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54321');
  let subject;
  try { subject = JSON.parse(Buffer.from(req.headers.authorization.split('.')[1], 'base64url')).sub; } catch { /* no session */ }
  const role = Object.keys(users).find((key) => users[key] === subject);
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!role) return reply(401, { message: 'Test session required' });
  if (url.pathname === '/auth/v1/user') return reply(200, { id: subject, aud: 'authenticated', role: 'authenticated', email: `${role}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-09-28T00:00:00Z' });
  if (url.pathname === '/rest/v1/user_roles') return reply(200, { role });
  if (url.pathname === '/rest/v1/owned_ad_reports') {
    if (!storeAvailable) return reply(503, { code: '42P01', message: 'Test unavailable' });
    if (role !== 'analyst') return reply(403, { code: '42501' });
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      const report = { ...input, id: randomUUID(), imported_at: new Date().toISOString(), row_count: input.rows.length };
      reports.set(report.id, report); writes += 1;
      return reply(201, report);
    }
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (id) return reply(200, reports.get(id) ?? null);
    return reply(200, [...reports.values()].reverse().map((report) => {
      const summary = { ...report }; delete summary.rows; return summary;
    }));
  }
  if (url.pathname === '/rest/v1/rpc/dataset_list') return reply(200, [
    { dataset_id: '20000000-0000-4000-8000-000000000001', dataset_name: 'รอบประเทศไทยทดสอบ', scope_country: 'TH', scope_query: 'ทดสอบ', collected_at: '2026-09-28T00:00:00Z', quality_tier: 'unknown', ads_in_dataset: 0, pages_in_dataset: 0, category_name: 'สุขภาพ', collection_method: 'user_initiated_dom_observation' },
    { dataset_id: '20000000-0000-4000-8000-000000000002', dataset_name: 'US test excluded', scope_country: 'US', collected_at: '2026-09-29T00:00:00Z' },
  ]);
  if (['/rest/v1/dataset_quality', '/rest/v1/rpc/dataset_ads_page', '/rest/v1/rpc/dataset_ads_facets'].includes(url.pathname)) return reply(200, []);
  return reply(404, { message: 'No test double for this route' });
});
await new Promise((resolve, reject) => service.once('error', reject).listen(54321, '127.0.0.1', resolve));
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3188'], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-key', DATABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '', APIFY_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverLog = '';
app.stdout.on('data', (chunk) => { serverLog += chunk; });
app.stderr.on('data', (chunk) => { serverLog += chunk; });
let browser;
try {
  for (let attempt = 0; ; attempt += 1) {
    try { if ((await fetch(`${origin}/login`)).ok) break; } catch { /* wait for server */ }
    if (attempt > 90 || app.exitCode !== null) throw new Error(`Test app did not start: ${serverLog.slice(-1000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch();
  async function context(role) {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 1100 } });
    if (role) {
      const user = { id: users[role], aud: 'authenticated', role: 'authenticated', email: `${role}@example.test` };
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated' })).toString('base64url')}.local-test-signature`;
      const session = { access_token: jwt, refresh_token: 'local-test', token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
      await ctx.addCookies([{ name: 'sb-127-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' }]);
    }
    return ctx;
  }
  const guest = await context();
  assert.equal((await guest.request.get(`${origin}/api/owned-ads/reports`)).status(), 401);
  await guest.close();
  const viewer = await context('viewer');
  assert.equal((await viewer.request.get(`${origin}/api/owned-ads/reports`)).status(), 403);
  assert.equal((await viewer.request.post(`${origin}/api/owned-ads/reports`, { data: {} })).status(), 403);
  const deniedPage = await viewer.newPage();
  assert.equal((await deniedPage.goto(`${origin}/owned-ads`)).status(), 403);
  await viewer.close();
  const ctx = await context('analyst');
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/owned-ads`);
  await page.getByTestId('owned-empty').waitFor();
  const csv = 'ad_id,ad_name,campaign_name,spend,purchase_value,conversations,clicks,impressions\n101,ข้อมูลทดสอบ เซรั่ม,ทดสอบผิว,100,300,2,10,1000\n102,ข้อมูลทดสอบ อาหารเสริม,ทดสอบสุขภาพ,900,900,18,90,9000';
  await page.getByLabel('ชื่อรายงาน', { exact: true }).fill('ข้อมูลทดสอบ ไม่ใช่ผลจริง');
  await page.getByLabel('ชื่อบัญชีโฆษณา', { exact: true }).fill('บัญชีทดสอบ');
  await page.getByLabel('ตั้งแต่วันที่', { exact: true }).fill('2026-09-01');
  await page.getByLabel('ถึงวันที่', { exact: true }).fill('2026-09-28');
  await page.getByTestId('owned-file').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByTestId('owned-preview-submit').click();
  await page.getByTestId('owned-preview-status').waitFor();
  assert.equal(writes, 0, 'Preview must not persist data');
  assert.match(await page.getByTestId('owned-kpi-spend').innerText(), /1,000/);
  assert.match(await page.getByTestId('owned-kpi-roas').innerText(), /1\.2/);
  await page.getByTestId('owned-search').fill('เซรั่ม');
  assert.equal(await page.getByTestId('owned-grid').locator('article').count(), 1);
  assert.match(await page.getByTestId('owned-kpi-roas').innerText(), /3/);
  await page.getByTestId('owned-search').fill('');
  await page.getByTestId('owned-campaign').selectOption('ทดสอบสุขภาพ');
  assert.equal(await page.getByTestId('owned-grid').locator('article').count(), 1);
  await page.getByTestId('owned-campaign').selectOption('');
  await page.getByTestId('owned-view-table').click();
  assert.equal(await page.getByTestId('owned-table').locator('tbody tr').count(), 2);
  await page.getByTestId('owned-table').getByRole('button').first().click();
  await page.getByTestId('owned-detail').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('owned-detail').waitFor({ state: 'detached' });
  await page.getByTestId('owned-view-grid').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mkdir('test-artifacts/owned-ads', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/owned-ads/desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.querySelector('[data-testid="app-sidebar"]').getBoundingClientRect().right <= 1), 'Mobile sidebar must start closed');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile page must not overflow');
  await page.screenshot({ path: 'test-artifacts/owned-ads/mobile.png', fullPage: true, animations: 'disabled' });
  storeAvailable = false;
  await page.getByTestId('owned-import-submit').click();
  await page.getByTestId('owned-import-error').waitFor();
  assert.equal(writes, 0); assert.ok(await page.getByTestId('owned-preview-status').isVisible());
  storeAvailable = true;
  await page.getByTestId('owned-import-submit').click();
  await page.getByTestId('owned-preview-status').waitFor({ state: 'detached' });
  assert.equal(writes, 1);
  await page.reload();
  await page.getByTestId('owned-grid').waitFor();
  assert.equal(await page.getByTestId('owned-grid').locator('article').count(), 2);
  assert.match(await page.getByTestId('owned-kpi-roas').innerText(), /1\.2/);
  const invalid = await ctx.request.post(`${origin}/api/owned-ads/reports`, { data: { name: 'invalid', account_name: 'test', currency: 'THB', date_start: '2026-09-01', date_end: '2026-09-28', csv: csv + '\n101,duplicate,test,1,1,1,1,1' } });
  assert.equal(invalid.status(), 400); assert.equal(writes, 1);
  await page.goto(`${origin}/competitors`);
  await page.getByRole('heading', { name: 'แอดคู่แข่ง', exact: true }).waitFor();
  assert.equal(await page.locator('#competitor-dataset option').count(), 1, 'Only Thailand snapshots');
  await page.getByTestId('filter-search').fill('ค้นทดสอบ');
  await page.waitForURL((url) => url.searchParams.get('dataset') === '20000000-0000-4000-8000-000000000001' && url.searchParams.has('search'));
  assert.deepEqual(pageErrors, []);
  console.log('PASS: preview, filters, weighted KPI, table, detail, mobile, save failure/retry/reload, malformed import, guest/viewer guards. Auth/DB mocked locally; SQL RLS still requires real DB verification.');
  await ctx.close();
} finally {
  await browser?.close(); app.kill(); service.closeAllConnections(); await new Promise((resolve) => service.close(resolve));
}
