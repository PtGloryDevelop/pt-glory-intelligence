/**
 * Media durability measurement, for a FRESH collector export.
 *
 * Two things this reports that only a fresh export can give:
 *   1. real byte sizes per asset kind (the storage projection needs these)
 *   2. how the signed URLs behave while still inside their own TTL
 *
 * Read-only. Touches no database and no application code.
 *
 *   node scripts/measure-media.mjs <export.json> [sampleSize]
 *
 * Signed query strings are never printed: they are credentials with an expiry,
 * and a log line is a place they should not live.
 */
import { readFileSync } from "node:fs";

const [, , file, sampleArg] = process.argv;
if (!file) {
  console.error("usage: node scripts/measure-media.mjs <export.json> [sampleSize]");
  process.exit(1);
}
const SAMPLE = Number(sampleArg ?? 40);
const TIMEOUT_MS = 20_000;

const IMAGE_KEYS = ["resized_image_url", "original_image_url"];
const VIDEO_KEYS = ["video_hd_url", "video_sd_url"];
const POSTER_KEYS = ["video_preview_image_url"];

const exported = JSON.parse(readFileSync(file, "utf8"));
const generatedAt = Date.parse(exported.generated_at) / 1000;

/** Every media URL in the export, tagged by kind, with its own expiry claim. */
function collect() {
  const out = [];
  const push = (kind, key, url) => {
    if (typeof url !== "string" || !url) return;
    let parsed;
    try { parsed = new URL(url); } catch { return out.push({ kind, key, url, host: "(invalid)", expiry: null }); }
    const oe = parsed.searchParams.get("oe");
    out.push({ kind, key, url, host: parsed.host, expiry: oe ? parseInt(oe, 16) : null });
  };
  for (const ad of exported.ads ?? []) {
    for (const entry of ad.images ?? []) for (const key of IMAGE_KEYS) push("image", key, entry[key]);
    for (const entry of ad.videos ?? []) {
      for (const key of VIDEO_KEYS) push("video", key, entry[key]);
      for (const key of POSTER_KEYS) push("poster", key, entry[key]);
    }
    for (const entry of ad.cards ?? []) for (const key of VIDEO_KEYS) push("card", key, entry[key]);
  }
  return out;
}

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
const kb = (n) => n === null ? "-" : `${(n / 1024).toFixed(0)} KB`;

async function measure(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(item.url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => {});
      // 403/401 on a signed URL is the expiry, not a transport problem.
      return { ...item, verdict: response.status === 403 || response.status === 401 ? "expired/forbidden" : `http ${response.status}`, bytes: null };
    }
    const bytes = Buffer.from(await response.arrayBuffer()).length;
    return { ...item, verdict: "ok", bytes, type: response.headers.get("content-type") };
  } catch (error) {
    return { ...item, verdict: `network failure (${error?.cause?.code ?? error?.name ?? "unknown"})`, bytes: null };
  } finally {
    clearTimeout(timer);
  }
}

const all = collect();
const now = Date.now() / 1000;
const withExpiry = all.filter((item) => item.expiry !== null);

console.log(`export        ${exported.generated_at}  (${(exported.ads ?? []).length} ads)`);
console.log(`media URLs    ${all.length}  ·  carrying an expiry claim: ${withExpiry.length}`);

if (withExpiry.length) {
  const ttls = withExpiry.map((item) => (item.expiry - generatedAt) / 3600).sort((a, b) => a - b);
  const expired = withExpiry.filter((item) => item.expiry < now).length;
  console.log(`TTL hours     p10 ${percentile(ttls, 0.1).toFixed(1)}  median ${percentile(ttls, 0.5).toFixed(1)}  p90 ${percentile(ttls, 0.9).toFixed(1)}`);
  console.log(`already dead  ${expired}/${withExpiry.length} (${(100 * expired / withExpiry.length).toFixed(1)}%)`);
}

const hosts = new Map();
for (const item of all) hosts.set(item.host, (hosts.get(item.host) ?? 0) + 1);
console.log("hosts        ", [...hosts].map(([h, n]) => `${h} (${n})`).join(", "));

// One sample per kind, so the size table is not dominated by whichever kind is
// most numerous in this particular export.
const byKind = new Map();
for (const item of all) {
  const list = byKind.get(item.kind) ?? [];
  if (list.length < SAMPLE) list.push(item);
  byKind.set(item.kind, list);
}

console.log(`\nfetching up to ${SAMPLE} per kind…\n`);
for (const [kind, items] of byKind) {
  const results = [];
  for (const item of items) results.push(await measure(item));
  const ok = results.filter((r) => r.verdict === "ok");
  const sizes = ok.map((r) => r.bytes).sort((a, b) => a - b);
  const verdicts = new Map();
  for (const r of results) verdicts.set(r.verdict, (verdicts.get(r.verdict) ?? 0) + 1);

  console.log(
    `${kind.padEnd(7)} fetched ${String(ok.length).padStart(3)}/${String(results.length).padEnd(3)}` +
    ` median ${kb(percentile(sizes, 0.5)).padStart(8)}  p90 ${kb(percentile(sizes, 0.9)).padStart(8)}` +
    `  total ${kb(sizes.reduce((a, b) => a + b, 0)).padStart(9)}`,
  );
  for (const [verdict, count] of verdicts) if (verdict !== "ok") console.log(`        ${count} × ${verdict}`);
}
