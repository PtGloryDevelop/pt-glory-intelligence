import assert from "node:assert/strict";
import test from "node:test";
import { loadOwnedMedia, type OwnedMediaItem } from "../app/(app)/owned-ads/load-media.ts";

/**
 * Card pictures for our ads come from Meta through /api/owned-ads/media, four ads a request.
 * One request after another left 24 cards waiting about four seconds; three in flight cut that
 * without asking Meta for anything more.
 */

const ads = (n: number) => Array.from({ length: n }, (_, i) => ({ account_id: "act_1", ad_id: String(100 + i) }));

function fakeFetch(fail: (ids: string[]) => boolean = () => false) {
  const state = { inFlight: 0, peak: 0, sent: [] as string[][] };
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { items } = JSON.parse(String(init.body)) as { items: { account_id: string; ad_id: string }[] };
    const ids = items.map(item => item.ad_id);
    state.sent.push(ids);
    state.inFlight++; state.peak = Math.max(state.peak, state.inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    state.inFlight--;
    if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (fail(ids)) return new Response("{}", { status: 503 });
    return Response.json({ items: items.map(item => ({ ...item, url: `https://cdn.test/${item.ad_id}.jpg` })) });
  }) as typeof fetch;
  return { state, restore: () => { globalThis.fetch = original; } };
}

test("asks four ads a request, three requests at a time, top cards first", async () => {
  const { state, restore } = fakeFetch();
  try {
    const got: OwnedMediaItem[] = [];
    await loadOwnedMedia(ads(24), new AbortController().signal, (_items, found) => got.push(...(found ?? [])));
    assert.equal(state.sent.length, 6);
    assert.ok(state.sent.every(ids => ids.length === 4));
    assert.equal(state.peak, 3);
    assert.deepEqual(state.sent.slice(0, 3).flat(), ads(12).map(ad => ad.ad_id));
    assert.equal(got.length, 24);
  } finally { restore(); }
});

test("a failed request reports its own ads and the rest still load", async () => {
  const { restore } = fakeFetch(ids => ids.includes("104"));
  try {
    const failed: string[] = [], loaded: string[] = [];
    await loadOwnedMedia(ads(12), new AbortController().signal, (items, found) => {
      if (found) loaded.push(...found.map(item => item.ad_id)); else failed.push(...items.map(item => item.ad_id));
    });
    assert.deepEqual(failed, ["104", "105", "106", "107"]);
    assert.equal(loaded.length, 8);
  } finally { restore(); }
});

test("leaving the page stops further requests and reports nothing", async () => {
  const { state, restore } = fakeFetch();
  try {
    const controller = new AbortController();
    let calls = 0;
    const done = loadOwnedMedia(ads(24), controller.signal, () => { calls++; });
    controller.abort();
    await done;
    assert.equal(calls, 0);
    assert.ok(state.sent.length <= 3);
  } finally { restore(); }
});
