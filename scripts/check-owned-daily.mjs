import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Real stored destination data only. No fixtures, sync, source reads or provider calls.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
let stage = 'connection';
try {
  await db.connect();
  await db.query('begin isolation level repeatable read read only');
  await db.query("set local statement_timeout = '60s'");
  stage = 'existing actors and completed daily snapshot';
  const { email } = JSON.parse(await readFile('e2e/.auth/trial-credentials.json', 'utf8'));
  const analyst = (await db.query("select r.user_id from public.user_roles r join auth.users u on u.id=r.user_id where lower(u.email)=lower($1) and r.role in ('analyst','admin')", [email])).rows[0];
  const viewer = (await db.query("select user_id from public.user_roles where role='viewer' limit 1")).rows[0];
  assert.ok(analyst && viewer, 'Existing trial analyst and viewer roles are required');
  const snapshot = (await db.query("select id,daily_from::text,daily_to::text from public.owned_library_syncs where status='completed' and daily_ready order by finished_at desc limit 1")).rows[0];
  assert.ok(snapshot?.daily_from && snapshot.daily_to, 'A populated completed daily snapshot is required');
  const from = new Date(`${snapshot.daily_to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const periodFrom = from.toISOString().slice(0, 10);
  const fields = ['spend', 'impressions', 'conversations', 'purchases', 'purchase_value', 'video_3s', 'thruplays', 'video_views'];
  const as = async (id, role = 'authenticated') => {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ ...(id ? { sub: id } : {}), role })]);
  };
  const rpc = (page, sort='spend') => db.query("select public.owned_performance_page($1,$2::date,$3::date,'','','',$5,'',$4::integer) data", [snapshot.id, periodFrom, snapshot.daily_to, page, sort]);
  const close = (actual, expected, label) => {
    if (expected === null) assert.equal(actual, null, `${label}: missing must remain null`);
    else assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${label}: stored totals must match`);
  };
  const totals = rows => Object.fromEntries(fields.map(field => [field, rows.every(row => row[field] !== null) ? rows.reduce((sum, row) => sum + Number(row[field]), 0) : null]));
  const ratio = (sum, top, bottom) => sum[top] !== null && sum[bottom] !== null && sum[bottom] > 0 ? sum[top] / sum[bottom] : null;
  stage = 'authorized real ad/day rows';
  await as(analyst.user_id);
  const direct = (await db.query(`select d.account_id,d.ad_id,d.currency,${fields.map(field => `d.${field}`).join(',')}
    from public.owned_library_daily d
    where d.sync_id=$1 and d.insight_date between $2::date and $3::date
      and (d.account_id,d.ad_id,d.currency) in (
        select account_id,ad_id,currency from public.owned_library_daily
        where sync_id=$1 and insight_date between $2::date and $3::date and spend>0
      )`, [snapshot.id, periodFrom, snapshot.daily_to])).rows;
  assert.ok(direct.length, 'The latest imported seven-day period must contain eligible real rows');
  const currencies = new Map(), ads = new Map();
  for (const row of direct) {
    const key = `${row.account_id}:${row.ad_id}:${row.currency}`;
    if (!currencies.has(row.currency)) currencies.set(row.currency, []);
    if (!ads.has(key)) ads.set(key, []);
    currencies.get(row.currency).push(row);
    ads.get(key).push(row);
  }
  stage = 'RPC count, page limit and weighted per-currency totals';
  const actual = (await rpc(0)).rows[0].data;
  assert.equal(actual.total, ads.size);
  assert.equal(actual.rows.length, Math.min(24, ads.size));
  assert.equal(actual.summary.length, currencies.size);
  let missingChecks = 0;
  for (const summary of actual.summary) {
    const rows = currencies.get(summary.currency), sum = totals(rows);
    assert.equal(summary.daily_rows, rows.length);
    assert.equal(summary.ad_count, new Set(rows.map(row => `${row.account_id}:${row.ad_id}`)).size);
    for (const field of ['spend', 'impressions', 'conversations', 'purchases', 'purchase_value', 'video_views']) {
      close(summary[field], sum[field], `summary ${field}`);
      if (sum[field] === null) missingChecks++;
    }
    close(summary.roas, ratio(sum, 'purchase_value', 'spend'), 'weighted ROAS');
    close(summary.cost_per_conversation, ratio(sum, 'spend', 'conversations'), 'weighted conversation cost');
    close(summary.hook_rate, ratio(sum, 'video_views', 'impressions'), 'weighted hook rate');
    assert.equal(summary.close_rate, null, 'Unavailable CRM closes cannot become Meta purchases');
    for (const [field, coverage] of Object.entries(summary.coverage)) {
      const needed = field === 'roas' ? ['spend', 'purchase_value'] : field === 'hook_rate' ? ['video_views', 'impressions'] : [field];
      assert.equal(coverage.present, rows.filter(row => needed.every(key => row[key] !== null)).length);
      assert.equal(coverage.total, rows.length);
    }
  }
  for (const row of actual.rows) {
    const sum = totals(ads.get(`${row.account_id}:${row.ad_id}:${row.currency}`));
    for (const field of fields.filter(field => field !== 'video_views')) {
      close(row[field], sum[field], `card ${field}`);
      if (sum[field] === null) missingChecks++;
    }
    close(row.cost_per_conversation, ratio(sum, 'spend', 'conversations'), 'card conversation cost');
    close(row.hook_rate, ratio(sum, 'video_views', 'impressions'), 'card hook rate');
  }
  const last = (await rpc(Math.floor((ads.size - 1) / 24))).rows[0].data;
  assert.equal(last.total, ads.size);
  assert.equal(last.rows.length, (ads.size - 1) % 24 + 1);
  assert.deepEqual(last.summary, actual.summary, 'Summary covers the full matching set on every page');
  stage = 'imported first dates on ordinary and newest rankings';
  const newest=(await rpc(0,'newest')).rows[0].data;
  assert.deepEqual(newest.summary,actual.summary,'Ranking cannot change summary totals');
  const displayed=[...actual.rows,...newest.rows];
  const starts=(await db.query('select account_id,ad_id,min(insight_date)::text first_date from public.owned_library_daily where sync_id=$1 and spend>0 and ad_id=any($2::text[]) group by account_id,ad_id',[snapshot.id,[...new Set(displayed.map(row=>row.ad_id))]])).rows;
  const firstDates=new Map(starts.map(row=>[`${row.account_id}:${row.ad_id}`,row.first_date]));
  for(const row of displayed)assert.equal(row.delivery_first,firstDates.get(`${row.account_id}:${row.ad_id}`),'Card keeps its actual earliest imported spend date');
  assert.ok(newest.rows.every((row,index)=>index===0||row.currency!==newest.rows[index-1].currency||row.delivery_first<=newest.rows[index-1].delivery_first),'Newest sorts by actual imported start date within each currency');
  stage = 'financial RLS for viewer and unauthenticated roles';
  for (const [id, role] of [[viewer.user_id, 'authenticated'], [null, 'authenticated'], [null, 'anon']]) {
    await as(id, role);
    await db.query('savepoint financial_guard');
    await assert.rejects(rpc(0), { code: '42501' });
    await db.query('rollback to savepoint financial_guard');
    if (role === 'authenticated') assert.equal((await db.query('select ad_id from public.owned_library_daily limit 1')).rowCount, 0);
    else {
      await db.query('savepoint direct_guard');
      await assert.rejects(db.query('select ad_id from public.owned_library_daily limit 1'), { code: '42501' });
      await db.query('rollback to savepoint direct_guard');
    }
  }
  console.log(`PASS: real seven-day daily/RPC totals; ${ads.size} eligible ads, ${direct.length} stored days, ${currencies.size} currencies; complete pagination and weighted metrics; CRM stays null; viewer and unauthenticated financial access blocked. ${missingChecks ? `${missingChecks} actual missing metric checks passed.` : 'No missing metrics occurred in this real period; the missing-value path was not exercised with fixtures.'} Read-only transaction rolled back.`);
} catch (error) {
  console.error(`Owned daily check failed (${stage}):`, error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.query('rollback').catch(() => {});
  await db.end();
}
