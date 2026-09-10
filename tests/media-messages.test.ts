import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_STATE_MESSAGE } from "../lib/media/resolve.ts";

/**
 * What a card says when it cannot show a picture.
 *
 * Three states that are three different facts, and the wording used to imply
 * the wrong one: "ไม่สามารถแสดงตัวอย่างสื่อ" says we failed. We did not — the
 * ads in question are CAROUSEL, DPA and DCO whose cards carry video links and
 * no still, measured at 3–4% of a real collection. There was never an image to
 * keep, and that is a fact about the ad.
 */

test("each state says a different thing", () => {
  const messages = Object.values(MEDIA_STATE_MESSAGE);
  assert.equal(new Set(messages).size, messages.length, "no two states share wording");
});

test("unusable describes the ad, not a failure of ours", () => {
  assert.match(MEDIA_STATE_MESSAGE.unusable, /ไม่มีภาพนิ่งให้เก็บ/);
  // The old wording blamed the system for the source's shape.
  assert.ok(!/ไม่สามารถ/.test(MEDIA_STATE_MESSAGE.unusable));
});

test("nothing captured and nothing displayable stay apart", () => {
  assert.match(MEDIA_STATE_MESSAGE.none, /ไม่มีสื่อที่บันทึกไว้/);
  assert.notEqual(MEDIA_STATE_MESSAGE.none, MEDIA_STATE_MESSAGE.unusable);
});

test("only a source URL is described as expiring", () => {
  // An archived object cannot go stale; saying so would be a false claim about
  // our own storage.
  assert.match(MEDIA_STATE_MESSAGE.expired, /ต้นทางหมดอายุ/);
});

test("one copy, read by every surface", () => {
  for (const file of ["AdCard.tsx", "AdThumb.tsx", "AdDrawer.tsx"]) {
    const source = readFileSync(join("components", file), "utf8");
    assert.match(source, /MEDIA_STATE_MESSAGE/, file);
    // Three surfaces with their own copies is how three surfaces come to
    // describe the same row differently.
    assert.ok(!/ไม่สามารถแสดงตัวอย่างสื่อ/.test(source), `${file} still holds its own copy`);
  }
});
