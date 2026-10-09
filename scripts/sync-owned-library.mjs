import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { companyRows } from "../lib/owned-ads/source-rows.ts";
import { isOwnedPerformanceDate } from "../lib/owned-ads/performance.ts";
import { readOwnedPageNames } from "./owned-page-names.mjs";

// ponytail: local sibling-project bridge. Use a source-owned authenticated export
// endpoint before moving either app to a separate host; no source writes here.
const requestedBy = process.argv[2];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const lock = await pool.connect();
let jobId;
let expectedDaily = 0;
const data = async query => {
  const result = await query;
  if (result.error) throw new Error(`Source read unavailable (${result.error.code ?? "network"})`);
  return result.data;
};
try {
  const actor = (await lock.query("select role from user_roles where user_id=$1", [requestedBy])).rows[0];
  if (!actor || !["admin","analyst"].includes(actor.role)) throw new Error("Analyst authorization required");
  const acquired = (await lock.query("select pg_try_advisory_lock(hashtext('owned_library_sync')) as ok")).rows[0].ok;
  if (!acquired) { console.log("An owned library sync is already running"); }
  else {
    await lock.query("update owned_library_syncs set status='failed',finished_at=now(),error='การซิงค์ก่อนหน้าหยุดทำงาน กรุณาดึงใหม่' where status='running'");
    // Bound storage before staging another complete inventory. Latest usable
    // data stays; vacuum lets PostgreSQL reuse pages from older derived copies.
    const pruned = await lock.query("delete from owned_library_syncs where status<>'running' and id not in (select id from owned_library_syncs where status='completed' order by finished_at desc limit 1)");
    if (pruned.rowCount) await lock.query("vacuum analyze public.owned_library_ads");
    jobId = (await lock.query("insert into owned_library_syncs(requested_by) values($1) returning id",[requestedBy])).rows[0].id;
    const sourcePath = resolve(process.env.OWNED_MANAGEMENT_PROJECT_PATH ?? "");
    const email = process.env.OWNED_MANAGEMENT_AUTHORIZED_EMAIL;
    if (!email || !process.env.OWNED_MANAGEMENT_PROJECT_PATH) throw new Error("Management source connection is not configured");
    const env = parseEnv(await readFile(resolve(sourcePath,".env.local"),"utf8"));
    const service = createClient(env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const member = await data(service.from("workspace_members").select("user_id,normalized_email,role,status").eq("normalized_email",email).single());
    if (member.role !== "admin" || member.status !== "active") throw new Error("Configured source administrator is not active");
    const appUser = await data(service.from("app_users").select("id").eq("id",member.user_id).single());
    if (!appUser) throw new Error("Source membership is unavailable");
    const config = await data(service.from("workspace_config").select("primary_connection_id").eq("singleton",true).single());
    const run = await data(service.from("meta_snapshot_runs").select("coverage_end,started_at").eq("connection_id",config.primary_connection_id).eq("status","completed").order("started_at",{ascending:false}).limit(1).single());
    const end = run.coverage_end;
    const startTime = new Date(`${end}T00:00:00Z`); startTime.setUTCDate(startTime.getUTCDate()-29);
    const start = startTime.toISOString().slice(0,10);
    // ponytail: copy at most 90 stored source days. Source retention may be shorter;
    // publish actual date bounds and never reconstruct missing older days.
    const historyTime = new Date(`${end}T00:00:00Z`); historyTime.setUTCDate(historyTime.getUTCDate()-89);
    const historyStart = historyTime.toISOString().slice(0,10);
    const accounts = await data(service.from("meta_ad_accounts").select("id,meta_account_id,name,currency").eq("connection_id",config.primary_connection_id).eq("is_selected",true).order("meta_account_id"));
    if (!accounts.length) throw new Error("No selected source accounts");
    if (accounts.some(a => !a.meta_account_id || !/^[A-Z]{3}$/.test(a.currency ?? ""))) throw new Error("A source account has missing identity or currency");
    const accountList = accounts.map(a=>({id:a.meta_account_id,name:a.name ?? a.meta_account_id,currency:a.currency}));
    await lock.query("update owned_library_syncs set source_snapshot_at=$2,date_start=$3,date_end=$4,accounts=$5::jsonb where id=$1",[jobId,run.started_at,start,end,JSON.stringify(accountList)]);
    await lock.query("insert into audit_logs(actor,action,entity_type,entity_id,after) values($1,'owned_library.sync_started','owned_library_sync',$2,$3::jsonb)",[requestedBy,jobId,JSON.stringify({accounts:accounts.length,source:"Ads Management",start,end})]);
    console.log(JSON.stringify({jobId,accounts:accounts.length,start,end}));
    const {loadWorkspaceInsights,createSupabaseWorkspaceInsightStorage} = await import(pathToFileURL(resolve(sourcePath,"src/lib/workspace-insights.ts")).href);
    const fields = ["spend","impressions","link_clicks","action_conv_started","action_purchases","action_purchase_value","video_3s","video_thruplay","action_video_views"];
    // Optional metadata: denied Page access must never block the ad/financial import.
    let pageNames = new Map();
    try { const result = await readOwnedPageNames(); pageNames=result.names;console.log(JSON.stringify({pageNames:result.report})); }
    catch { console.warn("Page names unavailable; retaining stored source names"); }
    const metric = value => {
      if (value === null || value === undefined) return null;
      if ((typeof value !== "number" && typeof value !== "string") || String(value).trim()==="") throw new Error("Invalid daily metric");
      const number = Number(value);
      if (!Number.isFinite(number) || number<0 || number>1e30) throw new Error("Invalid daily metric");
      return number;
    };
    async function syncAccount(account) {
      const loaded = await loadWorkspaceInsights(createSupabaseWorkspaceInsightStorage(service),{
        primaryConnectionId:config.primary_connection_id,
        context:{userId:member.user_id,role:member.role,requestScope:{accountMetaIds:[account.meta_account_id],pageIds:null,unitIds:null,start:historyStart,end}},
        coverageStart:historyStart,coverageEnd:end,
        selection:{entityLevel:"ad",insightFields:fields,entityFields:["name"],resolveParents:true},
      });
      const metadata = [];
      for (let offset=0;;offset+=1000) {
        const page = await data(service.from("meta_entities").select("meta_entity_id,level,name,parent_meta_id,status,effective_status,page_id,page_name,creative_title,creative_body,creative_thumbnail_url,creative_id,creative_video_id,created_time")
          .eq("ad_account_id",account.id).in("level",["ad","adset","campaign"]).order("level").order("meta_entity_id").range(offset,offset+999));
        metadata.push(...page); if (page.length<1000) break;
      }
      const inventory = metadata.filter(r=>r.level==="ad");
      const check = await service.from("meta_entities").select("meta_entity_id",{head:true,count:"exact"}).eq("ad_account_id",account.id).eq("level","ad");
      if (check.error || check.count!==inventory.length || new Set(inventory.map(r=>r.meta_entity_id)).size!==inventory.length) throw new Error("Source inventory changed while reading; refresh again");
      const adMetadata = new Map(inventory.map(row=>[row.meta_entity_id,row]));
      // Only ads that spent in the stored history (90 days). The full inventory (~73k, mostly old
      // zero-spend ads) does not fit the free database twice over; no screen ranks a never-spent ad.
      const delivered = new Set(loaded.rows.filter(row=>Number(row.spend)>0).map(row=>row.meta_entity_id));
      // Keep the existing inventory/report's 30-day totals unchanged.
      const rows = companyRows({metaAccountId:account.meta_account_id,name:account.name ?? account.meta_account_id,currency:account.currency},inventory,metadata.filter(r=>r.level!=="ad"),loaded.rows.filter(row=>row.insight_date>=start),pageNames)
        .filter(row=>delivered.has(row.ad_id))
        .map(row=>({...row,creative_id:adMetadata.get(row.ad_id)?.creative_id??null,video_id:adMetadata.get(row.ad_id)?.creative_video_id??null,created_time:adMetadata.get(row.ad_id)?.created_time??null}));
      const daily = loaded.rows.map(row=>{
        if (!isOwnedPerformanceDate(row.insight_date) || row.insight_date<historyStart || row.insight_date>end || !/^\d{1,32}$/.test(row.meta_entity_id)) throw new Error("Invalid daily identity/date");
        if (row.accountMetaId!==account.meta_account_id || row.currency!==account.currency) throw new Error("Daily account identity mismatch");
        return {
          account_id:account.meta_account_id,ad_id:row.meta_entity_id,insight_date:row.insight_date,
          ad_name:adMetadata.get(row.meta_entity_id)?.name??row.entity_name??row.meta_entity_id,currency:account.currency,
          page_id:row.pageId??null,page_name:pageNames.get(row.pageId)??row.pageName??null,unit_id:row.unitId??null,unit_name:row.unitName??null,
          spend:metric(row.spend),impressions:metric(row.impressions),clicks:metric(row.link_clicks),
          conversations:metric(row.action_conv_started),purchases:metric(row.action_purchases),purchase_value:metric(row.action_purchase_value),
          video_3s:metric(row.video_3s),thruplays:metric(row.video_thruplay),video_views:metric(row.action_video_views),
        };
      });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let offset=0;offset<rows.length;offset+=500) {
          await client.query(`insert into owned_library_ads(sync_id,account_id,ad_id,ad_name,account_name,campaign_name,page_name,status,currency,spend,data)
            select $1,r->>'account_id',r->>'ad_id',r->>'ad_name',r->>'account_name',r->>'campaign_name',r->>'page_name',r->>'status',r->>'currency',(r->>'spend')::numeric,r
            from jsonb_array_elements($2::jsonb) r`,[jobId,JSON.stringify(rows.slice(offset,offset+500))]);
        }
        for (let offset=0;offset<daily.length;offset+=1000) {
          await client.query(`insert into owned_library_daily(sync_id,account_id,ad_id,insight_date,ad_name,currency,page_id,page_name,unit_id,unit_name,spend,impressions,clicks,conversations,purchases,purchase_value,video_3s,thruplays,video_views)
            select $1,r.* from jsonb_to_recordset($2::jsonb) r(account_id text,ad_id text,insight_date date,ad_name text,currency text,page_id text,page_name text,unit_id uuid,unit_name text,spend numeric,impressions numeric,clicks numeric,conversations numeric,purchases numeric,purchase_value numeric,video_3s numeric,thruplays numeric,video_views numeric)`,
            [jobId,JSON.stringify(daily.slice(offset,offset+1000))]);
        }
        const stored = (await client.query("select count(*)::int as count from owned_library_ads where sync_id=$1 and account_id=$2",[jobId,account.meta_account_id])).rows[0].count;
        if (stored!==rows.length) throw new Error("Destination count mismatch");
        const storedDaily = (await client.query("select count(*)::int as count from owned_library_daily where sync_id=$1 and account_id=$2",[jobId,account.meta_account_id])).rows[0].count;
        if (storedDaily!==daily.length) throw new Error("Destination daily count mismatch");
        await client.query("update owned_library_syncs set completed_accounts=completed_accounts+1,ad_count=ad_count+$2 where id=$1",[jobId,stored]);
        await client.query("insert into audit_logs(actor,action,entity_type,entity_id,after) values($1,'owned_library.account_synced','owned_library_sync',$2,$3::jsonb)",[requestedBy,jobId,JSON.stringify({accountId:account.meta_account_id,sourceInventory:inventory.length,sourceDeliveredAds:new Set(loaded.rows.filter(r=>r.insight_date>=start).map(r=>r.meta_entity_id)).size,exportedAds:rows.length,storedAds:stored,storedDaily,historyStart,end})]);
        await client.query("COMMIT");
        expectedDaily += storedDaily;
        console.log(JSON.stringify({account:account.meta_account_id,inventory:inventory.length,stored,daily:storedDaily}));
      } catch(error) { await client.query("ROLLBACK");throw error; } finally {client.release();}
    }
    for (let offset=0;offset<accounts.length;offset+=4) {
      const batch = await Promise.allSettled(accounts.slice(offset,offset+4).map(syncAccount));
      const failure = batch.find(r=>r.status==="rejected");
      if (failure) throw failure.reason;
    }
    await lock.query("BEGIN");
    const verified = (await lock.query("select s.ad_count,s.completed_accounts,jsonb_array_length(s.accounts) as expected_accounts,(select count(*)::int from owned_library_ads where sync_id=s.id) as stored from owned_library_syncs s where id=$1 for update",[jobId])).rows[0];
    if (verified.ad_count!==verified.stored || verified.completed_accounts!==verified.expected_accounts) throw new Error("Incomplete source sync");
    const dailyVerified = (await lock.query("select count(*)::int as count,min(insight_date) as first_date,max(insight_date) as last_date from owned_library_daily where sync_id=$1",[jobId])).rows[0];
    if (dailyVerified.count!==expectedDaily) throw new Error("Incomplete daily source sync");
    await lock.query("update owned_library_syncs set status='completed',finished_at=now(),daily_ready=true,daily_from=$2,daily_to=$3 where id=$1",[jobId,dailyVerified.first_date,dailyVerified.last_date]);
    await lock.query("insert into audit_logs(actor,action,entity_type,entity_id,after) values($1,'owned_library.sync_completed','owned_library_sync',$2,$3::jsonb)",[requestedBy,jobId,JSON.stringify({...verified,daily:dailyVerified})]);
    // Keep only the snapshot just published (storage budget); the previous one is removed
    // in the same transaction, so readers switch from old to new with nothing in between.
    await lock.query("delete from owned_library_syncs where status<>'running' and id<>$1",[jobId]);
    await lock.query("COMMIT");
    console.log(JSON.stringify({jobId,status:"completed",...verified}));
    // Otherwise the first readers of a fresh snapshot pay for it (hint bits on every new row, stale
    // statistics): measured 9.6 s for the command center against the 8 s statement timeout, 1-2 s after.
    // Best effort: the snapshot is already published.
    await lock.query("vacuum (analyze) public.owned_library_daily, public.owned_library_ads").catch(()=>console.error("Owned sync vacuum skipped"));
  }
} catch(error) {
  await lock.query("ROLLBACK").catch(()=>{});
  if (jobId) await lock.query("update owned_library_syncs set status='failed',finished_at=now(),error='ดึงข้อมูลไม่ครบ กรุณาลองซิงค์ใหม่ ข้อมูลชุดก่อนหน้ายังใช้งานได้' where id=$1",[jobId]);
  // Provider/PG errors may contain credentials; log only safe error classes.
  console.error("Owned sync failed",{jobId,errorClass:error?.constructor?.name});
  process.exitCode=1;
} finally {
  await lock.query("select pg_advisory_unlock(hashtext('owned_library_sync'))").catch(()=>{});
  lock.release();await pool.end();
}
