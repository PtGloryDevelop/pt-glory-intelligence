import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 0067 — the owned library reads that timed out on a cold database cache (21 Oct).
 *
 * The library page answered 503 ("ข้อมูลผลลัพธ์รายวันยังไม่พร้อมใช้งาน") whenever its first read of the day
 * found the cache cold: one heap read per ad for keys the page needs, and a read of every daily row of the
 * snapshot to list units and pages. Postgres cancelled it at the 8 s statement timeout (57014). Before the
 * migration was applied, the live and new bodies were run side by side on the pilot data for 24 filter sets
 * and returned identical JSON; these checks keep the shape that made them fast from quietly coming back.
 */
const up = readFileSync(join("supabase", "migrations", "0067_owned_reads_cold_cache.sql"), "utf8");
const down = readFileSync(join("supabase", "migrations", "0067_owned_reads_cold_cache.down.sql"), "utf8");
const fn = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return sql.slice(start, sql.indexOf("$function$;", start));
};

test("the per-ad keys the library reads come from a covering index", () => {
  assert.match(up, /create index if not exists owned_library_ads_keys on public\.owned_library_ads\(sync_id,account_id,ad_id\) include \(media_key,meta_created_time,status\)/);
  assert.match(up, /create index if not exists owned_daily_spend_dates on public\.owned_library_daily\(sync_id,account_id,ad_id,insight_date\) where spend>0/);
});

test("the units and pages lists probe the index once per value instead of reading every daily row", () => {
  for (const name of ["owned_media_page", "owned_performance_page"]) {
    const body = fn(up, name);
    assert.match(body, /with recursive matching_ads/, name);
    assert.match(body, /unit_keys\(unit_id\) as \(/, name);
    assert.match(body, /page_keys\(page_id\) as \(/, name);
    assert.doesNotMatch(body, /select distinct on \(unit_id\)/, `${name} must not go back to a full read for units`);
    assert.doesNotMatch(body, /select distinct on \(page_id\)/, `${name} must not go back to a full read for pages`);
    // The page list still honours the unit filter, as before.
    assert.match(body, /d\.page_id>k\.page_id\s+and \(p_unit='' or d\.unit_id::text=p_unit\)/, name);
  }
});

test("Command Center's oldest list reads the stored created time, not each ad's whole JSON", () => {
  const body = fn(up, "owned_command_center");
  assert.doesNotMatch(body, /a\.data->>'created_time'/);
  assert.match(body, /a\.meta_created_time is not null/);
  assert.match(body, /order by a\.meta_created_time::timestamptz,p\.account_id,p\.ad_id limit 10/);
});

test("the rollback restores all three reads and drops both indexes", () => {
  for (const name of ["owned_media_page", "owned_performance_page", "owned_command_center"]) assert.ok(fn(down, name), name);
  assert.match(fn(down, "owned_media_page"), /select distinct on \(unit_id\)/, "the previous units read comes back");
  assert.match(fn(down, "owned_command_center"), /a\.data->>'created_time' is not null/);
  assert.match(down, /drop index if exists public\.owned_daily_spend_dates;/);
  assert.match(down, /drop index if exists public\.owned_library_ads_keys;/);
});

test("a failed library read says why in the log instead of a silent 503", () => {
  const route = readFileSync(join("app", "api", "owned-ads", "performance", "route.ts"), "utf8");
  assert.match(route, /console\.error\("Owned performance unavailable", \{ code: cause\?\.code/);
  const read = readFileSync(join("lib", "owned-ads", "performance-read.ts"), "utf8");
  assert.match(read, /throw new Error\("Owned daily performance unavailable", \{ cause: current\.error \?\? prior\?\.error \}\)/);
});
