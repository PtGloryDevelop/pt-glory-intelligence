import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIORITY_FIELDS, worstTier } from "../lib/domain/quality-tier.ts";

/**
 * The presentation rules that a dataset's trustworthiness depends on. These are
 * cheap to get wrong in a refactor and expensive to notice: a chip that says
 * "ปกติ" over an unmeasured dataset is a claim the database never made.
 */

test("an unmeasured dataset is unknown — never normal, never low", () => {
  assert.equal(worstTier([]), "unknown");
});

test("the worst measured tier wins", () => {
  assert.equal(worstTier([{ tier: "normal" }, { tier: "partial" }, { tier: "low" }]), "low");
  assert.equal(worstTier([{ tier: "normal" }, { tier: "partial" }]), "partial");
  assert.equal(worstTier([{ tier: "normal" }, { tier: "normal" }]), "normal");
});

test("a tier the database does not define is not treated as clean", () => {
  assert.equal(worstTier([{ tier: "normal" }, { tier: "not-a-tier" }]), "unknown");
});

test("copy, CTA, title, destination, platform and page data lead the reading order", () => {
  assert.deepEqual(PRIORITY_FIELDS.slice(0, 6), [
    "body_text", "caption", "cta_type", "cta_text", "title", "link_url",
  ]);
  for (const field of ["publisher_platform", "page_name", "page_categories"]) {
    assert.ok(PRIORITY_FIELDS.includes(field), `${field} must have a place in the order`);
  }
});

test("QualityBadge paints unknown neutral and never falls back to danger", () => {
  const source = readFileSync(join(process.cwd(), "components", "QualityBadge.tsx"), "utf8");
  assert.match(source, /unknown: "neutral"/);
  assert.match(source, /unknown: "ยังไม่วัด"/);
  assert.doesNotMatch(source, /\?\s*tier\s*:\s*"low"/, "an unknown tier must not fall back to low");
});

test("the partial banner uses the warning tokens, not danger", () => {
  const css = readFileSync(join(process.cwd(), "components", "PartialBanner.module.css"), "utf8");
  assert.match(css, /--warn-tint/);
  assert.doesNotMatch(css, /--danger/, "a partial run is readable data, not a failure");
});

test("the stepper claims no progress percentage", () => {
  const source = readFileSync(join(process.cwd(), "components", "ImportStepper.tsx"), "utf8");
  // A percentage would have to be computed or animated; neither has any real
  // input here, so neither may appear.
  assert.doesNotMatch(source, /aria-valuenow|progressbar|width:/i, "no fake progress bar");
  // Every real phase the import client can be in must map to a step.
  for (const phase of [
    "idle", "validating", "preview", "committing", "success", "partial", "rejected", "failed",
  ]) {
    assert.match(source, new RegExp(`${phase}:`), `phase ${phase} must map to a step`);
  }
});
