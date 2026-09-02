import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Contrast guard for the Amendment A1 palette.
 *
 * The colour rules only hold because of specific measured pairings — charcoal on
 * every bright fill, never white on brand orange. Those are easy to undo by
 * nudging one hex, and nothing else in the suite would notice. This reads the
 * real tokens out of globals.css and re-measures them.
 */

const css = readFileSync("app/globals.css", "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token --${name} is missing from globals.css`);
  return match![1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const AA = 4.5;

test("body text clears AA on every surface", () => {
  const ink = token("ink");
  for (const surface of ["paper", "surface", "surface-pink"]) {
    assert.ok(ratio(ink, token(surface)) >= 7, `--ink on --${surface} should be AAA`);
  }
  assert.ok(ratio(token("muted"), token("paper")) >= AA, "--muted must stay readable on cream");
});

test("charcoal clears AA on every bright fill — this is what makes them fills", () => {
  const ink = token("ink");
  const fills = [
    "brand", "accent-coral", "accent-pink",
    "accent-blue", "accent-green", "accent-yellow", "accent-lavender",
  ];
  for (const fill of fills) {
    const measured = ratio(ink, token(fill));
    assert.ok(measured >= AA, `--ink on --${fill} is ${measured.toFixed(2)}, below AA`);
  }
});

test("--brand-deep is only an edge colour", () => {
  // 4.31 against --ink and 3.06 as text on cream, so it fails both ways. It is a
  // border colour and nothing else — as a fill it would drop a charcoal label
  // below AA, and as text it would be unreadable on cream.
  assert.ok(ratio(token("ink"), token("brand-deep")) < AA, "assumption behind this rule");
  assert.ok(ratio(token("brand-deep"), token("paper")) < AA, "assumption behind this rule");
  assert.doesNotMatch(css, /background:\s*var\(--brand-deep\)/, "--brand-deep used as a fill");
  // Lookbehind so `border-color` — its one legitimate use — does not match.
  assert.doesNotMatch(css, /(?<![-\w])color:\s*var\(--brand-deep\)/, "--brand-deep used as text");
});

test("white is never viable on brand orange", () => {
  // Recorded so a future change to use white-on-brand fails here first rather
  // than shipping a 3.15:1 primary button.
  assert.ok(ratio("#ffffff", token("brand")) < AA);
  assert.doesNotMatch(
    css,
    /button\[data-variant="primary"\][^}]*color:\s*(#fff|white)/i,
    "the primary CTA must use charcoal, not white",
  );
});

test("orange as text uses --brand-ink, and --brand would not have worked", () => {
  const paper = token("paper");
  assert.ok(ratio(token("brand-ink"), paper) >= AA, "--brand-ink must be readable on cream");
  assert.ok(ratio(token("brand"), paper) < 3, "--brand as text is the mistake this token prevents");
});

test("semantic text colours clear AA on cream", () => {
  const paper = token("paper");
  for (const name of ["ok-ink", "warn-ink", "danger", "focus"]) {
    const measured = ratio(token(name), paper);
    assert.ok(measured >= AA, `--${name} on cream is ${measured.toFixed(2)}, below AA`);
  }
});

test("semantic tokens are not re-pointed at the brand", () => {
  // Rule 6 of the amendment: branding never overrides a status colour.
  const brand = token("brand").toLowerCase();
  for (const name of ["ok-ink", "warn-ink", "danger", "focus"]) {
    assert.notEqual(token(name).toLowerCase(), brand, `--${name} must stay semantic`);
  }
});
