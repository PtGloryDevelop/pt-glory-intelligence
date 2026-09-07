import assert from "node:assert/strict";
import test from "node:test";
import { isHttpUrl, mediaPresentation, presentableMedia } from "../lib/media.ts";
import { normalize } from "../lib/collector/normalize.ts";
import { validate } from "../lib/collector/validate.ts";
import { goldenExport } from "./fixtures/load.ts";

/**
 * The adapter is tested against the REAL collector key names, because the defect
 * it replaces was exactly a set of key names nobody had checked against the
 * export: `url` / `previewUrl` / `thumbnailUrl` do not exist in it, so every ad
 * in the product reported "no media saved" about media that was saved.
 *
 * Anything here that stops asserting on `resized_image_url`, `video_hd_url` and
 * friends has stopped testing the thing that broke.
 */

const IMAGE = "https://cdn.example.test/a.jpg";
const ORIGINAL = "https://cdn.example.test/original.jpg";
const VIDEO_HD = "https://cdn.example.test/hd.mp4";
const VIDEO_SD = "https://cdn.example.test/sd.mp4";
const POSTER = "https://cdn.example.test/poster.jpg";

test("images resolve from the collector's own key names", () => {
  const result = mediaPresentation({
    images: [{ resized_image_url: IMAGE, original_image_url: ORIGINAL, image_crops: [] }],
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.state === "ready" && result.primary, { kind: "image", src: IMAGE });
});

test("the resized rendition wins over the original for preview", () => {
  const [first] = presentableMedia({
    images: [{ original_image_url: ORIGINAL, resized_image_url: IMAGE }],
  });
  assert.deepEqual(first, { kind: "image", src: IMAGE }, "priority must be deterministic");

  // ...and the original is still used when no rendition was stored.
  const [only] = presentableMedia({ images: [{ original_image_url: ORIGINAL }] });
  assert.deepEqual(only, { kind: "image", src: ORIGINAL });
});

test("videos resolve with a poster, preferring the higher fidelity source", () => {
  const [video] = presentableMedia({
    videos: [{ video_hd_url: VIDEO_HD, video_sd_url: VIDEO_SD, video_preview_image_url: POSTER }],
  });
  assert.deepEqual(video, { kind: "video", src: VIDEO_HD, poster: POSTER });

  const [sdOnly] = presentableMedia({ videos: [{ video_sd_url: VIDEO_SD }] });
  assert.deepEqual(sdOnly, { kind: "video", src: VIDEO_SD, poster: null });
});

test("a video with only a preview frame is still a creative", () => {
  const [item] = presentableMedia({ videos: [{ video_preview_image_url: POSTER }] });
  assert.deepEqual(item, { kind: "image", src: POSTER });
});

test("carousel cards resolve through their own video fields", () => {
  const [item] = presentableMedia({
    cards: [{ video_hd_url: VIDEO_HD, title: "x", body: "y", cta_type: "LEARN_MORE" }],
  });
  assert.deepEqual(item, { kind: "video", src: VIDEO_HD, poster: null });
});

test("images come first so a card preview prefers a still", () => {
  const all = presentableMedia({
    videos: [{ video_hd_url: VIDEO_HD }],
    images: [{ resized_image_url: IMAGE }],
  });
  assert.equal(all[0].kind, "image");
});

test("no media in the snapshot is its own state", () => {
  assert.deepEqual(mediaPresentation(null), { state: "none" });
  assert.deepEqual(mediaPresentation({}), { state: "none" });
  assert.deepEqual(mediaPresentation({ images: [], videos: [], cards: [] }), { state: "none" });
});

test("media present but unusable is NOT reported as missing", () => {
  // This is the distinction the old code could not make, and the reason it told
  // the user something the stored rows contradict.
  const result = mediaPresentation({ images: [{ image_crops: [] }, { resized_image_url: "" }] });
  assert.equal(result.state, "unusable");
  assert.equal(result.state === "unusable" && result.entries, 2);
});

test("hostile URLs are rejected, and rejecting them is not 'no media'", () => {
  const hostile = {
    images: [
      { resized_image_url: "javascript:window.__pwned=1" },
      { resized_image_url: "data:text/html,<script>1</script>" },
      { original_image_url: "vbscript:msgbox(1)" },
      { resized_image_url: "file:///etc/passwd" },
      { resized_image_url: "  javascript:alert(1)" },
    ],
    videos: [{ video_hd_url: "javascript:1", video_preview_image_url: "data:image/png;base64,AAA" }],
  };
  assert.deepEqual(presentableMedia(hostile), [], "no hostile scheme may reach an src");

  const result = mediaPresentation(hostile);
  assert.equal(result.state, "unusable", "six entries exist; none is safe");
  assert.equal(result.state === "unusable" && result.entries, 6);
});

test("isHttpUrl accepts only http and https", () => {
  for (const good of ["http://a.test/x.jpg", "https://a.test/x.jpg"]) {
    assert.equal(isHttpUrl(good), true, good);
  }
  for (const bad of [
    "javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///x",
    "//a.test/x.jpg", "", "not a url", null, undefined, 42, {},
  ]) {
    assert.equal(isHttpUrl(bad), false, String(bad));
  }
});

test("malformed entries never throw", () => {
  const junk = { images: [null, "string", 42, [], undefined], videos: [null], cards: [0] };
  assert.deepEqual(presentableMedia(junk as never), []);
  assert.equal(mediaPresentation(junk as never).state, "unusable");
});

test("the golden 500-ad export resolves to real creatives", () => {
  // The regression in one assertion: with the old key names this was 0 of 500.
  const result = validate(goldenExport());
  assert.ok(result.ok, "the golden fixture must still validate");
  const canonical = normalize(result.file);

  const counts = { none: 0, unusable: 0, ready: 0, image: 0, video: 0 };
  for (const observation of canonical.adObservations) {
    const presentation = mediaPresentation(observation.media as never);
    counts[presentation.state] += 1;
    if (presentation.state === "ready") counts[presentation.primary.kind] += 1;
  }

  assert.equal(canonical.adObservations.length, 500);
  assert.equal(counts.none, 0, "no observation in this export is actually medialess");
  assert.equal(counts.ready, 490, "resolved creatives");
  assert.ok(counts.image > 0 && counts.video > 0, "the fixture covers both kinds");

  // The remaining ten are text-only carousel cards whose video_hd_url and
  // video_sd_url are both null in the source. "Media exists, none of it is
  // displayable" is the honest reading — pinned so a future change cannot
  // quietly relabel them as having no media at all.
  assert.equal(counts.unusable, 10);
});
