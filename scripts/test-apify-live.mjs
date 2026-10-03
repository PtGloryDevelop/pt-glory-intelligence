import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
import { chromium } from "@playwright/test";
import { advance } from "../lib/collect/machine.ts";
import { createApifyProvider } from "../lib/collect/apify.ts";
import { reconcileCost } from "../lib/collect/cost.ts";

// One real, owner-requested test. Fixed $1 ceiling; no scheduler or recurring run.
// A stored request is resumed, never replaced by another paid request on retry.
const path = "test-artifacts/integration/apify-request.json";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let browser;
const mode = process.argv[2] ?? "tick";
try {
  await mkdir("test-artifacts/integration", { recursive: true });
  let saved = await readFile(path, "utf8").then(JSON.parse).catch(() => null);
  if (mode === "start") {
    assert.equal(saved, null, "A test request already exists; use tick to resume");
    const patch = {
      enabled: true, monthly_budget_usd: 1, max_charge_per_run_usd: 1,
      billing_cycle_anchor: new Date().toISOString().slice(0,10), billing_cycle_length_months: 1,
      max_records_per_run: 10, max_export_bytes: 5_000_000, run_timeout_minutes: 5,
      reconcile_window_minutes: 5, reconcile_page_size: 20,
      cost_settle_minutes: 1, cost_final_window_hours: 1,
      result_settle_seconds: 10, result_settle_window_minutes: 5,
      max_concurrent: 1, lease_seconds: 120, countries: ["TH"],
    };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [name,value] of Object.entries(patch)) {
        const key = `collector.${name}`;
        const before = (await client.query("select value from app_settings where key=$1 for update", [key])).rows[0]?.value ?? null;
        await client.query("insert into app_settings(key,value) values($1,$2::jsonb) on conflict(key) do update set value=excluded.value", [key, JSON.stringify(value)]);
        await client.query("insert into audit_logs(action,entity_type,before,after) values('collector.settings_updated','app_setting',$1::jsonb,$2::jsonb)", [JSON.stringify({key,value:before}), JSON.stringify({key,value,source:"user_requested_single_live_test"})]);
      }
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const category = (await pool.query("select id from categories where deleted_at is null order by name limit 1")).rows[0];
    assert.ok(category, "An existing research category is required");
    saved = { requestKey: randomUUID(), keyword: "วิตามิน", categoryId: category.id };
    // Save before HTTP: an ambiguous reply is resolved using this same key.
    await writeFile(path, JSON.stringify(saved));
    browser = await chromium.launch();
    const ctx = await browser.newContext({ storageState: "e2e/.auth/trial.json" });
    try {
      const response = await ctx.request.post("http://localhost:3188/api/collections", { data: { ...saved, country: "TH", activeStatus: "active", maxRecords: 10, datasetName: "Apify · ทดสอบข้อมูลจริง · วิตามิน" } });
      const body = await response.json();
      assert.ok([200,201].includes(response.status()), JSON.stringify(body));
      console.log("Accepted real collection", body);
    } finally {
      // Admission has reserved this request's ceiling. Close new admission immediately.
      await pool.query("update app_settings set value='false'::jsonb where key='collector.enabled'");
      await pool.query("insert into audit_logs(action,entity_type,after) values('collector.settings_updated','app_setting',$1::jsonb)", [JSON.stringify({key:"collector.enabled",value:false,source:"single_live_test_admitted"})]);
    }
  }
  assert.ok(saved, "Start the test once before ticking");
  const request = (await pool.query("select id,status,provider_run_id,dataset_id,cost_status,cost_provisional_usd,cost_final_usd,result from collection_requests where request_key=$1", [saved.requestKey])).rows[0];
  assert.ok(request, "No admitted request exists for the saved key");
  const settings = new Map((await pool.query("select key,value from app_settings where key in ('collector.actor','collector.actor_build')")).rows.map(r=>[r.key,r.value]));
  const provider = createApifyProvider({ actor: settings.get("collector.actor"), build: settings.get("collector.actor_build") });
  if (mode !== "status") {
    console.log("Transition", await advance(request.id, { provider }));
    if (request.provider_run_id) console.log("Cost", await reconcileCost(request.id, { provider }));
  }
  const latest = (await pool.query("select id,status,provider_run_id,dataset_id,cost_status,cost_provisional_usd,cost_final_usd,result,error_class,error_detail,next_check_at from collection_requests where id=$1", [request.id])).rows[0];
  await writeFile("test-artifacts/integration/apify-result.json", JSON.stringify(latest,null,2));
  console.log(JSON.stringify(latest));
} finally {
  if (browser) await browser.close();
  await pool.end();
}
