// The real outside world for lib/media/video-reader.ts: the fetch policy the preview archive uses,
// ffmpeg/ffprobe from PATH (the VPS image installs them), and the private video bucket.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateTarget } from "./fetch.ts";
import { FRAME_WIDTH, MAX_VIDEO_BYTES } from "./video-plan.ts";
import type { DownloadResult, Probe, ReaderDeps } from "./video-reader.ts";
import { videoUploader } from "./store-supabase.ts";

const run = promisify(execFile);
const DOWNLOAD_TIMEOUT_MS = 90_000;
const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * One download under the preview archive's policy (https, fbcdn only, public addresses, no
 * redirects), plus a video content type and a byte ceiling counted while streaming, so a server
 * that lies about its length still cannot fill the disk.
 */
export async function downloadVideo(url: string, file: string): Promise<DownloadResult> {
  const refused = await validateTarget(url);
  if (refused) return { ok: false, reason: refused };
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    // A refused redirect also lands here (fetch throws TypeError for both); fbcdn video links have
    // not been seen to redirect, so it is treated as a network failure and retried a bounded number of times.
    return { ok: false, reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (response.status === 403 || response.status === 410) return { ok: false, reason: "expired" };
  if (!response.ok || !response.body) return { ok: false, reason: `http_${response.status}` };
  if (!(response.headers.get("content-type") ?? "").startsWith("video/")) return { ok: false, reason: "not_video" };
  if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) return { ok: false, reason: "too_large" };

  const out = createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > MAX_VIDEO_BYTES) return { ok: false, reason: "too_large" };
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  } catch {
    return { ok: false, reason: "network" };
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  return { ok: true, file, bytes };
}

export async function probeVideo(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file], { timeout: FFMPEG_TIMEOUT_MS });
  const parsed = JSON.parse(stdout) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
  const types = new Set((parsed.streams ?? []).map((stream) => stream.codec_type));
  return { durationS: Number(parsed.format?.duration) || 0, hasVideo: types.has("video"), hasAudio: types.has("audio") };
}

export const nodeReaderDeps = (): ReaderDeps => {
  const upload = videoUploader();
  return {
    download: downloadVideo,
    probe: probeVideo,
    // Arguments as an array, never a shell string: nothing in a path can become a command.
    cutFrame: async (file, atS, out) => {
      await run("ffmpeg", ["-y", "-v", "error", "-ss", String(atS), "-i", file, "-frames:v", "1", "-vf", `scale=${FRAME_WIDTH}:-2`, "-q:v", "7", out], { timeout: FFMPEG_TIMEOUT_MS });
    },
    cutAudio: async (file, seconds, out) => {
      await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-t", String(seconds), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", out], { timeout: FFMPEG_TIMEOUT_MS });
    },
    readFile: (path) => readFile(path),
    put: upload,
    tempDir: () => mkdtemp(join(tmpdir(), "video-reader-")),
    cleanup: (dir) => rm(dir, { recursive: true, force: true }),
  };
};
