// Golden evaluation for the Compare AI readings (lib/ai/compare.ts), run against a local dev server so
// the real code path loads the ads and their pictures. One provider/model per run: start the server
// with the AI_PROVIDER / OPENAI_MODEL to judge, then
//   node --env-file=.env.local scripts/eval-ai-provider.mjs --base http://localhost:3210 --auth e2e/.auth/me.json --out <file.json>
// --recheck <file.json> instead of --base/--auth judges saved results again, with no AI call.
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

// Words the FDA rules in the prompts forbid in what AI suggests we write (ideas, hooks, fix).
const FDA = /รักษา|หายขาด|ถาวร|100\s*%|ป้องกันโรค|บรรเทา|เห็นผลใน|ภายใน\s*\d+\s*วัน|ลดความดัน|ลดน้ำตาล|ลดไขมัน|ไขมันในเลือด|หลอดเลือด|หัวใจ|ลดน้ำหนัก|คุมน้ำหนัก|คุมแคล|ไม่เห็นผล.{0,8}คืนเงิน|แพทย์แนะนำ|หมอแนะนำ/;
// Advice to take a claim out names the claim: that is not suggesting it. A new headline never may.
const REMOVING = /ตัด|(เอา|นำ).{0,45}ออก|ออกจาก|ห้าม|เลี่ยง|ไม่ควร|แทนคำ/;
// Thai text only: a reply that slips into another script is not usable as written.
const OTHER_SCRIPT = /[一-鿿぀-ヿ]/;
const suggests = text => FDA.test(text) && !REMOVING.test(text);
// Claims about a rival's results the system has no data for ("คู่แข่งไม่มีข้อมูลงบ" is the honest version).
const RIVAL_RESULT = /คู่แข่ง(?:(?!ไม่)[^\n]){0,30}(ขายดี|ขายได้|ยอดขาย|ได้ผลกว่า|ใช้งบ)/;
const squash = text => String(text ?? '').replace(/\s+/g, '').toLowerCase();

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

/** What a person should look at in one set's reply; empty when nothing tripped. */
async function checksFor(db, set, body) {
  const checks = [];
  for (const [index, ref] of set.ads.entries()) {
    const id = body.context[index].id, reading = body.ads[id], copy = squash(await adCopy(db, ref));
    const cells = Object.entries(reading).filter(([, cell]) => cell && typeof cell === 'object' && 'source' in cell);
    for (const [dim, cell] of cells) {
      // A quote said to come from the copy must be in the copy; picture quotes are judged by a person.
      if (cell.source === 'ข้อความ' && cell.quote && copy && !copy.includes(squash(cell.quote))) checks.push(`ad ${index} ${dim}: quote not in the copy: "${cell.quote}"`);
    }
    if (typeof reading.fix === 'string' && suggests(reading.fix)) checks.push(`ad ${index} fix suggests a forbidden claim: "${reading.fix}"`);
    if (OTHER_SCRIPT.test(JSON.stringify(reading))) checks.push(`ad ${index} reading slips out of Thai`);
  }
  for (const item of body.summary.ideas) if (suggests(item.text)) checks.push(`idea suggests a forbidden claim: "${item.text}"`);
  for (const item of body.summary.hooks) if (FDA.test(item.text)) checks.push(`headline uses a forbidden claim: "${item.text}"`);
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
      const set = SETS.find(item => item.name === row.set);
      results.push({...row, checks: set && row.status === 200 ? await checksFor(db, set, row.body) : []});
      console.log(`${row.status} ${row.model ?? ''} checks=${results.at(-1).checks.length} ${row.set}`);
    }
  } finally { await db.end(); }
} else {
  const api = await request.newContext({baseURL: base, storageState: auth});
  try {
    for (const set of SETS) {
      const started = Date.now();
      const response = await api.post('/api/compare/ai', {data: {ads: set.ads, dryRun: false, view: set.view}, timeout: 240_000});
      const body = await response.json().catch(() => null);
      const row = {set: set.name, view: set.view, status: response.status(), ms: Date.now() - started, model: body?.model ?? null, cost: body?.cost ?? null, error: response.ok() ? null : body?.error ?? null, checks: [], body};
      if (response.ok()) row.checks = await checksFor(db, set, body);
      results.push(row);
      console.log(`${row.status} ${row.ms}ms ${row.model ?? ''} cost=${row.cost ?? '-'} checks=${row.checks.length} ${row.set}${row.error ? ` · ${row.error}` : ''}`);
    }
  } finally {
    // The session's refresh token rotates: keep the new one for the next run.
    await api.storageState({path: auth});
    await api.dispose();
    await db.end();
  }
}
writeFileSync(out, JSON.stringify(results, null, 1));
