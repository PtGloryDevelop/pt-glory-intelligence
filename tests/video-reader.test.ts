import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ATTEMPTS, frameTimes, queueStatusOf, readWindow, selectVideo, videoPaths } from "../lib/media/video-plan.ts";
import { downloadOutcome, readVideo, type ReaderDeps } from "../lib/media/video-reader.ts";

const oe = (date: Date) => Math.floor(date.getTime() / 1000).toString(16);
const link = (expires: Date, host = "video-dub4-1.xx.fbcdn.net") => `https://${host}/v/t42/clip.mp4?oe=${oe(expires)}&_nc_sid=x`;

test("only a VIDEO observation has a link to read, standard definition first", () => {
  const later = new Date("2026-11-27T10:00:00Z");
  const video = { videos: [{ video_hd_url: link(later), video_sd_url: link(later, "video-sd.xx.fbcdn.net") }] };
  const picked = selectVideo("VIDEO", video);
  assert.equal(picked.outcome, "candidate");
  if (picked.outcome === "candidate") {
    assert.equal(picked.sourceField, "video_sd_url");
    assert.equal(picked.host, "video-sd.xx.fbcdn.net");
    assert.equal(picked.expiresAt?.toISOString(), later.toISOString());
  }
  assert.equal(selectVideo("VIDEO", { videos: [{ video_hd_url: link(later) }] }).outcome, "candidate", "hd when there is no sd");
  assert.equal(selectVideo("IMAGE", video).outcome, "none");
  assert.equal(selectVideo("VIDEO", { videos: [] }).outcome, "none");
  assert.equal(selectVideo("VIDEO", { videos: [{ video_sd_url: "http://x.fbcdn.net/a.mp4" }] }).outcome, "none", "https only");
  assert.equal(selectVideo("VIDEO", null).outcome, "none");
});

test("the queue records dead links and missing videos at once; only live links wait for the worker", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const live = selectVideo("VIDEO", { videos: [{ video_sd_url: link(new Date("2026-11-25T00:00:00Z")) }] });
  const dead = selectVideo("VIDEO", { videos: [{ video_sd_url: link(new Date("2026-11-20T00:00:00Z")) }] });
  assert.deepEqual(queueStatusOf(live, now), { status: "pending", reason: null });
  assert.deepEqual(queueStatusOf(dead, now), { status: "expired", reason: "expired_before_queue" });
  assert.deepEqual(queueStatusOf({ outcome: "none" }, now), { status: "no_video", reason: "no_video_entry" });
});

test("frames: the hook at 0, 1 and 3 s, the rest spread to the end of the first two minutes, eight at most", () => {
  assert.deepEqual(frameTimes(48), [0, 1, 3, 5, 15, 26, 36, 47], "the last one at the end, where the call to action usually is");
  assert.deepEqual(frameTimes(330), [0, 1, 3, 5, 33, 62, 90, 119]);
  const long = frameTimes(330);
  assert.equal(long.length, 8);
  assert.ok(long.every((t) => t < 120), "a long clip is read for its first 120 s only");
  assert.deepEqual(long.slice(0, 3), [0, 1, 3]);
  assert.deepEqual(frameTimes(4), [0, 1, 3]);
  assert.deepEqual(frameTimes(2), [0, 1]);
  assert.deepEqual(frameTimes(0.5), [0], "always the first frame");
  for (const duration of [6, 25, 47.6, 113.3, 218]) {
    const times = frameTimes(duration);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "in time order");
    assert.equal(new Set(times).size, times.length, "no repeats");
  }
  assert.equal(readWindow(330), 120);
  assert.equal(readWindow(48), 48);
});

test("paths are per observation and refuse anything but a numeric id", () => {
  const paths = videoPaths("2189");
  assert.equal(paths.frame(0), "video/2189/frame-0.jpg");
  assert.equal(paths.audio, "video/2189/audio.mp3");
  assert.equal(paths.hook, "video/2189/hook.mp3");
  assert.throws(() => videoPaths("../2189"));
});

test("a dead link stops for good; a passing failure is retried until the attempts run out", () => {
  assert.deepEqual(downloadOutcome("expired", 1), { status: "expired", reason: "source_expired" });
  assert.deepEqual(downloadOutcome("too_large", 1), { status: "too_large", reason: "over_size_limit" });
  assert.deepEqual(downloadOutcome("host_rejected", 1), { status: "failed", reason: "host_rejected" }, "a policy refusal is final");
  assert.deepEqual(downloadOutcome("network", 1), { status: "retry", reason: "network" });
  assert.deepEqual(downloadOutcome("http_503", MAX_ATTEMPTS), { status: "failed", reason: "http_503" });
});

/** Fakes for every outside effect; records what was stored and whether the temp dir was cleaned. */
function fakes(overrides: Partial<ReaderDeps> = {}) {
  const stored = new Map<string, { bytes: number; mime: string }>();
  const cleaned: string[] = [];
  const deps: ReaderDeps = {
    download: async (_url, file) => ({ ok: true, file, bytes: 4_100_000 }),
    probe: async () => ({ durationS: 48, hasVideo: true, hasAudio: true }),
    cutFrame: async () => {},
    cutAudio: async () => {},
    readFile: async (path) => Buffer.from(`bytes of ${path.split(/[\\/]/).at(-1)}`),
    put: async (path, bytes, mime) => { stored.set(path, { bytes: bytes.length, mime }); },
    tempDir: async () => "tmp-dir",
    cleanup: async (dir) => { cleaned.push(dir); },
    ...overrides,
  };
  return { deps, stored, cleaned };
}
const claim = { id: "r1", observationId: "2189", url: link(new Date("2026-11-25T00:00:00Z")), attempt: 1 };

test("a clip with sound becomes ready: eight frames with their times, the audio and the hook, all stored and hashed", async () => {
  const cuts: { audio: number[] } = { audio: [] };
  const { deps, stored, cleaned } = fakes({ cutAudio: async (_file, seconds) => { cuts.audio.push(seconds); } });
  const result = await readVideo(claim, deps);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.durationMs, 48000);
  assert.equal(result.processedMs, 48000);
  assert.deepEqual(result.frames.map((frame) => frame.t_ms), [0, 1000, 3000, 5000, 15000, 26000, 36000, 47000]);
  assert.ok(result.frames.every((frame) => /^[0-9a-f]{64}$/.test(frame.sha256) && frame.bytes > 0));
  assert.equal(result.audio?.path, "video/2189/audio.mp3");
  assert.equal(result.hook?.path, "video/2189/hook.mp3");
  assert.deepEqual(cuts.audio, [48, 5], "the read window, then the first five seconds");
  assert.equal(stored.size, 10);
  assert.equal(stored.get("video/2189/frame-0.jpg")?.mime, "image/jpeg");
  assert.equal(stored.get("video/2189/audio.mp3")?.mime, "audio/mpeg");
  assert.deepEqual(cleaned, ["tmp-dir"], "the downloaded clip is never kept");
});

test("a silent clip is ready with frames only; a file with no video stream is no_video", async () => {
  const silent = fakes({ probe: async () => ({ durationS: 20, hasVideo: true, hasAudio: false }) });
  const result = await readVideo(claim, silent.deps);
  assert.equal(result.status, "ready");
  if (result.status === "ready") { assert.equal(result.hasAudio, false); assert.equal(result.audio, null); assert.equal(result.hook, null); }
  const noVideo = fakes({ probe: async () => ({ durationS: 20, hasVideo: false, hasAudio: true }) });
  assert.deepEqual(await readVideo(claim, noVideo.deps), { status: "no_video", reason: "no_video_stream" });
  assert.equal(noVideo.stored.size, 0);
});

test("a dead link, a missing link and a broken cut: nothing stored, the temp dir still cleaned", async () => {
  const dead = fakes({ download: async () => ({ ok: false, reason: "expired" }) });
  assert.deepEqual(await readVideo(claim, dead.deps), { status: "expired", reason: "source_expired" });
  assert.equal(dead.stored.size, 0);
  assert.deepEqual(dead.cleaned, ["tmp-dir"]);
  assert.deepEqual(await readVideo({ ...claim, url: null }, fakes().deps), { status: "no_video", reason: "no_video_entry" });
  const broken = fakes({ cutFrame: async () => { throw new Error("ffmpeg exited 1"); } });
  assert.deepEqual(await readVideo(claim, broken.deps), { status: "retry", reason: "processing_Error" });
  assert.deepEqual(await readVideo({ ...claim, attempt: MAX_ATTEMPTS }, broken.deps), { status: "failed", reason: "processing_Error" });
  assert.deepEqual(broken.cleaned, ["tmp-dir", "tmp-dir"]);
});
