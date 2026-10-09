import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countryLabel, suggestedDatasetName, FORM_MAX_RECORDS } from "../lib/collect/form.ts";
import { ABSOLUTE_MAX_RECORDS } from "../lib/collect/limits.ts";
import { createFakeProvider, fakeProviderEnabled } from "../lib/collect/fake-provider.ts";
import { visibleNav } from "../components/shell/nav.ts";

/**
 * C15 — the collection screens, without a browser.
 *
 * What the pages say is checked in the browser suite; what they are built from
 * is checked here: the endpoints they may call, the key that makes a second
 * click free, and the absence of anything a person should never read.
 */

const source = (...parts: string[]) => readFileSync(join(...parts), "utf8");
const collectPage = source("app", "(app)", "collect", "page.tsx");
const collectClient = source("app", "(app)", "collect", "collect-client.tsx");
const progressClient = source("app", "(app)", "collect", "[id]", "progress-client.tsx");
const collectorPage = source("app", "(app)", "collector", "page.tsx");
const collectorClient = source("app", "(app)", "collector", "collector-client.tsx");

// --- the form's own rules ----------------------------------------------------------

test("the suggested dataset name is keyword, country and the day, in Thai", () => {
  const name = suggestedDatasetName("วิตามินซี", "TH", new Date("2026-09-15T04:00:00Z"));
  assert.match(name, /^วิตามินซี · ไทย · /);
  // Buddhist-era year, like every other date in the product.
  assert.match(name, /2569/);
  assert.ok(name.length <= 200);
});

test("a country nobody has named stays its own code", () => {
  assert.equal(countryLabel("TH"), "ไทย");
  assert.equal(countryLabel("ZZ"), "ZZ");
});

test("the form can never offer more records than the request path accepts", () => {
  assert.equal(FORM_MAX_RECORDS, ABSOLUTE_MAX_RECORDS);
});

test("a very long keyword still produces a storable name", () => {
  const name = suggestedDatasetName("ก".repeat(400), "TH");
  assert.ok(name.length <= 200);
});

// --- what the pages are allowed to do ----------------------------------------------

test("the collection screens speak only to the product's own API", () => {
  for (const [name, code] of [
    ["collect form", collectClient],
    ["progress", progressClient],
    ["collector", collectorClient],
  ] as const) {
    // Admin settings may name the Actor; all provider calls and secrets stay server-side.
    if (name !== "collector") assert.doesNotMatch(code, /apify|actor/i, name);
    assert.doesNotMatch(code, /api\.apify\.com|startRun|advance\(|process\.env/, name);
    // No privileged database client in a browser bundle.
    assert.doesNotMatch(code, /db\/privileged|withTransaction/, name);
  }

  // The form posts to the one admission entrance, after creating a new category
  // name through the categories API when needed; the progress view only reads.
  assert.match(collectClient, /fetch\("\/api\/collections"/);
  assert.deepEqual([...collectClient.matchAll(/fetch\("([^"]+)"/g)].map((found) => found[1]).sort(), ["/api/categories", "/api/collections"]);
  assert.equal(collectClient.match(/method: "POST"/g)?.length, 2);
  assert.match(progressClient, /fetch\(`\/api\/collections\/\$\{collection\.id\}`/);
  assert.doesNotMatch(progressClient, /method: "POST"/);
  // And never the machine's own sweep endpoint.
  assert.doesNotMatch(progressClient, /collections\/advance/);
  assert.doesNotMatch(collectClient, /collections\/advance/);
});

test("the idempotency key is made once, on the server", () => {
  // Generated when the page renders and handed to the form as a prop. A key
  // made in the browser would change on re-render, and each change is another
  // paid collection.
  assert.match(collectPage, /randomUUID\(\)/);
  assert.match(collectPage, /requestKey=\{randomUUID\(\)\}/);
  assert.doesNotMatch(collectClient, /randomUUID|crypto\.randomUUID|Math\.random/);
  // The form sends the key it was given, unchanged.
  assert.match(collectClient, /requestKey,/);
});

test("polling stops once a collection cannot change by itself", () => {
  assert.match(progressClient, /const SETTLED = new Set\(\["succeeded", "failed", "needs_admin"\]\)/);
  assert.match(progressClient, /if \(settled\) return;/);
  // One timer, cleared when the component goes away.
  assert.match(progressClient, /clearInterval\(timer\)/);
});

test("a completed collection with no ads offers no dataset to open", () => {
  // Zero result is a finished collection, not an error and not a broken link.
  assert.match(progressClient, /ads === 0/);
  assert.match(progressClient, /ไม่พบโฆษณาตามเงื่อนไขนี้/);
  assert.match(progressClient, /collection\.datasetId &&/);
});

test("every collection screen authorizes on the server", () => {
  assert.match(collectPage, /satisfies\(actor\.role, "analyst"\)/);
  assert.match(collectPage, /forbidden\(\)/);
  assert.match(source("app", "(app)", "collect", "[id]", "page.tsx"), /satisfies\(actor\.role, "analyst"\)/);
  assert.match(collectorPage, /satisfies\(actor\.role, "admin"\)/);
  assert.match(collectorPage, /forbidden\(\)/);
});

// --- the admin page's language ------------------------------------------------------

test("held money, provisional figures and settled cost are named separately", () => {
  assert.match(collectorClient, /ยอดที่กันไว้/);
  assert.match(collectorClient, /ค่าใช้จ่ายจริงที่สรุปแล้ว/);
  assert.match(collectorClient, /provisional/);
  // Never called spend, and never confused with what an advertiser pays.
  assert.match(collectorClient, /ไม่ใช่ค่าโฆษณา/);
  assert.match(collectorClient, /ยังไม่ใช่ค่าใช้จ่ายจริง/);
});

test("releasing a held reservation says exactly what it does and does not do", () => {
  assert.match(collectorClient, /เปลี่ยนเฉพาะยอดที่ PT Glory กันไว้/);
  assert.match(collectorClient, /ไม่ได้แปลว่าผู้ให้บริการไม่คิดเงิน/);
  // A reason is required before the button will send anything.
  assert.match(collectorClient, /NEEDS_REASON/);
  assert.match(collectorClient, /reason\.trim\(\) === "" \|\| busy !== null/);
});

test("the admin page offers no way to start a run again", () => {
  assert.doesNotMatch(collectorClient, /start_again|startRun|restart/i);
  // Only the five frozen recovery actions.
  for (const action of [
    "retry_settlement", "reconcile_original_start", "retry_cost_reconciliation",
    "fail_collection", "release_unresolved_reservation",
  ]) {
    assert.ok(collectorClient.includes(action), action);
  }
});

// --- navigation, now that the pages exist -------------------------------------------

test("the menu leads to pages that exist", () => {
  const analyst = visibleNav("analyst").flatMap((section) => section.items);
  const admin = visibleNav("admin").flatMap((section) => section.items);
  assert.equal(analyst.find((item) => item.label === "เก็บข้อมูลใหม่")?.href, "/collect");
  assert.equal(admin.find((item) => item.label === "ค่าเก็บข้อมูล")?.href, "/collector");
  assert.equal(admin.find((item) => item.label === "นำเข้าไฟล์ (กู้คืนระบบ)")?.href, "/import");
  // A viewer still receives none of them.
  const viewer = visibleNav("viewer").flatMap((section) => section.items).map((item) => item.label);
  for (const label of ["เก็บข้อมูลใหม่", "ค่าเก็บข้อมูล", "นำเข้าไฟล์ (กู้คืนระบบ)"]) {
    assert.ok(!viewer.includes(label), label);
  }
});

// --- the fake collector ------------------------------------------------------------

test("the fake collector refuses to exist without both guards", () => {
  assert.equal(fakeProviderEnabled({ PT_GLORY_ENV: "test" }), false);
  assert.equal(fakeProviderEnabled({ COLLECTOR_FAKE_PROVIDER: "1" }), false);
  for (const stage of ["production", "pilot", undefined]) {
    assert.equal(
      fakeProviderEnabled({ PT_GLORY_ENV: stage, COLLECTOR_FAKE_PROVIDER: "1" }),
      false, String(stage),
    );
  }
  assert.equal(
    fakeProviderEnabled({ PT_GLORY_ENV: "test", COLLECTOR_FAKE_PROVIDER: "1" }),
    true,
  );
  assert.throws(
    () => createFakeProvider({ PT_GLORY_ENV: "production", COLLECTOR_FAKE_PROVIDER: "1" }),
    /dev or test/,
  );
});

test("one provider selection point, shared by the request paths and the sweep", () => {
  const factory = source("lib", "collect", "provider-factory.ts");
  const scheduler = source("app", "api", "collections", "advance", "route.ts");
  assert.match(factory, /fakeProviderEnabled\(\)/);
  assert.match(factory, /createApifyProvider/);
  // The sweep no longer builds its own: it asks the same factory.
  assert.match(scheduler, /providerFromSettings\(\)/);
  assert.doesNotMatch(scheduler, /createApifyProvider/);
});
