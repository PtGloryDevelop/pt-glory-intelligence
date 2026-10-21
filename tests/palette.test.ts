import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Contrast guard for the CI pink palette (2026-10-05, replacing Amendment A1's orange).
 *
 * The colour rules only hold because of specific measured pairings — white on the
 * primary pink, the deeper pink for text, cards a visible step above the canvas.
 * Those are easy to undo by nudging one hex, and nothing else in the suite would
 * notice. This reads the real tokens out of globals.css and re-measures them.
 */

const css = readFileSync("app/globals.css", "utf8");

/** Every CSS module, for rules about how a token may be used. */
function modules(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (path.endsWith(".module.css")) found.push({ path, text: readFileSync(path, "utf8") });
    }
  };
  for (const dir of ["app", "components"]) walk(dir);
  return found;
}

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
  for (const surface of ["paper", "surface", "surface-pink", "surface-sunken", "brand-tint"]) {
    assert.ok(ratio(ink, token(surface)) >= 7, `--ink on --${surface} should be AAA`);
  }
  assert.ok(ratio(token("ink-soft"), token("surface")) >= 7, "--ink-soft is body copy, not a hint");
  for (const surface of ["paper", "surface", "surface-sunken", "neutral-tint", "brand-tint"]) {
    const measured = ratio(token("muted"), token(surface));
    assert.ok(measured >= AA, `--muted on --${surface} is ${measured.toFixed(2)}, below AA`);
  }
});

test("cards lift off the canvas, and their edges show", () => {
  // The fix for "the app looks empty": at 1.06:1 every card dissolved into one
  // white field. Nudging --paper back towards white undoes it silently.
  const lift = ratio(token("surface"), token("paper"));
  assert.ok(lift >= 1.1, `--surface on --paper is ${lift.toFixed(2)}, cards will not read as cards`);
  assert.ok(ratio(token("line"), token("surface")) >= 1.25, "--line must be a visible card edge");
  assert.ok(ratio(token("line-strong"), token("surface")) > ratio(token("line"), token("surface")), "--line-strong is the stronger edge");
  // A real lift has an offset and a blur, not a hairline at 4%.
  assert.match(css, /--shadow:\s*0 1px 2px [^;]*, 0 \d+px \d+px/, "--shadow is a close edge plus a soft offset shadow");
});

test("pink as text uses --brand-ink; the CI pink itself is for graphics", () => {
  for (const surface of ["paper", "surface", "brand-tint"]) {
    const measured = ratio(token("brand-ink"), token(surface));
    assert.ok(measured >= AA, `--brand-ink on --${surface} is ${measured.toFixed(2)}, below AA`);
  }
  const ci = ratio(token("brand-ci"), token("surface"));
  assert.ok(ci < AA, "assumption behind this rule: CI pink as body text would fail");
  assert.ok(ci >= 3, "but it clears the 3:1 that charts, icons and the logo need");
});

test("the primary action carries white, and selected pink states stay readable", () => {
  assert.ok(ratio("#ffffff", token("accent-blue")) >= AA, "white label on the primary pink button");
  for (const surface of ["surface", "brand-tint", "brand-tint-strong"]) {
    const measured = ratio(token("accent-blue-ink"), token(surface));
    assert.ok(measured >= AA, `--accent-blue-ink on --${surface} is ${measured.toFixed(2)}, below AA`);
  }
});

test("--brand is a fill for charcoal, never for white", () => {
  // Selected-state edge, progress fill, chart highlight.
  assert.ok(ratio(token("ink"), token("brand")) >= AA, "charcoal label on --brand");
  assert.ok(ratio("#ffffff", token("brand")) < AA, "assumption behind this rule: white on --brand fails");
});

test("--brand-deep is only an edge colour", () => {
  assert.ok(ratio(token("brand-deep"), token("paper")) < AA, "assumption behind this rule: unreadable as text");
  for (const { path, text } of [{ path: "app/globals.css", text: css }, ...modules()]) {
    assert.doesNotMatch(text, /background:\s*var\(--brand-deep\)/, `${path}: --brand-deep used as a fill`);
    // Lookbehind so `border-color` — its one legitimate use — does not match.
    assert.doesNotMatch(text, /(?<![-\w])color:\s*var\(--brand-deep\)/, `${path}: --brand-deep used as text`);
  }
});

test("semantic text colours clear AA on the canvas and on cards", () => {
  for (const surface of ["paper", "surface"]) {
    for (const name of ["ok-ink", "warn-ink", "danger", "focus"]) {
      const measured = ratio(token(name), token(surface));
      assert.ok(measured >= AA, `--${name} on --${surface} is ${measured.toFixed(2)}, below AA`);
    }
  }
});

test("semantic tokens are not re-pointed at the brand", () => {
  // Branding never overrides a status colour.
  const brand = ["brand", "brand-ci", "brand-ink"].map((name) => token(name).toLowerCase());
  for (const name of ["ok-ink", "warn-ink", "danger"]) {
    assert.ok(!brand.includes(token(name).toLowerCase()), `--${name} must stay semantic`);
  }
});

test("an alert region keeps its text readable without a thick edge", () => {
  // Opaque on purpose: a translucent tint over --paper drops --muted to 4.38:1.
  for (const name of ["danger", "muted", "ink"]) {
    const measured = ratio(token(name), token("danger-surface"));
    assert.ok(measured >= AA, `--${name} on --danger-surface is ${measured.toFixed(2)}, below AA`);
  }
  assert.ok(ratio(token("danger-line"), token("danger-surface")) >= 1.2, "--danger-line must show around the region");
});

test("the two sides of a comparison chart stay apart", () => {
  // Chosen with the dataviz validator (colour-blind separation ΔE 13.0). These measure what survives a
  // nudge: each bar reads on a card, each side's pill takes a white label, and neither side is --brand,
  // whose 2026-10 change had merged the two sides into two pinks.
  for (const side of ["series-a", "series-b"]) {
    assert.ok(ratio(token(side), token("surface")) >= 3, `--${side} bars need 3:1 on a card`);
    assert.ok(ratio("#ffffff", token(side)) >= AA, `a white label on the --${side} pill`);
    assert.notEqual(token(side).toLowerCase(), token("brand").toLowerCase(), `--${side} must not follow --brand`);
  }
  assert.notEqual(token("series-a").toLowerCase(), token("series-b").toLowerCase());
  const charts = ["components/CompareChart.module.css", "components/ActivityChart.module.css", "components/TimelineChart.module.css"]
    .map((path) => [path, readFileSync(path, "utf8")] as const);
  for (const [path, text] of charts) {
    assert.doesNotMatch(text, /\.(a|b|barA|barB|firstSeen|started|firstSeenBar|startedBar)\s*\{[^}]*var\(--(brand|accent-blue)\)/, `${path}: a series painted with a UI colour`);
  }
});

test("--line-pink is a visible edge on the pink surfaces", () => {
  // A border need not clear AA, but it must be distinguishable from what it
  // separates — --line fades on pink, which is why this token exists at all.
  for (const surface of ["surface-pink", "brand-tint"]) {
    const onPink = ratio(token("line-pink"), token(surface));
    assert.ok(onPink >= 1.15, `--line-pink on --${surface} is ${onPink.toFixed(2)}, invisible`);
    assert.ok(ratio(token("line"), token(surface)) < onPink, `--line is the weaker edge on --${surface}`);
  }
});

test("every colour the interface uses comes from a token", () => {
  // The V5 sweep found #e6cdd7 and #0b5f8c living in two modules each. A hex in
  // a module is a colour nothing in this file can measure.
  const offenders: string[] = [];
  for (const { path, text } of modules()) {
    for (const [line] of text.matchAll(/^.*#[0-9a-fA-F]{3,8}\b.*$/gm)) {
      // #000 and #fff are the letterbox and the label on top of a photograph:
      // neither sits on a themed surface, so neither belongs to the palette.
      if (/#000\b|#fff\b|#ffffff\b|#000000\b/.test(line)) continue;
      offenders.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `hard-coded colours found:\n${offenders.join("\n")}`);
});
