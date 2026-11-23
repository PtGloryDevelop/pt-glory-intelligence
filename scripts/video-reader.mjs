// The video reader: copies frames and audio of rival video ads into our storage before their links
// expire (spec docs/superpowers/specs/2026-11-23-ad-video-reading.md). Runs on the VPS in
// deploy/video-reader; needs ffmpeg/ffprobe, DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. No AI call here: transcription happens on the web when a set is compared.
//   node --conditions=react-server --experimental-strip-types scripts/video-reader.mjs            loop
//   ... scripts/video-reader.mjs --once                                                        one pass
//   ... scripts/video-reader.mjs --enqueue-since-hours 72 --once    queue recent runs first, then one pass
import { closePool } from "../lib/db/privileged.ts";
import { claimVideoReadings, enqueueRecentRuns, finishVideoReading } from "../lib/media/video-queue.ts";
import { readVideo } from "../lib/media/video-reader.ts";
import { nodeReaderDeps } from "../lib/media/video-reader-node.ts";
import { ensureVideoBucket } from "../lib/media/store-supabase.ts";

const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const once = process.argv.includes("--once");
const intervalMinutes = Number(process.env.VIDEO_READER_INTERVAL_MINUTES) || 10;
const batch = Number(process.env.VIDEO_READER_BATCH) || 30;
const parallel = 2;
const log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

async function pass(deps) {
  const claimed = await claimVideoReadings(batch);
  const counts = {};
  // Two at a time: a 4-core VPS that also runs the owned-ads sync.
  for (let offset = 0; offset < claimed.length; offset += parallel) {
    await Promise.all(claimed.slice(offset, offset + parallel).map(async (claim) => {
      const started = Date.now();
      const result = await readVideo(claim, deps);
      await finishVideoReading(claim.id, result, claim.attempt);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      // Ids, sizes and times only: never a link.
      log("video", {
        observation: claim.observationId, status: result.status, ms: Date.now() - started, attempt: claim.attempt,
        ...(result.status === "ready"
          ? { duration_s: Math.round(result.durationMs / 1000), frames: result.frames.length, audio: result.hasAudio,
              kb: Math.round((result.frames.reduce((sum, frame) => sum + frame.bytes, 0) + (result.audio?.bytes ?? 0) + (result.hook?.bytes ?? 0)) / 1024) }
          : { reason: result.reason }),
      });
    }));
  }
  log("pass_end", { claimed: claimed.length, ...counts });
  return claimed.length;
}

try {
  const since = Number(arg("enqueue-since-hours"));
  if (since > 0) log("enqueued", await enqueueRecentRuns(since));
  await ensureVideoBucket();
  const deps = nodeReaderDeps();
  log("reader_start", { interval_minutes: intervalMinutes, batch, once });
  for (;;) {
    let claimed = 0;
    try { claimed = await pass(deps); } catch (error) { log("pass_failed", { error: error instanceof Error ? error.name : "error" }); }
    if (once) break;
    // A full batch means more is waiting: go again soon rather than in ten minutes.
    await new Promise((resolve) => setTimeout(resolve, claimed >= batch ? 30_000 : intervalMinutes * 60_000));
  }
} finally {
  await closePool();
}
