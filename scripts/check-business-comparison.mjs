import assert from 'node:assert/strict';
import { chromium,expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.env.COMPARISON_CHECK_URL ?? 'http://localhost:3188';
const browser = await chromium.launch();
const hypothesis = 'ทดสอบข้อความโดยคงข้อเสนอเดิม';
const fields = {
  'compare-product': 'สินค้าสำหรับการทดลองคู่แอด',
  'compare-our-offer': 'ข้อเสนอเดิมของเรา',
  'compare-their-offer': 'ข้อเสนอที่ทีมพบในแอดคู่แข่ง',
  'compare-hypothesis': hypothesis,
  'compare-success': 'ประเมินต้นทุนต่อบทสนทนาและ ROAS ของเรา หลัง 7 วัน',
};
async function savedSelection(page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(value => value.startsWith('pt-glory-comparison-selection:'));
    return key ? { key, ...JSON.parse(sessionStorage.getItem(key)) } : null;
  });
}
let draftPhase=0;
async function assertDraft(page) {
  draftPhase++;
  // SSR deliberately has no browser draft. Await hydration of the exact pair.
  for (const [id, value] of Object.entries(fields)) await expect(page.getByTestId(id),id+' restored stage '+draftPhase).toHaveValue(value);
  await expect(page.getByTestId('compare-decision')).toHaveValue('ทดลองครีเอทีฟใหม่');
}
try {
  const context = await browser.newContext({ storageState: 'e2e/.auth/trial.json', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
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
  await page.getByTestId('compare-business').waitFor();
  for (const id of ['compare-owned-copy', 'compare-rival-copy']) {
    assert.ok(await page.getByTestId(id).isVisible());
    assert.equal(await page.getByTestId(id).locator('xpath=ancestor::details').count(), 0, 'Ad copy must remain open in the workspace');
  }
  for (const [id, value] of Object.entries(fields)) await page.getByTestId(id).fill(value);
  await page.getByTestId('compare-decision').selectOption('ทดลองครีเอทีฟใหม่');
  assert.equal(await page.getByTestId('compare-hypothesis').evaluate(element => element.value), hypothesis);
  const download = page.waitForEvent('download');
  await page.getByTestId('compare-download').click();
  const file = await download;
  const text = await readFile(await file.path(), 'utf8');
  for (const value of Object.values(fields)) assert.ok(text.includes(value));
  assert.ok(text.includes('ยังไม่มีข้อมูลค่าแอด ยอดขาย หรือ ROAS ของคู่แข่ง'));
  const saved = await savedSelection(page);
  assert.ok(saved);
  assert.equal(saved.owned, selectedOwn.replace('compare-own-', ''));
  assert.equal(saved.rival, selectedRival.replace('compare-rival-', ''));
  assert.deepEqual(Object.keys(saved).sort(), ['account', 'dataset', 'key', 'owned', 'rival']);
  const pairUrl = base + '/compare/ads?' + new URLSearchParams({ account: saved.account, owned: saved.owned, dataset: saved.dataset, rival: saved.rival });

  await page.getByTestId('compare-step-owned').click();
  await page.getByTestId('compare-owned-search').fill('unmatched-search-987654321');
  await page.getByRole('button', { name: 'ค้นหาแอดเรา', exact: true }).click();
  await page.getByTestId('compare-owned-empty').waitFor();
  assert.ok(await page.getByTestId('compare-selection-tray').isVisible());
  await page.getByTestId('compare-step-review').click();
  await assertDraft(page);
  // A link for the other side keeps this user's own selection and exact-pair draft.
  await page.goto(base + '/owned-ads');
  await page.goto(base + '/compare/ads?' + new URLSearchParams({ dataset: saved.dataset, rival: saved.rival }));
  await page.getByTestId('compare-owned-evidence').waitFor();
  assert.ok((await page.getByTestId('compare-owned-evidence').textContent()).includes(saved.owned));
  await assertDraft(page);
  await page.reload();
  await page.getByTestId('compare-business').waitFor();
  await assertDraft(page);

  // Global search must use the catalog, without requiring a dataset selection.
  await page.getByTestId('compare-step-rival').click();
  await rival.getByRole('button').first().waitFor();
  const searched = page.waitForResponse(response => response.url().includes('/api/catalog/ads?') && new URL(response.url()).searchParams.get('search') === 'Scotch');
  await page.getByTestId('compare-rival-search').fill('Scotch');
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
  await assertDraft(page);
  assert.equal((await savedSelection(page)).dataset, saved.dataset);

  // A different pair begins with its own blank draft; returning restores the first pair.
  await page.getByTestId('compare-step-owned').click();
  await own.getByRole('button').nth(1).waitFor();
  await own.getByRole('button').nth(1).click();
  await page.getByTestId('compare-business').waitFor();
  assert.equal(await page.getByTestId('compare-hypothesis').inputValue(), '');
  await page.getByTestId('compare-hypothesis').fill('แผนของคู่แอดอีกชุด');
  await page.goto(pairUrl);
  await page.getByTestId('compare-business').waitFor();
  await assertDraft(page);
  const draftKeys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pt-glory-comparison-draft:')));
  assert.equal(draftKeys.length, 2);
  assert.ok(draftKeys.every(key => key.includes(saved.key.replace('pt-glory-comparison-selection:', ''))));
  const storedFields = await page.evaluate(key => Object.keys(JSON.parse(sessionStorage.getItem(key))).sort(), draftKeys[0]);
  assert.deepEqual(storedFields, ['decision', 'hypothesis', 'ourOffer', 'product', 'success', 'theirOffer']);

  // Storage-denied browsers still allow typing and downloading the in-memory manual draft.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('pt-glory-comparison-draft:')) throw new DOMException('Storage blocked', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.getByTestId('compare-hypothesis').fill('ร่างยังพิมพ์ได้เมื่อเบราว์เซอร์ปิดการเก็บข้อมูล');
  assert.equal(await page.getByTestId('compare-hypothesis').inputValue(), 'ร่างยังพิมพ์ได้เมื่อเบราว์เซอร์ปิดการเก็บข้อมูล');
  assert.ok((await page.getByTestId('compare-draft-status').textContent()).includes('บันทึกร่างในเบราว์เซอร์ไม่ได้'));
  const fallbackDownload = page.waitForEvent('download');
  await page.getByTestId('compare-download').click();
  assert.ok((await readFile(await (await fallbackDownload).path(), 'utf8')).includes('ร่างยังพิมพ์ได้เมื่อเบราว์เซอร์ปิดการเก็บข้อมูล'));

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
  console.log('Business comparison: catalog search, open copy, exact selected pair, isolated manual drafts, reload, storage-denied fallback, export, responsive layout and auth passed');
} catch (error) {
  console.error('Comparison check failed', error.message.split('\n')[0]);
  process.exitCode = 1;
} finally { await browser.close(); }
