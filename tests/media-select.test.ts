import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceExpiry, selectPreview } from "../lib/media/select.ts";

/**
 * The preview policy, including the semantic rule C1 exposed: a VIDEO ad whose
 * durable preview is a JPEG poster is still a VIDEO ad.
 */

const IMG = "https://scontent.xx.fbcdn.net/v/a.jpg";
const ORIG = "https://scontent.xx.fbcdn.net/v/original.jpg";
const POSTER = "https://scontent.xx.fbcdn.net/v/poster.jpg";
const VIDEO = "https://scontent.xx.fbcdn.net/v/clip.mp4";

test("IMAGE takes the resized rendition", () => {
  const result = selectPreview("IMAGE", {
    images: [{ resized_image_url: IMG, original_image_url: ORIG }],
  });
  assert.equal(result.outcome, "candidate");
  assert.equal(result.outcome === "candidate" && result.sourceField, "resized_image_url");
  assert.equal(result.outcome === "candidate" && result.kind, "image");
});

test("MULTI_IMAGES behaves as IMAGE", () => {
  const result = selectPreview("MULTI_IMAGES", { images: [{ resized_image_url: IMG }] });
  assert.equal(result.outcome === "candidate" && result.kind, "image");
});

test("VIDEO takes the poster and REMAINS a video", () => {
  const result = selectPreview("VIDEO", {
    videos: [{ video_hd_url: VIDEO, video_preview_image_url: POSTER }],
  });
  assert.equal(result.outcome, "candidate");
  assert.equal(result.outcome === "candidate" && result.url, POSTER);
  // The whole point: the archived file is a JPEG, the ad is not an image ad.
  assert.equal(result.outcome === "candidate" && result.kind, "video");
});

test("a VIDEO carrying only images still gets a preview, still reports video", () => {
  const result = selectPreview("VIDEO", { images: [{ resized_image_url: IMG }] });
  assert.equal(result.outcome === "candidate" && result.url, IMG);
  assert.equal(result.outcome === "candidate" && result.kind, "video");
});

test("CAROUSEL and DCO take the first usable card still, deterministically", () => {
  const media = {
    cards: [
      { title: "no image here" },
      { resized_image_url: IMG },
      { resized_image_url: "https://scontent.xx.fbcdn.net/v/second.jpg" },
    ],
  };
  for (const format of ["CAROUSEL", "DCO"]) {
    const result = selectPreview(format, media);
    assert.equal(result.outcome === "candidate" && result.url, IMG, `${format} picks the first`);
    assert.equal(result.outcome === "candidate" && result.kind, "carousel");
  }
});

test("no entries is none; entries with nothing usable is unusable", () => {
  assert.deepEqual(selectPreview("IMAGE", null), { outcome: "none" });
  assert.deepEqual(selectPreview("IMAGE", { images: [], videos: [], cards: [] }), { outcome: "none" });

  // The real text-only carousel shape, measured at 3.2% of a fresh export.
  const textOnly = selectPreview("CAROUSEL", {
    cards: [{ title: "คุ้มสุดจองเลย", video_hd_url: null, video_sd_url: null }],
  });
  assert.equal(textOnly.outcome, "unusable");
  assert.equal(textOnly.outcome === "unusable" && textOnly.entries, 1);
});

test("advertiser-controlled fields can never become a candidate", () => {
  // link_url is a destination the advertiser chose. If it could reach the
  // fetcher, an uploaded file would be an SSRF trigger.
  const result = selectPreview("IMAGE", {
    images: [{ link_url: "http://169.254.169.254/latest/meta-data/", link_description: IMG }],
  });
  assert.equal(result.outcome, "unusable");
});

test("hostile schemes are refused at selection, before any fetch", () => {
  const result = selectPreview("IMAGE", {
    images: [{ resized_image_url: "javascript:alert(1)" }, { resized_image_url: "data:text/html,x" }],
  });
  assert.equal(result.outcome, "unusable");
});

test("oe is parsed as hex unix seconds", () => {
  const expiry = parseSourceExpiry("https://x.fbcdn.net/a.jpg?oe=68C3B7C0");
  assert.ok(expiry instanceof Date);
  assert.equal(expiry!.getTime(), 0x68c3b7c0 * 1000);

  for (const url of [
    "https://x.fbcdn.net/a.jpg",
    "https://x.fbcdn.net/a.jpg?oe=",
    "https://x.fbcdn.net/a.jpg?oe=zzzz",
    "not a url",
  ]) {
    assert.equal(parseSourceExpiry(url), null, url);
  }
});
