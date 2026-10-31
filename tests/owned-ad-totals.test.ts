import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * 0078 — the compare page's whole-window read of our ads timed out (57014, 31 Oct): 11,459 ads and 89,745
 * daily rows regrouped on every read. The grouping is now stored once per sync. Before the migration was
 * applied, the stored and live paths returned identical JSON on the pilot data for 17 filter sets (every sort,
 * status, search and page), for periods covering the window (this month, wider) and for searches on an ad with
 * daily rows but no inventory row.
 */
const up = readFileSync("supabase/migrations/0078_owned_ad_totals.sql", "utf8");
const down = readFileSync("supabase/migrations/0078_owned_ad_totals.down.sql", "utf8");

test("stored totals answer only a period covering a published snapshot's window, unfiltered by unit or page", () => {
  // A covering period (all days, this month) reads exactly the window's daily rows.
  assert.match(up, /where w\.sync_id=p_sync and p_from<=w\.from_date and p_to>=w\.to_date\s+and s\.status='completed' and s\.daily_ready and s\.daily_from=w\.from_date and s\.daily_to=w\.to_date/);
  assert.match(up, /if not found or p_unit<>'' or p_page_id<>'' or \(p_search<>'' and v_changing>0\) then\s+return public\.owned_performance_page_live\(/);
});

test("the stored rows are built from the live body's own grouping", () => {
  // The same candidates and days as owned_performance_page, over the snapshot's daily_from..daily_to.
  assert.match(up, /select d\.\* from public\.owned_library_daily d where d\.sync_id=p_sync and d\.insight_date between v_from and v_to/);
  assert.match(up, /e\.account_id=c\.account_id and e\.ad_id=c\.ad_id and e\.currency=c\.currency and e\.spend>0/);
  // The summary adds per-ad counts and sums, so any subset of ads totals the same as the live rows.
  assert.match(up, /case when sum\(n_spend\)=sum\(n_rows\) then sum\(s_spend\) end spend/);
});

test("a build is made on publish and never fails the publish", () => {
  assert.match(up, /after update of status, daily_ready, daily_from, daily_to on public\.owned_library_syncs\s+for each row when \(new\.status='completed' and new\.daily_ready\)/);
  assert.match(up, /exception when others then\s+raise warning 'owned ad totals not built/);
  assert.match(up, /select public\.owned_build_ad_totals\(id\) from public\.owned_library_syncs/, "the published snapshot is built by the migration");
});

test("the totals are not readable directly, and the rollback restores the live function", () => {
  assert.match(up, /revoke all on table public\.owned_library_window, public\.owned_library_ad_totals from public, anon, authenticated/);
  assert.match(up, /revoke all on function public\.owned_build_ad_totals\(uuid\) from public, anon, authenticated/);
  assert.match(down, /alter function public\.owned_performance_page_live\(uuid, date, date, text, text, text, text, text, integer\) rename to owned_performance_page;/);
  assert.match(down, /grant execute on function public\.owned_performance_page\(uuid, date, date, text, text, text, text, text, integer\) to authenticated, service_role;/);
  assert.match(down, /drop table if exists public\.owned_library_ad_totals;/);
});
