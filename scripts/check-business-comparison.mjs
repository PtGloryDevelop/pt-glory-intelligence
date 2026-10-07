import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.COMPARISON_CHECK_URL ?? 'http://localhost:3188';
const browser = await chromium.launch();
// Must match ads in the current catalog; collections change over time.
const keyword = process.env.COMPARISON_CHECK_KEYWORD ?? 'ครีม';
async function savedSelection(page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(value => value.startsWith('pt-glory-comparison-selection:'));
    return key ? { key, ...JSON.parse(sessionStorage.getItem(key)) } : null;
  });
}
try {
  const context = await browser.newContext({ storageState: 'e2e/.auth/trial.json', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(base + '/compare/ads');
  const own = page.getByTestId('compare-owned-grid');
  await own.getByRole('button').first().waitFor();
  assert.equal(await page.locator('select[size]').count(), 0, 'Use visual cards instead of a technical picker');
  const selectedOwn = await own.getByRole('button').first().getAttribute('data-testid');
  await own.getByRole('button').first().click();
  const rival = page.getByTestId('compare-rival-grid');
  await rival.getByRole('button').first().waitFor();
  assert.equal(await page.getByTestId('compare-dataset').inputValue(), '', 'Default scope must be the complete catalog');
  assert.ok((await page.getByTestId('compare-rival-scope').textContent()).includes('คลังคู่แข่งทั้งหมด'));
  const selectedRival = await rival.getByRole('button').first().getAttribute('data-testid');
  await rival.getByRole('button').first().click();
  await page.getByTestId('compare-owned-evidence').waitFor();
  await page.getByTestId('compare-rival-evidence').waitFor();
  for (const id of ['compare-owned-copy', 'compare-rival-copy']) {
    assert.ok(await page.getByTestId(id).isVisible());
    assert.equal(await page.getByTestId(id).locator('xpath=ancestor::details').count(), 0, 'Ad copy must remain open in the workspace');
  }
  assert.equal(await page.getByTestId('compare-business').count(), 0, 'The manual test-plan form is retired');
  const saved = await savedSelection(page);
  assert.ok(saved);
  assert.equal(saved.owned, selectedOwn.replace('compare-own-', ''));
  assert.equal(saved.rival, selectedRival.replace('compare-rival-', ''));
  assert.deepEqual(Object.keys(saved).sort(), ['account', 'dataset', 'key', 'owned', 'rival']);

  await page.getByTestId('compare-step-owned').click();
  await page.getByTestId('compare-owned-search').fill('unmatched-search-987654321');
  await page.getByRole('button', { name: 'ค้นหาแอดเรา', exact: true }).click();
  await page.getByTestId('compare-owned-empty').waitFor();
  assert.ok(await page.getByTestId('compare-selection-tray').isVisible());
  // A link for the other side keeps this user's own selection.
  await page.goto(base + '/owned-ads');
  await page.goto(base + '/compare/ads?' + new URLSearchParams({ dataset: saved.dataset, rival: saved.rival }));
  await page.getByTestId('compare-owned-evidence').waitFor();
  assert.ok((await page.getByTestId('compare-owned-evidence').textContent()).includes(saved.owned));

  // Global search must use the catalog, without requiring a dataset selection.
  await page.getByTestId('compare-step-rival').click();
  await rival.getByRole('button').first().waitFor();
  const searched = page.waitForResponse(response => response.url().includes('/api/catalog/ads?') && new URL(response.url()).searchParams.get('search') === keyword);
  await page.getByTestId('compare-rival-search').fill(keyword);
  await page.getByRole('button', { name: 'ค้นหาแอดคู่แข่ง', exact: true }).click();
  const response = await searched;
  assert.equal(response.status(), 200);
  const searchRows = await response.json();
  assert.ok(searchRows.total > 0, 'Known keyword should return ads across the catalog');
  assert.ok(searchRows.rows.every(row => row.dataset_id));
  await rival.getByRole('button').first().waitFor();
  assert.equal(await page.getByTestId('compare-dataset').inputValue(), '');
  assert.equal((await savedSelection(page)).rival, saved.rival);
  // An optional source filter never replaces the pinned comparison.
  const filter = page.locator('details').filter({ has: page.getByTestId('compare-dataset') });
  await filter.locator('summary').click();
  await page.getByTestId('compare-dataset').selectOption(saved.dataset);
  await page.getByTestId('compare-step-review').click();
  await page.getByTestId('compare-copy-link').waitFor();
  assert.equal((await savedSelection(page)).dataset, saved.dataset);

  await mkdir('test-artifacts/comparison-flow', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/comparison-flow/desktop.png', fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Comparison must fit width ' + width);
  }
  await page.screenshot({ path: 'test-artifacts/comparison-flow/mobile.png', fullPage: true });
  const anonymous = await browser.newContext();
  const unauth = await anonymous.request.get(base + '/compare/ads', { maxRedirects: 0 });
  assert.equal(unauth.status(), 307);
  console.log('Business comparison: catalog search, open copy, exact selected pair, share link, responsive layout and auth passed');
} catch (error) {
  console.error('Comparison check failed', error.message.split('\n')[0]);
  process.exitCode = 1;
} finally { await browser.close(); }
