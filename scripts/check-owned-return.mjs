import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Read-only: keep one real identity; browser listing pages are navigation fixtures, never screenshot evidence.
const origin = process.env.LIBRARY_CHECK_URL ?? 'http://localhost:3188';
const browser = await chromium.launch();
let stage = 'stored owned seed';
try {
  const context = await browser.newContext({ storageState: process.env.LIBRARY_CHECK_AUTH ?? 'e2e/.auth/trial.json' });
  const page = await context.newPage();
  await page.goto(origin + '/owned-ads', { waitUntil: 'domcontentloaded' });
  const response = await context.request.get(origin + '/api/owned-ads/library?spend=reported');
  assert.equal(response.status(), 200, 'An authenticated stored company ad is required');
  const library = await response.json(), seed = library.rows[0];
  assert.ok(seed?.account_id && seed?.ad_id && library.snapshot, 'The library needs one real company ad');
  assert.ok(library.snapshot.accounts.some(account => account.id === seed.account_id), 'The stored account identity must be available');
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message.split('\n')[0]));
  await page.route('**/api/owned-ads/media', route => route.abort());
  await page.route('**/api/owned-ads/library?*', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const index = Number(params.get('page') ?? 0);
    return route.fulfill({ json: { snapshot: library.snapshot, progress: null, rows: index < 3 ? [seed] : [], total: 72, page: index, pageSize: 24 } });
  });
  const filters = { q: 'owned-return-check', account: seed.account_id, status: 'PAUSED', spend: 'all', page: '1' };
  const checkbox = page.getByRole('checkbox', { name: 'มีค่าแอดในช่วงผลลัพธ์ · ปิดเพื่อดูแอดทั้งคลัง', exact: true });
  async function restored(expected) {
    await page.waitForURL(url => url.pathname === '/owned-ads' && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value));
    await expect(page.getByTestId('company-search'), 'Restored search must match its URL').toHaveValue(expected.q);
    await expect(page.getByTestId('company-account'), 'Restored account must match its exact URL identity').toHaveValue(expected.account);
    await expect(page.getByTestId('company-status'), 'Restored status must match its URL').toHaveValue(expected.status);
    if (expected.spend === 'all') await expect(checkbox).not.toBeChecked(); else await expect(checkbox).toBeChecked();
    await expect(page.getByTestId('company-count')).toContainText(`หน้า ${Number(expected.page) + 1} / 3`);
    await expect(page.getByTestId('company-grid').locator('article')).toHaveCount(1);
    assert.ok(requests.some(params => Object.entries(expected).every(([key, value]) => params.get(key) === value)), 'The listing request must contain the restored filters');
  }
  async function compareHref(link) {
    const url = new URL(await link.getAttribute('href'), origin);
    assert.equal(url.pathname, '/compare/ads');
    assert.equal(url.searchParams.get('account'), seed.account_id);
    assert.equal(url.searchParams.get('owned'), seed.ad_id);
    const back = new URL(url.searchParams.get('returnTo'), origin);
    assert.equal(back.pathname, '/owned-ads');
    assert.deepEqual([...back.searchParams].sort(), Object.entries(filters).sort());
  }
  async function comparisonOpened() {
    stage = 'comparison seed restored';
    await page.waitForURL(url => url.pathname === '/compare/ads' && url.searchParams.get('account') === seed.account_id && url.searchParams.get('owned') === seed.ad_id);
    await expect(page.getByTestId('compare-step-rival')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('compare-step-owned')).toBeEnabled();
    await expect(page.locator('p[role="alert"]'), 'The selected real company ad must open without a comparison error').toHaveCount(0);
  }
  stage = 'saved filters and second page';
  await page.goto(origin + '/owned-ads?' + new URLSearchParams(filters), { waitUntil: 'domcontentloaded' });
  await restored(filters);
  stage = 'pagination URL and reload';
  await page.getByTestId('company-next').click();
  filters.page = '2';
  await restored(filters);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await restored(filters);
  stage = 'detail comparison and cached browser Back';
  await page.getByTestId('company-grid').getByRole('button', { name: 'ดูรายละเอียด →', exact: true }).first().click();
  const detailCompare = page.getByTestId('company-detail').getByRole('link', { name: 'เทียบแอดนี้กับคู่แข่ง →', exact: true });
  await compareHref(detailCompare);
  await detailCompare.click();
  await comparisonOpened();
  stage = 'cached browser Back';
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await restored(filters);
  if (await page.getByTestId('company-detail').count()) await page.keyboard.press('Escape');
  stage = 'card comparison and explicit return Link';
  const cardCompare = page.getByTestId('company-grid').getByRole('link', { name: 'เลือกเปรียบเทียบ', exact: true }).first();
  await compareHref(cardCompare);
  await cardCompare.click();
  await comparisonOpened();
  stage = 'explicit comparison return Link';
  const back = page.getByTestId('comparison-return');
  await expect(back).toBeVisible();
  assert.deepEqual([...new URL(await back.getAttribute('href'), origin).searchParams].sort(), Object.entries(filters).sort());
  await back.click();
  await restored(filters);
  stage = 'previous page and spend checkbox URL edits';
  await page.getByTestId('company-prev').click();
  filters.page = '1';
  await restored(filters);
  await checkbox.check();
  filters.spend = 'reported'; filters.page = '0';
  await restored(filters);
  await page.getByTestId('company-next').click();
  filters.page = '1';
  await restored(filters);
  await checkbox.uncheck();
  filters.spend = 'all'; filters.page = '0';
  await restored(filters);
  stage = 'search URL keeps account and status';
  await page.getByTestId('company-search').fill('updated owned query');
  filters.q = 'updated owned query';
  await restored(filters);
  stage = 'saved page beyond the available results';
  await page.goto(origin + '/owned-ads?' + new URLSearchParams({ ...filters, page: '100' }), { waitUntil: 'domcontentloaded' });
  filters.page = '2';
  await restored(filters);
  assert.deepEqual(errors, []);
  console.log('PASS: owned account/status/search/spend/page URLs, reload, exact comparison seed, detail/card return links, cached Back, explicit return, checkbox page reset and unavailable-page recovery. Browser listing is a fixture; stored data is read only; media provider requests were blocked.');
  await context.close();
} catch (error) {
  // Playwright request errors can include authentication cookies; report only the short reason.
  console.error(`Owned return failed (${stage}):`, error.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
