import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NEUTRAL_SOURCE_PRODUCT, UNKNOWN_METHOD_LABEL, collectionMethodLabel,
  labelProvenance, labelProvenanceRows, labelScope,
} from "../lib/collect/labels.ts";
import { COLLECTION_METHODS } from "../lib/domain/types.ts";

/**
 * C03 — ordinary product surfaces never name the collector, for any role.
 *
 * The rule is enforced on the server, so these tests read the label functions
 * and then check that every surface which serializes provenance actually runs
 * them. A UI that merely omits the value would still ship it in the payload.
 * Raw provenance belongs to the admin diagnostic surfaces the Phase 15 design
 * defines, which read the columns directly and do not come through here.
 */

const RAW_METHODS = [...COLLECTION_METHODS, "apify_actor_run"];
const source = (path: string) => readFileSync(path, "utf8");

test("every known collection method has neutral wording", () => {
  assert.equal(collectionMethodLabel("apify_actor_run"), "เก็บข้อมูลอัตโนมัติ");
  assert.equal(collectionMethodLabel("socialapis_api"), "เก็บข้อมูลอัตโนมัติ");
  assert.equal(collectionMethodLabel("network_response_observation"), "นำเข้าจากไฟล์");
  assert.equal(collectionMethodLabel("user_initiated_dom_observation"), "นำเข้าจากไฟล์");
  for (const method of RAW_METHODS) {
    assert.notEqual(collectionMethodLabel(method), method, `${method} must not be its own label`);
  }
});

test("an unfamiliar or missing method says so instead of leaking a name", () => {
  for (const value of ["screenshot_ocr", "", null, undefined]) {
    assert.equal(collectionMethodLabel(value), UNKNOWN_METHOD_LABEL, String(value));
  }
});

test("the labelling helper takes no role, so no role can be exempted", () => {
  assert.equal(labelProvenance.length, 1, "labelProvenance must take only the row");
  assert.equal(labelProvenanceRows.length, 1, "labelProvenanceRows must take only the rows");
  assert.equal(labelScope.length, 1, "labelScope must take only the scope");
  const helper = source("lib/collect/labels.ts");
  // The helper does not even import the role model: there is no role to exempt.
  assert.doesNotMatch(helper, /auth\/role-model|satisfies\(/, "no role exemption belongs in this helper");
});

test("rows carry no collector name and no collector product", () => {
  for (const method of RAW_METHODS) {
    const row = labelProvenance(
      { collection_method: method, source_product: "PT Glory Meta Ad Library Extension", other: "kept" },
    );
    assert.equal(row.source_product, NEUTRAL_SOURCE_PRODUCT, method);
    assert.equal(row.other, "kept", "unrelated fields are untouched");
    assert.doesNotMatch(JSON.stringify(row), /apify|actor|extension|observation|socialapis/i, method);
  }
});

test("the import preview scope follows the same rule", () => {
  const scope = { collectionMethod: "network_response_observation", sourceProduct: "PT Glory Meta Ad Library Extension", query: "x" };
  const labelled = labelScope(scope);
  assert.equal(labelled.collectionMethod, "นำเข้าจากไฟล์");
  assert.equal(labelled.sourceProduct, NEUTRAL_SOURCE_PRODUCT);
  assert.equal(labelled.query, "x");
});

test("historical Extension rows read provider-neutral, never naming the Extension", () => {
  const [extension, automated] = labelProvenanceRows([
    { collection_method: "network_response_observation", source_product: "PT Glory Meta Ad Library Extension" },
    { collection_method: "apify_actor_run", source_product: "PT Glory Collector" },
  ]);
  // The two describe different kinds of collection — imported file against
  // automated run — and neither names the collector or the provider behind it.
  assert.equal(extension.collection_method, "นำเข้าจากไฟล์");
  assert.equal(automated.collection_method, "เก็บข้อมูลอัตโนมัติ");
  assert.equal(extension.source_product, NEUTRAL_SOURCE_PRODUCT);
  assert.equal(automated.source_product, NEUTRAL_SOURCE_PRODUCT);
});

test("every surface that serializes provenance labels it first", () => {
  const surfaces = [
    "app/(app)/datasets/page.tsx",
    "app/(app)/datasets/[id]/page.tsx",
    "app/api/ads/[adArchiveId]/route.ts",
    "app/api/imports/preview/route.ts",
  ];
  for (const path of surfaces) {
    const text = source(path);
    assert.match(text, /from "@\/lib\/collect\/labels"/, `${path} must label provenance on the server`);
    assert.match(text, /label(Provenance|ProvenanceRows|Scope)\(/, `${path} must call a label function`);
  }
});

test("no product surface names a collector or a provider in its own copy", () => {
  const surfaces = [
    "app/(app)/page.tsx", "app/(app)/datasets/page.tsx", "app/(app)/datasets/[id]/page.tsx",
    "app/(app)/pages/page.tsx", "app/(app)/import/page.tsx", "app/(app)/import/import-client.tsx",
    "components/AdDrawer.tsx",
  ];
  for (const path of surfaces) {
    assert.doesNotMatch(source(path), /Extension|Apify|Actor ?ID|actor_id|provider_run_id|datasetId from/i, path);
  }
});

test("no client component reads a provider token", () => {
  for (const path of ["app/(app)/import/import-client.tsx", "components/AdDrawer.tsx"]) {
    assert.doesNotMatch(source(path), /APIFY_TOKEN|MEDIA_ARCHIVE_TOKEN|SERVICE_ROLE/i, path);
  }
});

test("surfaces that fetch run provenance without labelling it must not render it", () => {
  // getPageRunHistory and getTrendContext both carry collection_method. Neither
  // screen shows it today, and neither hands the rows to a client component, so
  // nothing is serialized. If that changes, the value has to be labelled first.
  for (const path of ["app/(app)/pages/[pageId]/timeline.tsx", "app/(app)/trends/page.tsx"]) {
    assert.doesNotMatch(source(path), /collection_method/, `${path} renders raw provenance`);
  }
});
