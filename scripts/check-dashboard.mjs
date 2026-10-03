/** Bounded transaction check: fixtures and claims are always rolled back.
 * Never resets tables, creates users, or changes existing research data. */
import assert from 'node:assert/strict';
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
  await db.query('begin');
  const roles=(await db.query("select user_id,role from public.user_roles where role in ('analyst','viewer')")).rows;
  const analyst=roles.find(row=>row.role==='analyst')?.user_id;
  const viewer=roles.find(row=>row.role==='viewer')?.user_id;
  assert.ok(analyst&&viewer,'Existing analyst and viewer accounts are required');
  const signature='public.dashboard_owned_summary()';
  for(const fn of [signature,'public.dashboard_rival_summary()']){
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[fn])).rows[0].ok,false);
  }
  for(const fn of ['public.dashboard_owned_compute(uuid)','public.dashboard_owned_publish()']){
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') ok",[fn])).rows[0].ok,false);
  }
  const snapshot=(await db.query("insert into public.owned_library_syncs(status,finished_at,date_start,date_end,accounts,ad_count) values ('completed',now()+interval '1 day','2026-09-02','2026-10-01','[]',4) returning id")).rows[0].id;
  const ads=[
    {ad_id:'1',currency:'THB',spend:10,purchase_value:50,purchases:1,conversations:0},
    {ad_id:'2',currency:'THB',spend:90,purchase_value:90,purchases:3,conversations:2},
    {ad_id:'3',currency:'THB',spend:null,purchase_value:null,purchases:null,conversations:null},
    {ad_id:'4',currency:'USD',spend:20,purchase_value:0,purchases:0,conversations:0},
  ];
  for(const ad of ads)await db.query("insert into public.owned_library_ads(sync_id,account_id,ad_id,ad_name,account_name,campaign_name,status,currency,spend,data) values ($1,'dashboard-check',$2,'check','check','check','ACTIVE',$3,$4,$5)",[snapshot,ad.ad_id,ad.currency,ad.spend,JSON.stringify(ad)]);
  await db.query("update public.owned_library_syncs set status='completed' where id=$1",[snapshot]);
  const as=async(id)=>{
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated'})]);
  };
  await as(analyst);
  let result=(await db.query('select public.dashboard_owned_summary() data')).rows[0].data;
  assert.equal(result.inventory,4);assert.equal(result.metricsAds,3);
  const thb=result.currencies.find(row=>row.currency==='THB');
  assert.equal(thb.inventory,3);assert.equal(thb.metricsAds,2);
  assert.equal(thb.metrics.spend.value,100);assert.equal(thb.metrics.roas.value,1.4);
  assert.equal(thb.metrics.conversations.value,2);
  assert.equal(result.currencies.find(row=>row.currency==='USD').metrics.roas.value,0);
  assert.equal(result.topAds.length,3,'Undelivered inventory is not ranked as performance');
  await db.query('reset role');
  await db.query("update public.owned_library_ads set data=jsonb_set(data,'{purchase_value}','null'::jsonb) where sync_id=$1 and ad_id='2'",[snapshot]);
  await db.query("update public.owned_library_syncs set status='completed' where id=$1",[snapshot]);
  await as(analyst);
  result=(await db.query('select public.dashboard_owned_summary() data')).rows[0].data;
  const partial=result.currencies.find(row=>row.currency==='THB').metrics;
  assert.equal(partial.purchase_value.value,null);assert.equal(partial.purchase_value.reportedValue,50);
  assert.equal(partial.purchase_value.present,1);assert.equal(partial.purchase_value.total,2);assert.equal(partial.roas.value,null);
  await db.query('reset role');
  // A not-yet-published snapshot must not displace the complete one. Using
  // failed avoids taking the worker's one-running slot during a live check.
  const next=(await db.query("insert into public.owned_library_syncs(status,finished_at,date_start,date_end,accounts,ad_count) values ('failed',now()+interval '2 days','2026-09-02','2026-10-01','[]',1) returning id")).rows[0].id;
  await db.query("insert into public.owned_library_ads(sync_id,account_id,ad_id,ad_name,account_name,campaign_name,status,currency,spend,data) values ($1,'dashboard-check','5','check','check','check','ACTIVE','THB',20,$2)",[next,JSON.stringify({ad_id:'5',currency:'THB',spend:20,purchase_value:0,purchases:0,conversations:0})]);
  await as(analyst);
  assert.equal((await db.query('select public.dashboard_owned_summary() data')).rows[0].data.snapshot.id,snapshot);
  await db.query('reset role');await db.query("update public.owned_library_syncs set status='completed' where id=$1",[next]);
  await as(analyst);
  const published=(await db.query('select public.dashboard_owned_summary() data')).rows[0].data;
  assert.equal(published.snapshot.id,next);assert.equal(published.inventory,1);assert.equal(published.currencies[0].metrics.spend.value,20);
  await as(viewer);
  await db.query('savepoint viewer_guard');
  await assert.rejects(db.query('select public.dashboard_owned_summary()'),{code:'42501'});
  await db.query('rollback to savepoint viewer_guard');
  assert.equal((await db.query('select count(*) n from public.owned_library_ads where sync_id=$1',[snapshot])).rows[0].n,'0');
  const rival=(await db.query('select public.dashboard_rival_summary() data')).rows[0].data;
  const distinct=(await db.query("select count(*) n from public.page_scope_observations('all',null)")).rows[0].n;
  assert.equal(rival.ads,Number(distinct));assert.equal(rival.ads,rival.active+rival.inactive+rival.unknown);
  console.log('Dashboard check passed: weighted ROAS, currencies, null coverage, complete snapshots, role boundary, deduplicated rivals');
}finally{await db.query('rollback');await db.end();}
