import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';

// Read existing ads only. Never log signed URLs/cookies or start collection/sync.
const baseline = process.argv.includes('--baseline');
const origin = process.env.LIBRARY_CHECK_URL ?? 'http://localhost:3188';
const out = 'test-artifacts/image-delivery';
const browser = await chromium.launch();
let stage = 'authentication';
try {
  const context = await browser.newContext({ storageState: 'e2e/.auth/trial.json', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const mediaReady = page.waitForResponse(reply => reply.url().endsWith('/api/owned-ads/media'), { timeout: 90000 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  if (new URL(page.url()).pathname === '/login') {
    const credentials = JSON.parse(await readFile('e2e/.auth/trial-credentials.json', 'utf8'));
    await page.locator('input[name=email]').fill(credentials.email);
    await page.locator('input[name=password]').fill(credentials.password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await page.waitForURL(origin + '/');
  }
  await context.storageState({ path: 'e2e/.auth/trial.json' });
  await expect(page.getByTestId('performance-kpis')).toBeVisible({ timeout: 60000 });
  const mediaReply = await mediaReady;
  assert.equal(mediaReply.status(), 200, 'Measure after actual source-image resolution, not while a thumbnail is being replaced');
  const resolvedMedia = (await mediaReply.json()).items;
  await mkdir(out, { recursive: true });
  stage = 'real full-resolution images';
  const cards = page.getByTestId('performance-grid').locator('article');
  const measurements = [];
  for (let index = 0; index < 3; index++) {
    const card = cards.nth(index);
    await card.scrollIntoViewIfNeeded();
    const image = card.locator('img').first();
    const adId = (await card.getAttribute('data-testid')).replace('performance-ad-', '');
    const resolvedUrl = resolvedMedia.find(item => item.ad_id === adId)?.url;
    if (resolvedUrl) await expect.poll(() => image.evaluate(img => {
      if (!img.currentSrc) return '';
      const current = new URL(img.currentSrc);
      return current.pathname === '/_next/image' ? current.searchParams.get('url') : img.currentSrc;
    }), { timeout: 90000 }).toBe(resolvedUrl);
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth >= 300), { timeout: 90000 }).toBe(true);
    const info = await image.evaluate(img => ({ src: img.currentSrc, srcset: img.srcset, slot: img.getBoundingClientRect().width }));
    const delivery = new URL(info.src, origin);
    const source = delivery.pathname === '/_next/image' ? delivery.searchParams.get('url') : info.src;
    const remote = new URL(source);
    assert.ok(remote.protocol === 'https:' && (remote.hostname === 'fbcdn.net' || remote.hostname.endsWith('.fbcdn.net')));
    const originalReply = await context.request.get(source, { timeout: 30000 });
    assert.equal(originalReply.status(), 200);
    const original = await originalReply.body();
    const metadata = await sharp(original).metadata();
    const row = { sample: index + 1, slot: Math.round(info.slot), originalBytes: original.length, originalWidth: metadata.width, originalHeight: metadata.height, variants: [] };
    if (baseline) {
      await writeFile(`${out}/sample-${index + 1}-original.${metadata.format}`, original);
      for (const width of [640, 960]) for (const quality of [75, 85, 90]) {
        const started = performance.now();
        const bytes = await sharp(original).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
        row.variants.push({ width, quality, bytes: bytes.length, encodeMs: Math.round(performance.now() - started) });
        await writeFile(`${out}/sample-${index + 1}-${width}-q${quality}.webp`, bytes);
      }
    } else {
      assert.equal(delivery.pathname, '/_next/image', 'Card must use the responsive optimizer rather than the full CDN file');
      assert.ok(info.srcset.includes('640w') && info.srcset.includes('1600w'), 'Browser must have responsive candidates');
      const optimizedReply = await context.request.get(info.src, { headers: { Accept: 'image/webp' }, timeout: 30000 });
      assert.equal(optimizedReply.status(), 200);
      assert.equal(optimizedReply.headers()['content-type'], 'image/webp');
      row.cache = optimizedReply.headers()['x-nextjs-cache'];
      assert.equal(row.cache, 'HIT', 'Repeated delivery reuses the optimized file');
      const optimized = await optimizedReply.body();
      row.deliveredBytes = optimized.length;
      row.deliveredWidth = (await sharp(optimized).metadata()).width;
      row.requestedWidth = Number(delivery.searchParams.get('w'));
      assert.ok(row.requestedWidth <= 640, 'Desktop 1x card must not request a full detail-size image');
      assert.ok(row.deliveredBytes < row.originalBytes, 'Measured real card must transfer fewer bytes');
      assert.equal((await sharp(optimized).metadata()).exif, undefined);
      await card.screenshot({ path: `${out}/card-${index + 1}-desktop.png` });
    }
    measurements.push(row);
  }
  if (!baseline) {
    stage = 'original detail and restricted optimization';
    // Video details now show a playable preview; verify original pixels on a still ad.
    await page.getByRole('button', { name: /^เปิดสื่อ / }).first().click();
    const detail = page.getByTestId('company-detail');
    await expect(detail).toBeVisible();
    const detailImage = detail.locator('img').first();
    await expect.poll(() => detailImage.evaluate(img => img.complete && img.naturalWidth >= 300), { timeout: 60000 }).toBe(true);
    assert.notEqual(new URL(await detailImage.evaluate(img => img.currentSrc)).pathname, '/_next/image', 'Detail retains source pixels');
    await detail.screenshot({ path: `${out}/detail-original.png` });
    await detail.getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click();
    const firstSrc = await cards.first().locator('img').evaluate(img => img.currentSrc);
    const rejected = new URL(firstSrc);
    for (const [key, value] of [['url', 'http://127.0.0.1/private'], ['q', '1'], ['w', '777']]) {
      const invalid = new URL(rejected); invalid.searchParams.set(key, value);
      assert.equal((await context.request.get(invalid.toString())).status(), 400);
    }
    stage = 'phone responsive selection';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('performance-grid').locator('article').first();
    await card.scrollIntoViewIfNeeded();
    const image = card.locator('img').first();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth >= 300), { timeout: 90000 }).toBe(true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await card.screenshot({ path: `${out}/card-phone.png` });
    stage = 'optimizer failure fallback';
    await page.route('**/_next/image?**', route => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    const fallbackImage = page.getByTestId('performance-grid').locator('article').first().locator('img');
    await fallbackImage.scrollIntoViewIfNeeded();
    await expect.poll(() => fallbackImage.evaluate(img => img.complete && img.naturalWidth >= 300), { timeout: 90000 }).toBe(true);
    assert.notEqual(new URL(await fallbackImage.evaluate(img => img.currentSrc)).pathname, '/_next/image', 'Optimizer failure retries the original, without a false expired-media state');
    await page.unroute('**/_next/image?**');
    stage = 'retina source pixels';
    const retina = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const phone = await retina.newPage();
    await phone.goto(origin, { waitUntil: 'domcontentloaded' });
    const retinaCard = phone.getByTestId('performance-grid').locator('article').first();
    await retinaCard.scrollIntoViewIfNeeded();
    const retinaImage = retinaCard.locator('img');
    await expect.poll(() => retinaImage.evaluate(img => img.complete && img.naturalWidth > 0), { timeout: 90000 }).toBe(true);
    const requested = new URL(await retinaImage.evaluate(img => img.currentSrc));
    assert.equal(requested.pathname, '/_next/image');
    assert.ok(Number(requested.searchParams.get('w')) >= 640, 'Retina phone receives more pixels than a 1x card');
    const retinaBytes = await (await retina.request.get(requested.toString(), { headers: { Accept: 'image/webp' } })).body();
    const retinaSource = await (await retina.request.get(requested.searchParams.get('url'))).body();
    const sourceWidth = (await sharp(retinaSource).metadata()).width;
    const slot = await retinaImage.evaluate(img => img.getBoundingClientRect().width);
    assert.ok((await sharp(retinaBytes).metadata()).width >= Math.min(sourceWidth, Math.ceil(slot * 2)), 'Retina delivery preserves the required source pixels without upscaling');
    await retinaCard.screenshot({ path: `${out}/card-phone-2x.png` });
    await retina.close();
  }
  await writeFile(`${out}/${baseline ? 'baseline' : 'optimized'}.json`, JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'optimized', measurements }, null, 2));
  await context.close();
} catch (error) {
  console.error(`Image delivery check failed (${stage}):`, error.message.split('\n')[0]);
  process.exitCode = 1;
} finally { await browser.close(); }
