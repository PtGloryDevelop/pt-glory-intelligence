import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { OWNED_CSV_HEADERS } from "../lib/owned-ads/model.ts";

// Local connection test: reads the source's existing authorized snapshot loader;
// no source writes, Meta calls, or credentials are sent to the browser.
const sourcePath = process.argv[2];
const email = process.argv[3];
assert.ok(sourcePath && email, "Source project path and authorized workspace email are required");
const env = parseEnv(await readFile(`${sourcePath}/.env.local`, "utf8"));
const service = createClient(env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const result = async (query) => { const { data, error } = await query; if (error) throw new Error(`Source read failed: ${error.code}`); return data; };
const member = await result(service.from("workspace_members").select("user_id,role,status").eq("normalized_email", email).single());
assert.equal(member.status, "active");
assert.equal(member.role, "admin", "This operator test requires an existing active source administrator");
const config = await result(service.from("workspace_config").select("primary_connection_id").eq("singleton", true).single());
const run = await result(service.from("meta_snapshot_runs").select("coverage_end,started_at").eq("connection_id", config.primary_connection_id).eq("status", "completed").order("started_at", { ascending: false }).limit(1).single());
const accounts = await result(service.from("meta_ad_accounts").select("id,meta_account_id,name,currency").eq("connection_id", config.primary_connection_id).eq("is_selected", true).eq("currency", "THB"));
assert.ok(accounts.length > 0, "No selected THB accounts in source");
const delivering = await result(service.from("meta_daily_insights").select("ad_account_id").in("ad_account_id", accounts.map(a => a.id)).eq("entity_level", "ad").eq("insight_date", run.coverage_end).order("spend", { ascending: false }).limit(1));
const account = accounts.find(a => a.id === delivering[0]?.ad_account_id);
assert.ok(account, "Source has no delivered ad snapshots");
const start = new Date(`${run.coverage_end}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 6);
const dateStart = start.toISOString().slice(0, 10);
const { loadWorkspaceInsights, createSupabaseWorkspaceInsightStorage } = await import(pathToFileURL(`${sourcePath}/src/lib/workspace-insights.ts`).href);
const fields = ["spend", "impressions", "link_clicks", "action_conv_started", "action_purchases", "action_purchase_value", "video_3s", "video_thruplay"];
const loaded = await loadWorkspaceInsights(createSupabaseWorkspaceInsightStorage(service), {
  primaryConnectionId: config.primary_connection_id,
  context: { userId: member.user_id, role: member.role, requestScope: { accountMetaIds: [account.meta_account_id], pageIds: null, unitIds: null, start: dateStart, end: run.coverage_end } },
  coverageStart: dateStart, coverageEnd: run.coverage_end,
  selection: { entityLevel: "ad", insightFields: fields, entityFields: ["name"], resolveParents: true },
});
assert.ok(loaded.rows.length > 0, "Source authorization returned no rows");
const groups = Map.groupBy(loaded.rows, r => r.meta_entity_id);
const sum = (rows, field) => rows.every(r => r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]))) ? rows.reduce((v, r) => v + Number(r[field]), 0) : null;
const chosen = [...groups].sort((a,b) => (sum(b[1], "spend") ?? 0) - (sum(a[1], "spend") ?? 0)).slice(0, 30);
const meta = await result(service.from("meta_entities").select("meta_entity_id,name,status,creative_thumbnail_url").eq("ad_account_id", account.id).eq("level", "ad").in("meta_entity_id", chosen.map(([id]) => id)));
const names = new Map(meta.map(row => [row.meta_entity_id, row]));
const rows = chosen.map(([id, days]) => ({
  ad_id: id, ad_name: names.get(id)?.name ?? days[0].entity_name ?? id,
  campaign_name: days[0].campaignId ?? "ไม่ทราบแคมเปญ", adset_name: days[0].adSetId,
  status: names.get(id)?.status ?? null,
  spend: sum(days,"spend"), impressions: sum(days,"impressions"), clicks: sum(days,"link_clicks"),
  conversations: sum(days,"action_conv_started"), purchases: sum(days,"action_purchases"), purchase_value: sum(days,"action_purchase_value"),
  video_3s: sum(days,"video_3s"), thruplays: sum(days,"video_thruplay"),
  creative_url: names.get(id)?.creative_thumbnail_url ?? null, destination_url: null,
}));
const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [OWNED_CSV_HEADERS.join(","), ...rows.map(row => OWNED_CSV_HEADERS.map(key => quote(row[key])).join(","))].join("\r\n");
const payload = { name: `Ads Management · ทดสอบ ${run.coverage_end}`, account_name: account.name ?? account.meta_account_id, currency: "THB", date_start: dateStart, date_end: run.coverage_end, csv };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/trial.json" });
  const response = await ctx.request.post("http://localhost:3188/api/owned-ads/reports", { data: payload });
  const body = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(body));
  assert.equal(body.report.rows.length, rows.length);
  assert.deepEqual(body.report.rows.map(r => [r.ad_id,r.spend,r.impressions,r.purchase_value]), rows.map(r => [r.ad_id,r.spend,r.impressions,r.purchase_value]));
  await mkdir("test-artifacts/integration", { recursive: true });
  await writeFile("test-artifacts/integration/management-result.json", JSON.stringify({ reportId: body.report.id, sourceSnapshotAt: run.started_at, dateStart, dateEnd: run.coverage_end, account: payload.account_name, sourceAdDays: loaded.rows.length, importedAds: rows.length, source: "Ads Management stored snapshots", recurringConnection: false }, null, 2));
  console.log(JSON.stringify({ reportId: body.report.id, sourceAdDays: loaded.rows.length, importedAds: rows.length, metricsMatched: true }));
} finally { await browser.close(); }
