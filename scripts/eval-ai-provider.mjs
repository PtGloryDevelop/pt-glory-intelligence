// Golden evaluation for the Compare AI readings (lib/ai/compare.ts), run against a local dev server so
// the real code path loads the ads and their pictures. One provider/model per run: start the server
// with the AI_PROVIDER / OPENAI_MODEL to judge, then
//   node --env-file=.env.local scripts/eval-ai-provider.mjs --base http://localhost:3210 --auth e2e/.auth/me.json --out <file.json>
// --recheck <file.json> instead of --base/--auth judges saved results again, with no AI call.
// --suite clips runs the video sets instead (spec 2026-11-23, Ticket 6): rival clips the VPS reader has
// prepared, where every quote with source เสียง must be in the stored transcript.
// It spends AI credit (cached readings cost nothing) and writes only the readings cache, as the page does.
// Ad copy for the quote check is read with DATABASE_URL, read-only.
import {readFileSync, writeFileSync} from 'node:fs';
import pg from 'pg';
import {request} from 'playwright';

const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const base = arg('base'), auth = arg('auth'), out = arg('out'), recheck = arg('recheck');
if (!out || !(recheck || (base && auth))) throw Error('--out and either --base with --auth, or --recheck, are required');

const own = (account, ad) => ({kind: 'own', account, ad});
const rival = (dataset, ad) => ({kind: 'rival', dataset, ad});
// Sets the marketing team compared for real (two are saved rounds); one of ours against one rival each.
const SETS = [
  {name: 'U5 VDO 100 vs เครื่องวัดความดัน (round 7169d912)', view: 'general', ads: [own('act_747201513533457', '120250868887920673'), rival('869cf282-3f47-443d-9f9a-1a1d9178f3c4', '450951290298932')]},
  {name: 'U23 VDO 152 vs T-Gluta (round 02afc883)', view: 'general', ads: [own('act_936892198698779', '120252298810980203'), rival('6c41aadf-074d-4eac-9421-0e9aa409ce71', '1019948740425770')]},
  {name: '22 Nov set', view: 'general', ads: [own('act_956777803377695', '120248929757050775'), rival('6133f867-d926-46ca-886a-1822cbad5e3c', '1124203536670271')]},
  {name: '11 Nov set', view: 'general', ads: [own('act_4217772271817721', '120248342235700436'), rival('e5c155ef-e90e-435c-a8e5-c7dd26c81bfb', '1604667368015080')]},
  {name: 'U5 VDO 100 vs เครื่องวัดความดัน · ทีมยิงแอด', view: 'ads', ads: [own('act_747201513533457', '120250868887920673'), rival('869cf282-3f47-443d-9f9a-1a1d9178f3c4', '450951290298932')]},
  {name: 'U23 VDO 152 vs T-Gluta · ทีมยิงแอด', view: 'ads', ads: [own('act_936892198698779', '120252298810980203'), rival('6c41aadf-074d-4eac-9421-0e9aa409ce71', '1019948740425770')]},
];
// Rival clips collected 23 Nov and read on the VPS (all with a sound track), each against our top video
// ad of the same unit: a short clip, one past the 2-minute window, both team views, and two clips at once.
const U21 = 'c4d17013-97f8-4088-9ad0-dce9910a1728', U2 = 'deacc788-b370-4c80-a646-77ea5feffad2';
const U24 = '7573b8cb-158b-4bd0-89c8-762587c21d81', U15 = '125f7a83-0c4d-4142-ab31-29900a85455f';
const CLIP_SETS = [
  {name: 'clip U21 VDO 63 vs มือชา 0:42', view: 'general', ads: [own('act_910313198268798', '120252465118810272'), rival(U21, '943553095494869')]},
  {name: 'clip U21 VDO 63 vs มือชา 6:06 (2 นาทีแรก)', view: 'general', ads: [own('act_910313198268798', '120252465118810272'), rival(U21, '1202373180848948')]},
  {name: 'clip U2 VDO 4 vs Uji 0:56', view: 'general', ads: [own('act_1575861167471141', '120249788587760423'), rival(U2, '2533776723771382')]},
  {name: 'clip U24 VDO 21 vs Kivari 1:44', view: 'general', ads: [own('act_4217772271817721', '120248342235700436'), rival(U24, '1432703621579014')]},
  {name: 'clip U15 VDO 147 vs Veggy 1:28', view: 'general', ads: [own('act_2199323500574358', '120248875644080214'), rival(U15, '1441009250856092')]},
  {name: 'clip U15 VDO 147 vs Veggy 1:28 · ทีมยิงแอด', view: 'ads', ads: [own('act_2199323500574358', '120248875644080214'), rival(U15, '1441009250856092')]},
  {name: 'clip U21 VDO 63 vs มือชา 0:42 + 1:17', view: 'general', ads: [own('act_910313198268798', '120252465118810272'), rival(U21, '943553095494869'), rival(U21, '1428125754763733')]},
];
const suite = arg('suite') === 'clips' ? CLIP_SETS : SETS;

// Words the FDA rules in the prompts forbid in what AI suggests we write (ideas, hooks, fix).
const FDA = /รักษา|หายขาด|ถาวร|100\s*%|ป้องกันโรค|บรรเทา|เห็นผลใน|ภายใน\s*\d+\s*วัน|ลดความดัน|ลดน้ำตาล|ลดไขมัน|ไขมันในเลือด|หลอดเลือด|หัวใจ|ลดน้ำหนัก|คุมน้ำหนัก|คุมแคล|ไม่เห็นผล.{0,8}คืนเงิน|แพทย์แนะนำ|หมอแนะนำ/;
// Advice to take a claim out names the claim: that is not suggesting it. A new headline never may.
const REMOVING = /ตัด|(เอา|นำ).{0,45}ออก|ออกจาก|ห้าม|เลี่ยง|ไม่ควร|แทนคำ|เปลี่ยนคำอ้าง|ลดคำอ้าง|ไม่ใช้คำ|ไม่อ้าง|ไม่กล่าวถึง|ให้ปลอดภัย/;
// Thai text only: a reply that slips into another script is not usable as written.
const OTHER_SCRIPT = /[一-鿿぀-ヿ]/;
const suggests = text => FDA.test(text) && !REMOVING.test(text);
// Claims about a rival's results the system has no data for ("คู่แข่งไม่มีข้อมูลงบ" is the honest version).
const RIVAL_RESULT = /คู่แข่ง(?:(?!ไม่)[^\n]){0,30}(ขายดี|ขายได้|ยอดขาย|ได้ผลกว่า|ใช้งบ)/;
// Letters, marks and digits only: a quote that leaves out a ✔ or an emoji between words is still the copy.
// (An emoji's invisible parts are marks too, so they go first; the same rule as lib/ai/labels-shared.ts.)
const squash = text => String(text ?? '').replace(/[︀-️‍⃣]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '').toLowerCase();

async function adCopy(db, ref) {
  if (ref.kind === 'rival') {
    const {rows} = await db.query('select title, body_text, link_description, cta_text from public.ad_detail($1, $2)', [ref.ad, ref.dataset]);
    return rows[0] ? [rows[0].title, rows[0].body_text, rows[0].link_description, rows[0].cta_text].filter(Boolean).join('\n') : null;
  }
  const {rows} = await db.query(`select a.data->>'title' title, a.data->>'body_text' body from public.owned_library_ads a
    where a.sync_id = (select id from public.owned_library_syncs where status = 'completed' order by finished_at desc limit 1)
      and a.ad_id = $1 and a.data->>'account_id' = $2`, [ref.ad, ref.account]);
  return rows[0] ? [rows[0].title, rows[0].body].filter(Boolean).join('\n') : null;
}

/** What AI was told the clip says: both transcripts (hook and the part read) the compare stored. */
async function transcriptOf(db, ref) {
  if (ref.kind !== 'rival') return null;
  const {rows: [detail]} = await db.query('select ad_observation_id from public.ad_detail($1, $2)', [ref.ad, ref.dataset]);
  if (!detail?.ad_observation_id) return null;
  const {rows: [clip]} = await db.query(`select audio_sha256, hook_audio_sha256 from public.ad_video_readings where ad_observation_id = $1 and status = 'ready'`, [detail.ad_observation_id]);
  if (!clip?.audio_sha256) return null;
  // The same keys as transcriptKey() in lib/ai/video-input.ts.
  const key = (part, sha) => `transcript:gpt-transcribe:${detail.ad_observation_id}:${part}:${sha.slice(0, 16)}`;
  const {rows} = await db.query(`select result->>'text' text from public.ai_analyses where kind = 'transcript' and key = any($1)`,
    [[key('audio', clip.audio_sha256), key('hook', clip.hook_audio_sha256)]]);
  return rows.length ? rows.map(row => row.text ?? '').join('\n') : null;
}

/** The figures of two digits or more in a text, without thousands separators: "1,180.-" is 1180. */
const numbersIn = text => (String(text ?? '').match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(number => number.replace(/,/g, '').replace(/\.0+$/, '')).filter(number => number.length >= 2);

/** What a person should look at in one set's reply; empty when nothing tripped. */
async function checksFor(db, set, body, voice = {quotes: 0}) {
  const checks = [], ownNumbers = new Set();
  for (const [index, ref] of set.ads.entries()) {
    const id = body.context[index].id, reading = body.ads[id], written = await adCopy(db, ref), copy = squash(written);
    if (ref.kind === 'own') for (const number of numbersIn(written)) ownNumbers.add(number);
    const video = body.context[index].video ?? null, heard = squash(await transcriptOf(db, ref));
    const cells = Object.entries(reading).filter(([, cell]) => cell && typeof cell === 'object' && 'source' in cell);
    for (const [dim, cell] of cells) {
      // A quote said to come from the copy must be in the copy; picture quotes are judged by a person.
      if (cell.source === 'ข้อความ' && cell.quote && copy && !copy.includes(squash(cell.quote))) checks.push(`ad ${index} ${dim}: quote not in the copy: "${cell.quote}"`);
      if (cell.source !== 'เสียง') continue;
      // Speech is evidence only where the audio was heard, and a quote from it must be in the transcript.
      if (!video?.heard) checks.push(`ad ${index} ${dim}: cites the audio of a clip AI did not hear`);
      else if (cell.quote) {
        voice.quotes += 1;
        if (!heard.includes(squash(cell.quote))) checks.push(`ad ${index} ${dim}: quote not in the transcript: "${cell.quote}"`);
      }
    }
    // The claims list carries what was said too (the prompt puts every spoken claim there): a part of
    // its quote marked (เสียง), or with no mark, that is in the transcript counts as evidence from speech.
    const claimParts = String(reading.claims?.quote ?? '').split(/;|\n/).map(part => part.trim()).filter(Boolean);
    const spokenParts = claimParts.filter(part => heard && heard.includes(squash(part.replace(/\((เสียง|ภาพ[^)]*|ข้อความ)\)\s*$/, ''))));
    for (const part of claimParts) {
      if (!/\(เสียง\)\s*$/.test(part)) continue;
      voice.quotes += 1;
      if (!spokenParts.includes(part)) checks.push(`ad ${index} claims: quote marked เสียง not in the transcript: "${part}"`);
    }
    if (video?.speech && !cells.some(([, cell]) => cell.source === 'เสียง') && spokenParts.length === 0 && reading.claims) {
      checks.push(`ad ${index}: speech was heard but no evidence comes from it`);
    }
    if (typeof reading.fix === 'string' && suggests(reading.fix)) checks.push(`ad ${index} fix suggests a forbidden claim: "${reading.fix}"`);
    if (OTHER_SCRIPT.test(JSON.stringify(reading))) checks.push(`ad ${index} reading slips out of Thai`);
  }
  for (const item of body.summary.ideas) if (suggests(item.text)) checks.push(`idea suggests a forbidden claim: "${item.text}"`);
  for (const item of body.summary.hooks) if (FDA.test(item.text)) checks.push(`headline uses a forbidden claim: "${item.text}"`);
  // A headline is written for our ad from our ad's own facts: a price or figure in it must be in our copy.
  for (const item of body.summary.hooks) {
    const invented = numbersIn(item.text).filter(number => !ownNumbers.has(number));
    if (invented.length) checks.push(`headline uses a number that is not in our ad (${invented.join(', ')}): "${item.text}"`);
  }
  for (const item of [...body.summary.diffs, ...body.summary.ideas]) if (RIVAL_RESULT.test(item.text)) checks.push(`summary claims a rival result: "${item.text}"`);
  if (OTHER_SCRIPT.test(JSON.stringify(body.summary))) checks.push('summary slips out of Thai');
  return checks;
}

const db = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000});
await db.connect();
const results = [];
if (recheck) {
  try {
    for (const row of JSON.parse(readFileSync(recheck, 'utf8'))) {
      const set = [...SETS, ...CLIP_SETS].find(item => item.name === row.set), voice = {quotes: 0};
      results.push({...row, checks: set && row.status === 200 ? await checksFor(db, set, row.body, voice) : [], voiceQuotes: voice.quotes});
      console.log(`${row.status} ${row.model ?? ''} checks=${results.at(-1).checks.length} voice=${voice.quotes} ${row.set}`);
    }
  } finally { await db.end(); }
} else {
  const api = await request.newContext({baseURL: base, storageState: auth});
  try {
    for (const set of suite) {
      const started = Date.now(), voice = {quotes: 0};
      const response = await api.post('/api/compare/ai', {data: {ads: set.ads, dryRun: false, view: set.view}, timeout: 240_000});
      const body = await response.json().catch(() => null);
      const row = {set: set.name, view: set.view, status: response.status(), ms: Date.now() - started, model: body?.model ?? null, cost: body?.cost ?? null, error: response.ok() ? null : body?.error ?? null, checks: [], voiceQuotes: 0, body};
      if (response.ok()) { row.checks = await checksFor(db, set, body, voice); row.voiceQuotes = voice.quotes; }
      results.push(row);
      console.log(`${row.status} ${row.ms}ms ${row.model ?? ''} cost=${row.cost ?? '-'} checks=${row.checks.length} voice=${row.voiceQuotes} ${row.set}${row.error ? ` · ${row.error}` : ''}`);
    }
  } finally {
    // The session's refresh token rotates: keep the new one for the next run.
    await api.storageState({path: auth});
    await api.dispose();
    await db.end();
  }
}
writeFileSync(out, JSON.stringify(results, null, 1));
