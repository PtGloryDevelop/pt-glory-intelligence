import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Existing ads only. No sync, collection, source writes, or signed URL logging.
const origin = process.env.LIBRARY_CHECK_URL ?? 'http://localhost:3188';
const browser = await chromium.launch();
let stage = 'authentication';
let page;
try {
  const context = await browser.newContext({ storageState: 'e2e/.auth/trial.json', viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const videoRequests = [];
  page.on('request', request => { if (request.url().endsWith('/api/owned-ads/media') && request.postDataJSON()?.video) videoRequests.push(request.postDataJSON()); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname === '/login') {
    const credentials = JSON.parse(await readFile('e2e/.auth/trial-credentials.json', 'utf8'));
    await page.locator('input[name=email]').fill(credentials.email);
    await page.locator('input[name=password]').fill(credentials.password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await page.waitForURL(origin + '/');
  }
  await expect(page.getByTestId('performance-kpis')).toBeVisible({ timeout: 60000 });
  await context.storageState({ path: 'e2e/.auth/trial.json' });
  const reply = await context.request.get(origin + '/api/owned-ads/performance');
  assert.equal(reply.status(), 200);
  const data = await reply.json();
  const ads = [...new Map((process.env.VIDEO_CHECK_AD ? [data.rows.find(row => row.video_id && row.ad_name === process.env.VIDEO_CHECK_AD)] : [data.rows.find(row => row.video_id), ...['VDO 140', 'VDO 36'].map(name => data.rows.find(row => row.video_id && row.ad_name === name))]).filter(Boolean).map(row => [row.ad_id, row])).values()];
  assert.ok(ads.length, 'Need actual video identity, not an ad-name guess');
  await expect(page.getByTestId('owned-video-preview')).toHaveCount(0);
  await expect(page.getByTestId('owned-media-video')).toHaveCount(0);
  assert.equal(videoRequests.length, 0, 'Opening the grid must not request video files/previews');
  const photo = data.rows.find(row => !row.video_id);
  if (photo) await expect(page.getByTestId('performance-ad-' + photo.ad_id).getByText('ดูวิดีโอ')).toHaveCount(0);
  await mkdir('test-artifacts/owned-video', { recursive: true });
  const results = [];
  async function playSelected(detail = page.getByTestId('company-detail')) {
    await expect(detail).toBeVisible();
    await expect.poll(async () => await detail.getByTestId('owned-media-video').count() + await detail.getByTestId('owned-video-preview').count(), { timeout: 120000 }).toBe(1);
    const preview = await detail.getByTestId('owned-video-preview').count();
    const video = preview ? page.frameLocator('[data-testid=owned-video-preview]').locator('video').first() : detail.getByTestId('owned-media-video');
    await expect(video).toBeAttached({ timeout: 60000 });
    await expect(video).toBeVisible();
    if (!preview) assert.equal(await video.getAttribute('controls'), '');
    const decoded = await video.evaluate(async element => {
      await element.play();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No decoded video frames')), 30000);
        const done = () => { if (element.currentTime > 0 && element.videoWidth > 0) { clearTimeout(timer); element.removeEventListener('timeupdate', done); resolve(); } };
        element.addEventListener('timeupdate', done); done();
      });
      const result = { duration: element.duration, width: element.videoWidth, height: element.videoHeight, currentTime: element.currentTime };
      element.pause(); return result;
    });
    assert.ok(decoded.width > 0 && decoded.height > 0 && decoded.currentTime > 0);
    return { mode: preview ? 'official-preview' : 'file', ...decoded };
  }
  for (const ad of ads) {
    stage = 'actual desktop playback: ' + ad.ad_name;
    const card = page.getByTestId('performance-ad-' + ad.ad_id);
    await card.getByRole('button', { name: 'ดูวิดีโอ ' + ad.ad_name, exact: true }).click();
    results.push({ ad: ad.ad_name, ...await playSelected() });
    await page.getByTestId('company-detail').screenshot({ path: 'test-artifacts/owned-video/desktop-' + ad.ad_id + '.png' });
    await page.getByTestId('company-detail').getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click();
  }
  stage = 'phone playback';
  await page.setViewportSize({ width: 390, height: 844 });
  const ad = ads[0];
  const card = page.getByTestId('performance-ad-' + ad.ad_id);
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText('ดูวิดีโอ')).toBeVisible();
  await card.screenshot({ path: 'test-artifacts/owned-video/phone-card.png' });
  await card.getByRole('button', { name: 'ดูวิดีโอ ' + ad.ad_name, exact: true }).click();
  const phone = await playSelected();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByTestId('company-detail').screenshot({ path: 'test-artifacts/owned-video/phone-player.png' });
  await page.getByTestId('company-detail').getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click();
  stage = 'library video identity';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/owned-ads', { waitUntil: 'domcontentloaded' });
  const libraryVideo = page.getByTestId('company-grid').getByRole('button', { name: /^ดูวิดีโอ / }).first();
  await expect(libraryVideo).toBeVisible({ timeout: 90000 });
  const libraryCard = libraryVideo.locator('..');
  const comparisonHref = await libraryCard.getByRole('link', { name: 'เลือกเปรียบเทียบ', exact: true }).getAttribute('href');
  await libraryVideo.click();
  const libraryPlayback = await playSelected();
  await page.getByTestId('company-detail').getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click();
  stage = 'comparison video';
  const catalogReply = await context.request.get(origin + '/api/catalog/ads?search=Hylme&limit=1');
  const rival = (await catalogReply.json()).rows[0];
  assert.ok(rival, 'Use an existing rival, never create a collection');
  const comparisonUrl = new URL(comparisonHref, origin);
  comparisonUrl.searchParams.set('dataset', rival.dataset_id);
  comparisonUrl.searchParams.set('rival', rival.ad_archive_id);
  await page.goto(comparisonUrl.toString(), { waitUntil: 'domcontentloaded' });
  const evidence = page.getByTestId('compare-owned-evidence');
  await expect(evidence.getByRole('button', { name: /ดูวิดีโอ/ })).toBeVisible({ timeout: 90000 });
  await expect(evidence.getByTestId('owned-video-preview')).toHaveCount(0);
  await evidence.getByRole('button', { name: /ดูวิดีโอ/ }).click();
  const comparisonPlayback = await playSelected(evidence);
  await evidence.screenshot({ path: 'test-artifacts/owned-video/comparison.png' });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('performance-kpis')).toBeVisible({ timeout: 60000 });
  stage = 'explicit failure fixture';
  await page.route('**/api/owned-ads/media', async route => {
    if (route.request().postDataJSON()?.video) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test fixture: provider unavailable' }) });
    else await route.continue();
  });
  await card.getByRole('button', { name: 'ดูวิดีโอ ' + ad.ad_name, exact: true }).click();
  await expect(page.getByTestId('company-detail').getByText(/ยังเปิดวิดีโอจากต้นทางไม่ได้/)).toBeVisible();
  await expect(page.getByTestId('company-detail').locator('img')).toBeVisible();
  console.log(JSON.stringify({ result: 'PASS', desktop: results, phone, libraryPlayback, comparisonPlayback, providerFailureFixture: true, noGridVideoFetch: true }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-artifacts/owned-video/failure.png' }).catch(() => {});
    for (const frame of page.frames().slice(1)) {
      let location;
      try { const url = new URL(frame.url()); location = { host: url.hostname, path: url.pathname }; } catch { continue; }
      console.error(JSON.stringify({ frame: location, videos: await frame.locator('video').count().catch(() => 0) }));
    }
  }
  console.error('Owned video check failed at ' + stage + ': ' + error.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
