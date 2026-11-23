// Reads one claimed video observation: download, cut frames and audio, store them, and say what the
// queue row becomes. Every outside effect comes in through ReaderDeps, so the rules are tested with
// fakes; lib/media/video-reader-node.ts supplies the real network, ffmpeg and storage.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HOOK_S, MAX_ATTEMPTS, frameTimes, readWindow, videoPaths } from "./video-plan.ts";

export type ClaimedReading = { id: string; observationId: string; url: string | null; attempt: number };

/** A download that did not produce a file: `expired` (403/410), `too_large`, a refusal by the
 * fetch policy (`host_rejected`, `scheme_rejected`, `dns_rejected`, `redirect_rejected`, `not_video`),
 * or one that may pass on a later try (`http_5xx`, `network`, `timeout`). */
export type DownloadResult = { ok: true; file: string; bytes: number } | { ok: false; reason: string };
export type Probe = { durationS: number; hasVideo: boolean; hasAudio: boolean };

export type ReaderDeps = {
  download(url: string, file: string): Promise<DownloadResult>;
  probe(file: string): Promise<Probe>;
  cutFrame(file: string, atS: number, out: string): Promise<void>;
  cutAudio(file: string, seconds: number, out: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  put(path: string, bytes: Buffer, mimeType: string): Promise<void>;
  tempDir(): Promise<string>;
  cleanup(dir: string): Promise<void>;
};

export type StoredFile = { path: string; bytes: number; sha256: string };
export type Frame = StoredFile & { t_ms: number };
export type ReadResult =
  | { status: "ready"; durationMs: number; processedMs: number; hasAudio: boolean; frames: Frame[]; audio: StoredFile | null; hook: StoredFile | null }
  | { status: "no_video" | "expired" | "too_large" | "failed"; reason: string }
  | { status: "retry"; reason: string };

const RETRYABLE = /^(http_5\d\d|network|timeout)$/;

/** What a download failure means for the row: stop for good, or try again while attempts remain. */
export function downloadOutcome(reason: string, attempt: number): ReadResult {
  if (reason === "expired") return { status: "expired", reason: "source_expired" };
  if (reason === "too_large") return { status: "too_large", reason: "over_size_limit" };
  if (RETRYABLE.test(reason)) return attempt >= MAX_ATTEMPTS ? { status: "failed", reason } : { status: "retry", reason };
  return { status: "failed", reason };
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function readVideo(claim: ClaimedReading, deps: ReaderDeps): Promise<ReadResult> {
  if (!claim.url) return { status: "no_video", reason: "no_video_entry" };
  const paths = videoPaths(claim.observationId);
  const dir = await deps.tempDir();
  try {
    const clip = join(dir, "clip.mp4");
    const downloaded = await deps.download(claim.url, clip);
    if (!downloaded.ok) return downloadOutcome(downloaded.reason, claim.attempt);

    const probe = await deps.probe(clip);
    if (!probe.hasVideo || !(probe.durationS > 0)) return { status: "no_video", reason: "no_video_stream" };
    const window = readWindow(probe.durationS);

    const store = async (local: string, path: string, mimeType: string): Promise<StoredFile> => {
      const bytes = await deps.readFile(local);
      await deps.put(path, bytes, mimeType);
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    };

    const frames: Frame[] = [];
    for (const [index, atS] of frameTimes(probe.durationS).entries()) {
      const local = join(dir, `frame-${index}.jpg`);
      try {
        await deps.cutFrame(clip, atS, local);
      } catch (error) {
        // One frame ffmpeg cannot cut (a seek past the video's end) is left out; without the first
        // frame the clip is not read, and a storage failure below still fails the whole clip.
        if (index === 0) throw error;
        continue;
      }
      frames.push({ t_ms: atS * 1000, ...await store(local, paths.frame(frames.length), "image/jpeg") });
    }

    let audio: StoredFile | null = null, hook: StoredFile | null = null;
    if (probe.hasAudio) {
      await deps.cutAudio(clip, window, join(dir, "audio.mp3"));
      audio = await store(join(dir, "audio.mp3"), paths.audio, "audio/mpeg");
      await deps.cutAudio(clip, Math.min(HOOK_S, window), join(dir, "hook.mp3"));
      hook = await store(join(dir, "hook.mp3"), paths.hook, "audio/mpeg");
    }
    return {
      status: "ready", durationMs: Math.round(probe.durationS * 1000), processedMs: Math.round(window * 1000),
      hasAudio: probe.hasAudio, frames, audio, hook,
    };
  } catch (error) {
    // ffmpeg, storage or the disk: worth another try while attempts remain. Never a URL in the reason.
    const reason = `processing_${error instanceof Error ? error.name : "error"}`.slice(0, 60);
    return claim.attempt >= MAX_ATTEMPTS ? { status: "failed", reason } : { status: "retry", reason };
  } finally {
    await deps.cleanup(dir);
  }
}
