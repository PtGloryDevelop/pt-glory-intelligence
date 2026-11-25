import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ownedPageChoices } from "../lib/owned-ads/page-names.ts";

/**
 * 0081 — the page filter lists the pages the ads list can show for the chosen unit and period (25 Nov).
 *
 * "U9 ลาว" listed every page that had ever been in it since the snapshot's first day. "Levonglow Th" had left it
 * for U24 in early November, so choosing it over the last 3 days emptied "ผลแอดเรา" with no reason given, and
 * the only way back cleared the unit too.
 */
const migration = join("supabase", "migrations", "0081_owned_page_choices.sql");
const read = (path: string) => readFileSync(path, "utf8");

test("the page list holds pages with spend in the chosen period and unit, and keeps the chosen page", () => {
  assert.ok(existsSync(migration), "0081 defines the page list");
  const up = read(migration);
  assert.match(up, /CREATE OR REPLACE FUNCTION public\.owned_page_choices\(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text\)/);
  assert.match(up, /not in \('analyst','admin'\)/, "same role check as the ads list");
  // The ads list counts an ad only if it spent on a day of the period (having bool_or(spend>0)).
  assert.match(up, /d\.insight_date between p_from and p_to and d\.spend>0 and \(p_unit='' or d\.unit_id::text=p_unit\)/);
  assert.match(up, /where in_period or page_id=p_page_id/, "the chosen page stays listed so the picker can show it");
  assert.match(up, /'in_period',n\.in_period/);
  assert.match(up, /'elsewhere'/, "a chosen page without spend says which units it spent under instead");
  assert.match(up, /revoke all on function public\.owned_page_choices\(uuid, date, date, text, text\) from public, anon;/);
  assert.match(up, /grant execute on function public\.owned_page_choices\(uuid, date, date, text, text\) to authenticated, service_role;/);
  const down = read(migration.replace(/\.sql$/, ".down.sql"));
  assert.match(down, /drop function if exists public\.owned_page_choices\(uuid, date, date, text, text\);/);
});

test("every owned performance read answers with that list, not the snapshot-wide one", () => {
  const source = read(join("lib", "owned-ads", "performance-read.ts"));
  assert.match(source, /const choicesArgs = \{ p_sync: stored!\.id, p_from: period\.from, p_to: period\.to, p_unit: query\.unit, p_page_id: query\.pageId \};/);
  assert.match(source, /db\.rpc\("owned_page_choices", choicesArgs\)/);
  assert.match(source, /output\.filters = \{ \.\.\.output\.filters, pages: /);
});

test("a chosen page without spend in the period is labelled and keeps where it spent", () => {
  const choices = ownedPageChoices([
    { id: "549002514973214", name: "ชาสมุนไพรแม่แย้ม ตรา LeVonglow Thailand", in_period: true },
    { id: "698148520039634", name: "Levonglow Th-ชาแม่แย้มเพื่อสุขภาพ", in_period: false, elsewhere: [{ id: "e10087c0-edae-4f8b-b68a-63a239765bcc", name: "U24" }] },
    { id: "100", name: "100" },
  ]);
  const chosen = choices.find(page => page.id === "698148520039634")!;
  assert.equal(chosen.label, "Levonglow Th-ชาแม่แย้มเพื่อสุขภาพ · ไม่มีค่าแอดช่วงนี้");
  assert.equal(chosen.in_period, false);
  assert.deepEqual(chosen.elsewhere, [{ id: "e10087c0-edae-4f8b-b68a-63a239765bcc", name: "U24" }]);
  // Pages with spend, and lists from before 0081 (no flag), read as they did.
  assert.equal(choices.find(page => page.id === "549002514973214")!.label, "ชาสมุนไพรแม่แย้ม ตรา LeVonglow Thailand");
  assert.equal(choices.find(page => page.id === "100")!.label, "ยังไม่มีชื่อเพจ · 100");
  assert.equal(choices.find(page => page.id === "100")!.in_period, true);
});

test("an empty result with a page chosen says so and clears only the page", () => {
  const ui = read(join("app", "(app)", "owned-performance.tsx"));
  assert.match(ui, /data-testid="performance-page-empty"/);
  assert.match(ui, /onClick=\{\(\) => change\(\{ pageId: "" \}\)\}/, "a way back that keeps the unit and period");
  assert.match(ui, /onClick=\{\(\) => change\(\{ unit: unit\.id \?\? "" \}\)\}/, "and one to where the page spent, keeping the page");
});
