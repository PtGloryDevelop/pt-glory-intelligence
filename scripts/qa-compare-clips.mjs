// Browser check of what Compare says about each clip (spec 2026-11-23, Tickets 5–6): every clip status
// and the "แกะคลิปได้ X จาก Y แอดวิดีโอ" line, in the general and ทีมยิงแอด views, at desktop and phone width.
// The AI reply comes from a saved eval-ai-provider.mjs result (--suite clips), so no AI is called and
// nothing is written; only the clip part of the reply is changed for each case. Needs a running server
// and a saved session:
//   node scripts/qa-compare-clips.mjs --base http://localhost:3210 --auth e2e/.auth/me.json --from <eval.json> --set "<set name>"
// The set must hold one of our ads and one rival ad, with a reading of both views (general and ads).
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const base = arg('base'), auth = arg('auth'), from = arg('from'), setName = arg('set');
if (!base || !auth || !from || !setName) throw Error('--base, --auth, --from and --set are required');

const rows = JSON.parse(readFileSync(from, 'utf8')).filter(row => row.status === 200 && row.set.startsWith(setName));
const general = rows.find(row => row.view === 'general')?.body, ads = rows.find(row => row.view === 'ads')?.body;
if (!general || !ads) throw Error(`no general and ads readings for "${setName}" in ${from}`);
const ownIndex = general.context.findIndex(ad => ad.id.startsWith('own:')), rivalIndex = 1 - ownIndex;
const [own, rival] = [general.context[ownIndex], general.context[rivalIndex]];
const parse = id => id.split(':');
const [, account, owned] = parse(own.id), [, dataset, rivalAd] = parse(rival.id);
const url = `/compare/ads?account=${account}&owned=${owned}&dataset=${dataset}&rival=${rivalAd}`;

const clip = (status, extra = {}) => ({status, durationMs: null, processedMs: null, frames: 0, hasAudio: null, heard: false, speech: null, ...extra});
const read = (extra = {}) => clip('ready', {durationMs: 88_000, processedMs: 88_000, frames: 8, hasAudio: true, heard: true, speech: true, ...extra});
const COVER = 'AI เห็นแค่ภาพปก · ';
// Each case: the rival's clip, the words the page must show under it, and the coverage line.
const CASES = [
  {name: 'read with speech', video: read(), label: 'AI ดูคลิป 0:00–1:28 · 8 ภาพ + เสียงพูด (ถอดโดย AI)', watched: 1},
  {name: 'read, no words heard', video: read({speech: false}), label: 'AI ดูคลิป 0:00–1:28 · 8 ภาพ · ไม่พบเสียงพูด', watched: 1},
  {name: 'read, no sound track', video: read({hasAudio: false, heard: false, speech: null}), label: 'AI ดูคลิป 0:00–1:28 · 8 ภาพ · คลิปไม่มีเสียง', watched: 1},
  {name: 'read, audio not heard', video: read({heard: false, speech: null}), label: 'AI ดูคลิป 0:00–1:28 · 8 ภาพ · ไม่ได้ฟังเสียง', watched: 1},
  {name: 'past 2 minutes', video: read({durationMs: 366_000, processedMs: 120_000}), label: 'AI ดูคลิป 0:00–2:00 · 8 ภาพ + เสียงพูด (ถอดโดย AI) · ดูแค่ 2 นาทีแรกจาก 6:06', watched: 1},
  {name: 'pending', video: clip('pending'), label: `${COVER}คลิปยังรอแกะ`, watched: 0},
  {name: 'expired', video: clip('expired'), label: `${COVER}ลิงก์คลิปหมดอายุก่อนแกะ`, watched: 0},
  {name: 'collected before reading', video: clip('none'), label: `${COVER}เก็บมาก่อนมีระบบแกะคลิป`, watched: 0},
  {name: 'too large', video: clip('too_large'), label: `${COVER}ไฟล์คลิปใหญ่เกินกำหนด`, watched: 0},
  {name: 'no video file', video: clip('no_video'), label: `${COVER}ไม่พบไฟล์วิดีโอ`, watched: 0},
  {name: 'failed', video: clip('failed'), label: `${COVER}แกะคลิปไม่สำเร็จ`, watched: 0},
];
const OWN_LABEL = `${COVER}ยังดึงคลิปแอดเราไม่ได้ (เพจยังไม่ได้ให้สิทธิ์ระบบ)`;
const coverage = watched => `แกะคลิปได้ ${watched} จาก 2 แอดวิดีโอ · คลิปที่แกะได้ AI ดูภาพตามเวลาและฟังเสียง ที่เหลือเห็นแค่ภาพปก`;

const browser = await chromium.launch({channel: 'chrome'});
const context = await browser.newContext({storageState: auth});
let current = CASES[0];
// Both requests the panel makes are answered here: the estimate, then the reading of the view asked.
await context.route('**/api/compare/ai', async route => {
  const body = route.request().postDataJSON();
  if (body.dryRun) return route.fulfill({json: {model: general.model, cached: 2, missing: 0, setCached: true, estimate: 0, spent: general.spent}});
  const reply = structuredClone(body.view === 'ads' ? ads : general);
  reply.context[rivalIndex].video = current.video;
  reply.context[ownIndex].video = clip('owned');
  return route.fulfill({json: reply});
});

const failures = [], errors = [];
const page = await context.newPage();
// A saved session usually starts with an expired access token, and the first page's parallel reads
// race to refresh it (some answer 503 once). One page first, so the cases below see a settled session.
await page.goto(`${base}/`);
await page.waitForLoadState('networkidle');
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
// A failed request is named by its path, so a console error can be traced to the read behind it.
page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
try {
  for (const view of ['general', 'ads']) {
    for (const item of CASES) {
      current = item;
      await page.goto(`${base}${url}${view === 'ads' ? '&view=ads' : ''}`);
      const line = page.getByTestId('compare-ai-clips');
      await line.waitFor({timeout: 60_000});
      const notes = await page.getByTestId('compare-ai-clip').allInnerTexts();
      const got = {coverage: (await line.innerText()).trim(), notes: [...new Set(notes.map(text => text.trim()))]};
      const want = {coverage: coverage(item.watched), notes: [OWN_LABEL, item.label]};
      const ok = got.coverage === want.coverage && want.notes.every(note => got.notes.includes(note)) && got.notes.length === 2;
      if (!ok) failures.push({view, case: item.name, got, want});
      console.log(`${ok ? 'PASS' : 'FAIL'} ${view} · ${item.name}`);
    }
  }
  // Phone width: the longest label wraps inside the page.
  current = CASES[4];
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${base}${url}`);
  await page.getByTestId('compare-ai-clips').waitFor({timeout: 60_000});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${overflow <= 0 ? 'PASS' : 'FAIL'} 390px · no sideways scroll (${overflow}px)`);
  if (overflow > 0) failures.push({case: '390px overflow', got: overflow});
} finally {
  // The session's refresh token rotates: keep the new one for the next run.
  await context.storageState({path: auth});
  await browser.close();
}
if (errors.length) console.log('console errors:', errors);
for (const failure of failures) console.log(JSON.stringify(failure));
process.exitCode = failures.length || errors.length ? 1 : 0;
