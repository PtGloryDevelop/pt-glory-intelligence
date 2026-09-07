/**
 * Media durability measurement, for a collector export.
 *
 * Answers the two things only a live export can: how large the assets actually
 * are, and how the signed URLs behave while still inside their own TTL.
 *
 * Read-only. Touches no database and no application code.
 *
 *   node scripts/measure-media.mjs <export.json> [sampleSizePerField]
 *
 * Signed query strings are never printed: they are credentials with an expiry,
 * and a log line is not where they belong. Only host, status, size, timing and
 * content sniffing are reported.
 *
 * Concurrency is deliberately low. This is a measurement, not a load test, and
 * the far end belongs to somebody else.
 */
import { readFileSync } from "node:fs";

const [, , file, sampleArg] = process.argv;
if (!file) {
  console.error("usage: node scripts/measure-media.mjs <export.json> [sampleSizePerField]");
  process.exit(1);
}
const SAMPLE = Number(sampleArg ?? 40);
const CONCURRENCY = 2;
const TIMEOUT_MS = 20_000;

/** The five asset categories the storage decision actually turns on. */
const FIELDS = [
  { field: "images", key: "resized_image_url", label: "resized image" },
  { field: "images", key: "original_image_url", label: "original image" },
  { field: "videos", key: "video_preview_image_url", label: "video poster" },
  { field: "videos", key: "video_sd_url", label: "SD video" },
  { field: "videos", key: "video_hd_url", label: "HD video" },
  { field: "cards", key: "video_hd_url", label: "carousel video" },
];

const exported = JSON.parse(readFileSync(file, "utf8"));
const generatedAt = Date.parse(exported.generated_at) / 1000;
const now = Date.now() / 1000;

function collect() {
  const out = new Map(FIELDS.map((f) => [f.label, []]));
  for (const ad of exported.ads ?? []) {
    for (const { field, key, label } of FIELDS) {
      for (const entry of ad[field] ?? []) {
        const url = entry?.[key];
        if (typeof url !== "string" || !url) continue;
        let parsed;
        try { parsed = new URL(url); } catch { continue; }
        const oe = parsed.searchParams.get("oe");
        out.get(label).push({ url, host: parsed.host, expiry: oe ? parseInt(oe, 16) : null });
      }
    }
  }
  return out;
}

/** Content sniffing, because a Content-Type header is a claim, not a fact. */
function sniff(buffer) {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (b.length >= 6 && b.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "gif";
  if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp") return `mp4(${b.subarray(8, 12).toString("ascii").trim()})`;
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "\x1aE\xdf\xa3") return "matroska";
  return `unknown(${b.subarray(0, 4).toString("hex")})`;
}

async function measure(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(item.url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => {});
      // 403/401 on a signed URL is the expiry, not a transport problem.
      const verdict = response.status === 403 || response.status === 401
        ? "expired/forbidden" : `http ${response.status}`;
      return { verdict, host: item.host };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      verdict: "ok",
      host: item.host,
      bytes: buffer.length,
      ms: performance.now() - started,
      type: (response.headers.get("content-type") ?? "").split(";")[0],
      sniffed: sniff(buffer),
    };
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? "unknown";
    return { verdict: `network failure (${code})`, host: item.host };
  } finally {
    clearTimeout(timer);
  }
}

/** Fixed small worker pool, so the far end sees a trickle rather than a burst. */
async function runPool(items) {
  const results = [];
  let index = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (index < items.length) results.push(await measure(items[index++]));
  }));
  return results;
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
const kb = (n) => n === null || n === undefined ? "-" : n >= 1024 * 1024 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`;

const collected = collect();
const everything = [...collected.values()].flat();
const expiries = everything.map((i) => i.expiry).filter((t) => t !== null).sort((a, b) => a - b);

console.log(`export        ${exported.generated_at}  ·  ${(exported.ads ?? []).length} ads`);
console.log(`measured      ${new Date().toISOString().slice(0, 16)}  (+${((now - generatedAt) / 3600).toFixed(1)}h)`);
console.log(`media URLs    ${everything.length}`);
if (expiries.length) {
  const dead = expiries.filter((t) => t < now).length;
  console.log(`TTL remaining min ${((expiries[0] - now) / 3600).toFixed(1)}h  median ${((pct(expiries, 0.5) - now) / 3600).toFixed(1)}h`);
  console.log(`already expired ${dead}/${expiries.length} (${(100 * dead / expiries.length).toFixed(1)}%)`);
}
const hosts = new Map();
for (const item of everything) hosts.set(item.host, (hosts.get(item.host) ?? 0) + 1);
console.log(`hosts         ${[...hosts].map(([h, n]) => `${h} (${n})`).join(", ")}`);

console.log(`\nsampling up to ${SAMPLE} per category, concurrency ${CONCURRENCY}\n`);
console.log("category         pop   try   ok  403  net   median      p90      max     total   ms/req  types");
console.log("-".repeat(112));

const totals = {};
for (const { label } of FIELDS) {
  const population = collected.get(label);
  if (!population.length) continue;
  // Even stride across the export rather than the first N, so one advertiser
  // with 80 creatives cannot define the distribution.
  const stride = Math.max(1, Math.floor(population.length / SAMPLE));
  const sample = population.filter((_, i) => i % stride === 0).slice(0, SAMPLE);

  const results = await runPool(sample);
  const ok = results.filter((r) => r.verdict === "ok");
  const sizes = ok.map((r) => r.bytes).sort((a, b) => a - b);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const forbidden = results.filter((r) => r.verdict === "expired/forbidden").length;
  const network = results.filter((r) => r.verdict.startsWith("network")).length;
  const kinds = [...new Set(ok.map((r) => `${r.sniffed}${r.type && !r.type.includes(r.sniffed.split("(")[0]) ? `!=${r.type}` : ""}`))];

  totals[label] = { population: population.length, median: pct(sizes, 0.5), p90: pct(sizes, 0.9), ok: ok.length };

  console.log(
    label.padEnd(16) +
    String(population.length).padStart(4) +
    String(results.length).padStart(6) +
    String(ok.length).padStart(5) +
    String(forbidden).padStart(5) +
    String(network).padStart(5) +
    kb(pct(sizes, 0.5)).padStart(9) +
    kb(pct(sizes, 0.9)).padStart(9) +
    kb(sizes[sizes.length - 1]).padStart(9) +
    kb(sizes.reduce((a, b) => a + b, 0)).padStart(10) +
    String(Math.round(pct(times, 0.5) ?? 0)).padStart(9) + "  " +
    kinds.join(" "),
  );
}

console.log("\n(medians and p90 are measured bytes; population is the full count in this export)");
