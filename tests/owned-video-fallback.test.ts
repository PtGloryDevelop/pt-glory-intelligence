import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("a usable thumbnail preserves explicit video lookup when stored video identity is missing", async () => {
  const source = readFileSync("scripts/resolve-owned-media.mjs", "utf8");
  // Execute the actual worker resolver with an in-memory source and Graph stub.
  const resolver = source.slice(source.indexOf("  const safe=url=>"), source.indexOf("  // Only the visible page"));
  const item = { account_id: "act_123", ad_id: "456" };
  for (const [includeVideo, storedId, discoveredId] of [
    [true, null, "789"], [true, "789", null], [false, null, "789"], [true, null, null],
  ] as const) {
    const calls: [string, string][] = [];
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { creative_id: "654", creative_video_id: storedId }, error: null }),
    };
    const results = await runInNewContext(`(async()=>{${resolver}\nawait read(item);return results;})()`, {
      URL, item, includeVideo, stage: "test", accounts: { data: [{ id: "local", meta_account_id: item.account_id }] },
      db: { from: () => query },
      graph: async (id: string, fields: string) => {
        calls.push([id, fields]);
        if (fields === "thumbnail_url") return { thumbnail_url: "https://example.test/poster.jpg" };
        if (fields === "video_id") return discoveredId ? { video_id: discoveredId } : null;
        if (fields === "source") return { source: "https://example.test/video.mp4" };
        assert.fail("Unexpected provider lookup");
      },
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://example.test/poster.jpg");
    assert.equal(results[0].video_url, includeVideo ? storedId || discoveredId ? "https://example.test/video.mp4" : null : undefined);
    assert.equal(calls.filter(([, fields]) => fields === "video_id").length, includeVideo && !storedId ? 1 : 0);
    assert.equal(calls.filter(([, fields]) => fields === "source").length, includeVideo && (storedId || discoveredId) ? 1 : 0);
  }
});

test("denied video source uses only the selected ad's official Meta preview", async () => {
  const source = readFileSync("scripts/resolve-owned-media.mjs", "utf8");
  const resolver = source.slice(source.indexOf("  const safe=url=>"), source.indexOf("  // Only the visible page"));
  const item = { account_id: "act_123", ad_id: "456" };
  for (const previewUrl of [
    "https://business.facebook.com/ads/api/preview_iframe.php?encrypted=abc&amp;ad=456",
    "https://evil.test/ads/api/preview_iframe.php",
    "https://business.facebook.com.evil.test/ads/api/preview_iframe.php",
    "http://business.facebook.com/ads/api/preview_iframe.php",
    "https://business.facebook.com/ads/api/preview_iframe.php?access_token=secret",
    "https://business.facebook.com:444/ads/api/preview_iframe.php",
    "https://business.facebook.com/login",
  ]) {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { creative_id: "654", creative_video_id: "789" }, error: null }) };
    const calls: [string, string, string][] = [];
    const results = await runInNewContext(`(async()=>{${resolver}\nawait read(item);return results;})()`, {
      URL, item, includeVideo: true, stage: "test", accounts: { data: [{ id: "local", meta_account_id: item.account_id }] }, db: { from: () => query },
      graph: async (id: string, fields: string, params: Record<string, string>, edge = "") => {
        calls.push([id, fields, edge]);
        if (fields === "thumbnail_url") return { thumbnail_url: "https://example.test/poster.jpg" };
        if (fields === "source") return null;
        assert.equal(id, item.ad_id);
        assert.equal(edge, "previews");
        assert.equal(params.ad_format, "MOBILE_FEED_STANDARD");
        return { data: [{ body: `<iframe src="${previewUrl}"></iframe><script>doNotRender()</script>` }] };
      },
    });
    assert.equal(results[0].video_url, null);
    assert.equal(results[0].url, "https://example.test/poster.jpg");
    assert.equal(results[0].video_preview_url, previewUrl.includes("encrypted=abc") ? previewUrl.replaceAll("&amp;", "&") : null);
    assert.deepEqual(calls.at(-1), [item.ad_id, "body", "previews"]);
  }
});
