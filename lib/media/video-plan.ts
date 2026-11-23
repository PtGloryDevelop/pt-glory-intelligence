// What the video reader does with one rival video observation, as pure decisions: which link, which
// moments to keep as frames, and where the files go. Spec: docs/superpowers/specs/2026-11-23-ad-video-reading.md.
// No I/O here, so every rule is tested without ffmpeg, the network or a database.
import { parseSourceExpiry } from "./select.ts";

/** Only the first two minutes are read; a longer clip says so on screen. */
export const VIDEO_WINDOW_S = 120;
/** gpt-transcribe gives no timestamps, so the hook's audio is cut and read on its own. */
export const HOOK_S = 5;
export const MAX_FRAMES = 8;
export const FRAME_WIDTH = 480;
/** Ticket 1 measured 4.1 MB on average; past this the clip is left alone (too_large). */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
/** Frames at these seconds are always kept: the hook is decided in the first three. */
const HOOK_FRAMES = [0, 1, 3];
/** Retries for a failure that may pass (a 5xx, a dropped connection), while the link lives. */
export const MAX_ATTEMPTS = 3;

export type VideoField = "video_sd_url" | "video_hd_url";
export type VideoSelection =
  | { outcome: "candidate"; sourceField: VideoField; url: string; host: string; expiresAt: Date | null }
  | { outcome: "none" };

/**
 * The link to read for a VIDEO observation: the first video entry, standard definition first (it is
 * all the frames and the audio need, and smaller). Anything that is not a VIDEO ad has no reading.
 */
export function selectVideo(displayFormat: string | null, media: unknown): VideoSelection {
  if (displayFormat !== "VIDEO") return { outcome: "none" };
  const first = (media as { videos?: unknown[] } | null)?.videos?.[0] as Record<string, unknown> | undefined;
  for (const sourceField of ["video_sd_url", "video_hd_url"] as const) {
    const url = first?.[sourceField];
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") continue;
      return { outcome: "candidate", sourceField, url, host: parsed.host, expiresAt: parseSourceExpiry(url) };
    } catch { /* not a URL: try the other field */ }
  }
  return { outcome: "none" };
}

/** The part of the clip that is read, in seconds. */
export const readWindow = (durationS: number) => Math.max(0, Math.min(durationS, VIDEO_WINDOW_S));

/**
 * Seconds to keep as frames: 0, 1 and 3 for the hook, then the rest spread evenly from 0:05 to the
 * last second of the read window (where the call to action usually is), at most eight in all, in
 * time order. A clip under five seconds keeps what its length allows, and always the first frame.
 */
export function frameTimes(durationS: number): number[] {
  const window = readWindow(durationS);
  const hook = HOOK_FRAMES.filter((t) => t === 0 || t < window);
  const rest = MAX_FRAMES - hook.length;
  const last = Math.max(HOOK_S, Math.ceil(window) - 1);
  const spread = window > HOOK_S
    ? Array.from({ length: rest }, (_, i) => Math.floor(HOOK_S + (i * (last - HOOK_S)) / (rest - 1)))
    : [];
  return [...new Set([...hook, ...spread])].filter((t) => t === 0 || t < window).sort((a, b) => a - b).slice(0, MAX_FRAMES);
}

/** Where one observation's files live in the private video bucket (VIDEO_BUCKET). Same bytes, same path: reruns converge. */
export function videoPaths(observationId: string) {
  if (!/^\d+$/.test(observationId)) throw new Error("observation id must be numeric");
  return {
    frame: (index: number) => `video/${observationId}/frame-${index}.jpg`,
    audio: `video/${observationId}/audio.mp3`,
    hook: `video/${observationId}/hook.mp3`,
  };
}

/** What the queue row says before the worker sees it: a link to read, one already dead, or none. */
export function queueStatusOf(selection: VideoSelection, now: Date):
  { status: "pending" | "expired" | "no_video"; reason: string | null } {
  if (selection.outcome === "none") return { status: "no_video", reason: "no_video_entry" };
  if (selection.expiresAt && selection.expiresAt.getTime() <= now.getTime()) return { status: "expired", reason: "expired_before_queue" };
  return { status: "pending", reason: null };
}
