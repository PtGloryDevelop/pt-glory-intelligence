import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Real imported data only. This check never syncs, collects, invokes AI, or plays source video.
const origin = process.env.LIBRARY_CHECK_URL ?? 'http://localhost:3188';
const out = 'test-artifacts/owned-performance';
const browser = await chromium.launch();
let stage = 'authentication';
try {
  const context = await browser.newContext({ storageState: process.env.LIBRARY_CHECK_AUTH ?? 'e2e/.auth/trial.json', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message.split('\n')[0]));
  const settleCreativeGrid = async () => {
    const cards = page.getByTestId('performance-grid').locator('article');
    for (let index = 0; index < await cards.count(); index++) {
      const card = cards.nth(index);
      await card.scrollIntoViewIfNeeded();
      await expect.poll(() => card.evaluate(element => {
        const image = element.querySelector('img');
        if (image) return image.complete && image.naturalWidth > 0;
        return Boolean(element.querySelector('video')) || !element.querySelector('[role="status"]');
      }), { timeout: 60000 }).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
  };
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname === '/login') {
    const credentials = JSON.parse(await readFile('e2e/.auth/trial-credentials.json', 'utf8'));
    await page.locator('input[name=email]').fill(credentials.email);
    await page.locator('input[name=password]').fill(credentials.password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await page.waitForURL(origin + '/');
  }
  await context.storageState({ path: 'e2e/.auth/trial.json' });
  const api = async values => {
    const response = await context.request.get(`${origin}/api/owned-ads/performance?${new URLSearchParams(values)}`, { timeout: 60000 });
    assert.equal(response.status(), 200, `Authenticated ${values.period} performance request must succeed (HTTP ${response.status()})`);
    return response.json();
  };
  const verified = data => {
    assert.ok(typeof data.ready === 'boolean');
    assert.ok(Array.isArray(data.summary) && Array.isArray(data.rows));
    assert.ok(data.rows.length <= data.pageSize && data.pageSize === 24);
    assert.equal(data.summary.reduce((total, item) => total + item.ad_count, 0), data.total, 'All matching ads contribute to the summary');
    for (const item of data.summary) {
      assert.ok(item.daily_rows >= item.ad_count);
      assert.equal(item.close_rate, null, 'Meta purchases cannot become CRM closing rate');
      for (const coverage of Object.values(item.coverage)) assert.ok(coverage.present >= 0 && coverage.present <= coverage.total);
      if (item.spend > 0 && item.purchase_value !== null) assert.ok(Math.abs(item.roas - item.purchase_value / item.spend) < 1e-8, 'ROAS is weighted from matching values and spend');
      if (item.spend !== null && item.conversations > 0) assert.ok(Math.abs(item.cost_per_conversation - item.spend / item.conversations) < 1e-8);
      if (item.video_views !== null && item.impressions > 0) assert.ok(Math.abs(item.hook_rate - item.video_views / item.impressions) < 1e-8);
    }
  };
  stage = 'actual all-period API';
  const all = await api({ period: 'all' });
  verified(all);
  await mkdir(out, { recursive: true });
  await page.goto(origin + '/?period=all', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('performance-kpis')).toBeVisible({ timeout: 60000 });
  assert.ok(await page.getByTestId('performance-period-line').evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('[data-testid="performance-kpis"]')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'The selected performance period appears before its KPI cards');
  await expect(page.getByTestId('performance-close')).toContainText('%ปิด (Meta)');
  for (const label of ['แอดของเรา', 'Command Center', 'ส่องคู่แข่ง', 'เปรียบเทียบแอด', 'รายการติดตาม']) await expect(page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('link', { name: label, exact: true })).toBeVisible();
  if (!all.ready) {
    await expect(page.getByTestId('owned-performance')).toContainText('ชุดข้อมูลนี้ยังไม่มีผลลัพธ์รายวัน');
    await expect(page.getByTestId('performance-grid').locator('article')).toHaveCount(0);
    await expect(page.getByTestId('performance-sales')).toContainText('—');
    await page.screenshot({ path: `${out}/actual-not-ready.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Unavailable source state fits a phone');
    assert.deepEqual(errors, []);
    console.log('PASS: actual source readiness guard, empty KPIs, unavailable CRM, primary navigation and mobile. Populated filters/rankings/return flow remains unverified until a daily-data sync completes; no fixture or fake successful source was used.');
  } else {
    assert.ok(all.coverage && all.snapshot && all.total > 0, 'Populated source coverage is required for the remaining flow');
    stage = 'all nine real date presets';
    const presets = ['3d', '7d', '14d', 'this-month', 'last-month', 'all', 'custom', 'today', 'yesterday'];
    for (let offset = 0; offset < presets.length; offset += 3) {
      const results = await Promise.allSettled(presets.slice(offset, offset + 3).map(period => api({ period, ...(period === 'custom' ? all.coverage : {}) }).then(data => { verified(data); return data; })));
      // coverage uses from/to; the native browser checks below also apply real custom dates.
      for (const result of results) { if (result.status === 'rejected') throw result.reason; assert.ok(result.value.period.from <= result.value.period.to); }
    }
    console.log('PASS: all nine real date presets, including three simultaneous requests per batch.');
    stage = 'actual caption or title search';
    const captionAd = all.rows.find(ad => ad.body_text?.trim() || ad.title?.trim());
    assert.ok(captionAd, 'An actual stored caption or title is required');
    const captionQuery = [...(captionAd.body_text?.trim() || captionAd.title.trim())].slice(0, 40).join('');
    const captionMatches = await api({ period: 'all', q: captionQuery });
    verified(captionMatches);
    assert.ok(captionMatches.rows.some(ad => ad.account_id === captionAd.account_id && ad.ad_id === captionAd.ad_id), 'An exact real caption/title substring includes the source ad, with literal special characters escaped');
    stage = 'all seven actual ranking modes';
    for (const [sort, field, direction] of [['spend', 'spend', -1], ['cost_per_conversation', 'cost_per_conversation', 1], ['roas', 'roas', -1], ['conversations', 'conversations', -1], ['hook_rate', 'hook_rate', -1], ['newest', 'delivery_first', -1], ['longest', 'delivery_days', -1]]) {
      const ranked = await api({ period: 'all', sort });
      verified(ranked);
      for (const currency of new Set(ranked.rows.map(ad => ad.currency))) {
        let previous = null, sawNull = false;
        for (const ad of ranked.rows.filter(ad => ad.currency === currency)) {
          const value = sort === 'roas'
            ? ad.purchase_value !== null && ad.spend > 0 ? ad.purchase_value / ad.spend : null
            : ad[field];
          if (value === null) { sawNull = true; continue; }
          assert.equal(sawNull, false, `${sort}: missing values appear last in each currency`);
          if (previous !== null) assert.ok(direction === 1 ? value >= previous : value <= previous, `${sort}: real matching ads are ordered within each currency`);
          previous = value;
        }
      }
    }
    stage = 'actual next and previous page';
    const libraryCards = page.getByTestId('performance-grid').locator('article');
    await expect(libraryCards.first()).toBeVisible({ timeout: 60000 });
    const firstPageIds = await libraryCards.evaluateAll(cards => cards.map(card => card.getAttribute('data-testid')));
    await page.getByTestId('performance-next').click();
    await page.waitForURL(url => url.searchParams.get('page') === '1');
    await expect(libraryCards.first()).toBeVisible({ timeout: 60000 });
    await expect(libraryCards.first()).not.toHaveAttribute('data-testid', firstPageIds[0]);
    assert.notDeepEqual(await libraryCards.evaluateAll(cards => cards.map(card => card.getAttribute('data-testid'))), firstPageIds, 'The next page shows different actual ads');
    await page.getByTestId('performance-prev').click();
    await page.waitForURL(url => url.searchParams.get('page') === '0');
    await expect(libraryCards.first()).toHaveAttribute('data-testid', firstPageIds[0], { timeout: 60000 });
    assert.deepEqual(await libraryCards.evaluateAll(cards => cards.map(card => card.getAttribute('data-testid'))), firstPageIds, 'The previous page restores the same actual ads');
    let seed = all.rows.find(ad => ad.unit_ids.length && ad.page_id && ad.status);
    if (!seed) {
      const knownUnit = all.filters.units[0]?.id;
      assert.ok(knownUnit, 'An actual source Unit must be available to exercise Unit/Page filters');
      const scoped = await api({ period: 'all', unit: knownUnit });
      verified(scoped);
      seed = scoped.rows.find(ad => ad.unit_ids.length && ad.page_id && ad.status);
    }
    assert.ok(seed?.ad_id && seed.account_id);
    const unit = seed.unit_ids[0], pageId = seed.page_id;
    const status = seed.status && ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED', 'DISAPPROVED', 'WITH_ISSUES'].includes(seed.status) ? seed.status : '';
    const filters = { period: 'custom', from: all.coverage.from, to: all.coverage.to, q: seed.ad_id, sort: 'roas', ...(unit ? { unit } : {}), ...(pageId ? { pageId } : {}), ...(status ? { status } : {}) };
    const matched = await api(filters);
    verified(matched);
    stage = 'out-of-range page API recovery';
    const recovered = await api({ ...filters, page: '100000' });
    verified(recovered);
    const lastPage = Math.max(0, Math.ceil(matched.total / matched.pageSize) - 1);
    assert.equal(recovered.page, lastPage, 'Unavailable pages recover to the last existing page');
    assert.equal(recovered.total, matched.total, 'Page recovery preserves the filtered total');
    assert.ok(recovered.rows.length > 0, 'Page recovery returns actual matching ads');
    assert.ok(matched.rows.some(ad => ad.account_id === seed.account_id && ad.ad_id === seed.ad_id));
    if (unit) assert.ok(matched.rows.every(ad => ad.unit_ids.includes(unit)), 'Unit filter preserves actual source relations');
    if (pageId) assert.ok(matched.rows.every(ad => ad.page_id === pageId), 'Page filter matches the selected source identity');
    if (status) assert.ok(matched.rows.every(ad => ad.status === status), 'Latest status filter matches the stored source status');
    assert.ok(matched.rows.every(ad => [ad.ad_id, ad.ad_name, ad.campaign_name, ad.body_text, ad.title, ad.page_name].filter(Boolean).join(' ').toLowerCase().includes(seed.ad_id.toLowerCase())), 'Search returns only matching source evidence');
    async function restored() {
      await page.waitForURL(url => url.pathname === '/' && Object.entries(filters).every(([key, value]) => url.searchParams.get(key) === value));
      await expect(page.getByTestId('performance-period')).toHaveValue(filters.period);
      await expect(page.getByTestId('performance-search')).toHaveValue(filters.q);
      await expect(page.getByTestId('performance-rankings').locator('button[aria-pressed="true"]')).toHaveCount(1);
      if (unit) await expect(page.getByTestId('performance-unit')).toHaveValue(unit);
      if (pageId) await expect(page.getByTestId('performance-page')).toHaveValue(pageId);
      if (status) await expect(page.getByTestId('performance-status')).toHaveValue(status);
      await expect(page.getByTestId(`performance-ad-${seed.ad_id}`)).toBeVisible({ timeout: 60000 });
    }
    stage = 'saved custom filters and reload';
    await page.goto(origin + '/?' + new URLSearchParams({ ...filters, page: '100000' }), { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.searchParams.get('page') === String(lastPage));
    await restored();
    await page.goto(origin + '/?' + new URLSearchParams(filters), { waitUntil: 'domcontentloaded' });
    await restored();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await restored();
    await expect(page.getByTestId('performance-from')).toHaveValue(filters.from);
    await expect(page.getByTestId('performance-to')).toHaveValue(filters.to);
    const card = page.getByTestId(`performance-ad-${seed.ad_id}`);
    const media = card.locator('img,video').first();
    if (await media.count()) {
      await media.scrollIntoViewIfNeeded();
      if (await media.evaluate(element => element.tagName === 'IMG')) await expect.poll(() => media.evaluate(element => element.complete && element.naturalWidth >= 300), { timeout: 60000 }).toBe(true);
      assert.ok(await media.evaluate(element => { const frame = element.parentElement.getBoundingClientRect(), box = element.getBoundingClientRect(); return getComputedStyle(element).objectFit === 'contain' && box.width <= frame.width + 1 && box.height <= frame.height + 1; }), 'The complete creative fits its frame');
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${out}/library-desktop.png`, fullPage: true });
    await page.screenshot({ path: `${out}/library-desktop-viewport.png` });
    await card.screenshot({ path: `${out}/creative-card.png` });
    stage = 'native detail focus and period';
    await card.getByRole('button', { name: 'ดูรายละเอียด', exact: true }).focus();
    await page.keyboard.press('Enter');
    const detail = page.getByTestId('company-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`${filters.from} — ${filters.to}`);
    await expect(detail.getByRole('button', { name: 'ปิดรายละเอียด', exact: true })).toBeFocused();
    await page.screenshot({ path: `${out}/detail.png` });
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'ดูรายละเอียด', exact: true })).toBeFocused();
    stage = 'exact own selection and same-period comparison';
    const link = page.getByTestId(`performance-compare-${seed.ad_id}`), destination = new URL(await link.getAttribute('href'), origin);
    assert.equal(destination.searchParams.get('account'), seed.account_id);
    assert.equal(destination.searchParams.get('owned'), seed.ad_id);
    assert.deepEqual([...new URL(destination.searchParams.get('returnTo'), origin).searchParams].sort(), Object.entries(filters).sort());
    await link.click();
    await page.waitForURL(url => url.pathname === '/compare/ads');
    await expect(page.getByTestId('compare-step-rival')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await page.getByTestId('compare-rival-grid').locator('button').first().click();
    const evidence = page.getByTestId('compare-owned-evidence');
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText(`${filters.from} — ${filters.to}`);
    const matchedSeed = matched.rows.find(ad => ad.account_id === seed.account_id && ad.ad_id === seed.ad_id);
    const expectedSpend = matchedSeed.spend == null ? '—' : matchedSeed.spend.toLocaleString('th-TH', { maximumFractionDigits: 2 });
    await expect(evidence.locator('dl > div').first().locator('dd')).toHaveText(expectedSpend);
    stage = 'same-period comparison own picker';
    const alternatives = await api({ ...filters, q: '' });
    verified(alternatives);
    const changedOwn = alternatives.rows.find(ad => ad.ad_id !== seed.ad_id || ad.account_id !== seed.account_id);
    assert.ok(changedOwn, 'A genuinely different real ad with the same period and Unit/Page/status is required');
    const changedSpend = changedOwn.spend == null ? '—' : changedOwn.spend.toLocaleString('th-TH', { maximumFractionDigits: 2 });
    await page.getByTestId('compare-step-owned').click();
    await page.getByTestId('compare-owned-search').fill(changedOwn.ad_id);
    await page.getByTestId('compare-owned-search').press('Enter');
    await page.getByTestId(`compare-own-${changedOwn.ad_id}`).click({ timeout: 60000 });
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText(`${filters.from} — ${filters.to}`);
    await expect(evidence.locator('dl > div').first().locator('dd')).toHaveText(changedSpend);
    await page.waitForURL(url => url.searchParams.get('account') === changedOwn.account_id && url.searchParams.get('owned') === changedOwn.ad_id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(evidence).toBeVisible({ timeout: 60000 });
    await expect(evidence).toContainText(`${filters.from} — ${filters.to}`);
    await expect(evidence.locator('dl > div').first().locator('dd')).toHaveText(changedSpend);
    stage = 'same-period comparison session restore';
    const savedSelection = () => page.evaluate(({ account, owned }) => {
      for (const key of Object.keys(sessionStorage)) {
        if (!key.startsWith('pt-glory-comparison-selection:')) continue;
        const saved = JSON.parse(sessionStorage.getItem(key));
        if (saved?.account === account && saved?.owned === owned && saved.dataset && saved.rival) return saved;
      }
      return null;
    }, { account: changedOwn.account_id, owned: changedOwn.ad_id });
    await expect.poll(savedSelection).not.toBeNull();
    const saved = await savedSelection();
    const restoreUrl = new URL('/compare/ads', origin);
    restoreUrl.search = new URLSearchParams({ returnTo: destination.searchParams.get('returnTo'), dataset: saved.dataset, rival: saved.rival }).toString();
    assert.equal(restoreUrl.searchParams.has('owned'), false, 'The restored own selection must come from this browser session');
    assert.equal(restoreUrl.searchParams.has('account'), false);
    await page.goto(restoreUrl.toString(), { waitUntil: 'domcontentloaded' });
    await expect(evidence).toBeVisible({ timeout: 60000 });
    await expect(evidence).toContainText(`${filters.from} — ${filters.to}`);
    await expect(evidence.locator('dl > div').first().locator('dd')).toHaveText(changedSpend);
    const back = page.getByTestId('comparison-return');
    assert.deepEqual([...new URL(await back.getAttribute('href'), origin).searchParams].sort(), Object.entries(filters).sort());
    await back.click();
    await restored();
    await page.getByTestId(`performance-compare-${seed.ad_id}`).click();
    await page.waitForURL(url => url.pathname === '/compare/ads');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await restored();
    stage = 'native custom date submit';
    await page.getByTestId('performance-from').fill(all.coverage.from);
    await page.getByTestId('performance-to').fill(all.coverage.from);
    await page.getByRole('button', { name: 'ใช้ช่วงวันที่นี้', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('to') === all.coverage.from);
    await expect(page.getByTestId('performance-kpis')).toBeVisible({ timeout: 60000 });
    await page.getByTestId('performance-period').selectOption('all');
    await expect(page.getByTestId('performance-period')).toHaveValue('all');
    await expect(page.getByTestId('performance-from')).toHaveCount(0);
    stage = 'ranking source and selection';
    await page.goto(origin + '/command-center?period=all', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('command-center')).toBeVisible();
    await expect(page.getByTestId('performance-grid').locator('article').first()).toBeVisible({ timeout: 60000 });
    await page.getByTestId('performance-rankings').getByRole('button', { name: /^ค่าทัก/ }).click();
    await page.waitForURL(url => url.searchParams.get('sort') === 'cost_per_conversation');
    const ranked = await api({ period: 'all', sort: 'cost_per_conversation' });
    for (const currency of new Set(ranked.rows.map(ad => ad.currency))) {
      const costs = ranked.rows.filter(ad => ad.currency === currency).map(ad => ad.cost_per_conversation).filter(value => value !== null);
      assert.ok(costs.every((value, index) => index === 0 || value >= costs[index - 1]), 'Costs are ranked within each currency across all matched ads');
    }
    const firstRanked = page.getByTestId('performance-grid').locator('article').first();
    await expect(firstRanked).toHaveAttribute('data-testid', `performance-ad-${ranked.rows[0].ad_id}`, { timeout: 60000 });
    const rankingImage = page.getByTestId('performance-grid').locator('img').first();
    await rankingImage.scrollIntoViewIfNeeded();
    await expect.poll(() => rankingImage.evaluate(image => image.complete && image.naturalWidth >= 300), { timeout: 60000 }).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${out}/rankings-desktop.png` });
    stage = 'mobile full creative, controls and navigation';
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Ranking fits a phone');
    const visibleImage = firstRanked.locator('img').first();
    if (await visibleImage.count()) { await visibleImage.scrollIntoViewIfNeeded(); await expect.poll(() => visibleImage.evaluate(image => image.complete && image.naturalWidth >= 300), { timeout: 60000 }).toBe(true); }
    await page.evaluate(() => scrollTo(0, 0));
    await settleCreativeGrid();
    await page.screenshot({ path: `${out}/rankings-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    await page.getByTestId('nav-/owned-ads/performance').click();
    await expect(page.getByTestId('owned-performance')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Home library fits a phone');
    const homeGrid = page.getByTestId('performance-grid');
    await expect(homeGrid.locator('article').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('performance-period')).toHaveValue('7d');
    const homeImage = homeGrid.locator('img').first();
    await homeImage.scrollIntoViewIfNeeded();
    await expect.poll(() => homeImage.evaluate(image => image.complete && image.naturalWidth >= 300), { timeout: 60000 }).toBe(true);
    await homeGrid.locator('article').first().screenshot({ path: `${out}/home-creative-mobile.png` });
    await settleCreativeGrid();
    await page.screenshot({ path: `${out}/library-mobile.png` });
    await page.screenshot({ path: `${out}/home-mobile-full.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (let index = 0; index < Math.min(3, await homeGrid.locator('img').count()); index++) {
      const image = homeGrid.locator('img').nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth >= 300), { timeout: 60000 }).toBe(true);
    }
    await settleCreativeGrid();
    await page.screenshot({ path: `${out}/home-desktop.png` });
    await page.screenshot({ path: `${out}/home-desktop-full.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: actual imported data, weighted per-currency metrics and unavailable CRM; all nine date presets; real unit/page/search matching; out-of-range page recovery, saved custom filters, reload, modal focus, same-period comparison picker/session restore and exact return; high-resolution creative, sorted ranking and mobile. No source sync, collection, AI, fixture, or autoplay.');
  }
  await context.close();
} catch (error) {
  // A Playwright request error can include authentication cookies; print only the short reason.
  console.error(`Owned performance failed (${stage}):`, error.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
