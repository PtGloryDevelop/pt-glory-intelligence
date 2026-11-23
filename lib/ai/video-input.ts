// What AI is shown of a video ad the reader has prepared (spec 2026-11-23, Ticket 4): frames in time
// order with their second, and the transcript of the audio. Pure, so what the model sees is tested.
import type {Message} from './call.ts';
import type {VideoContext} from './compare-shared.ts';

/** The ad_video_readings columns Compare reads (RLS: any signed-in role). */
export type VideoRow = {
  status: string; duration_ms: number | null; processed_ms: number | null; has_audio: boolean | null;
  frames: {t_ms: number; path: string; sha256?: string}[];
  audio_path: string | null; audio_sha256: string | null; hook_audio_path: string | null; hook_audio_sha256: string | null;
};
export type Transcripts = {audio: string | null; hook: string | null};
type Part = Exclude<Message['content'], string>[number];

export const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ready = (row: VideoRow | null): row is VideoRow => row?.status === 'ready' && row.frames.length > 0;

/**
 * Part of the reading's cache key: a clip read before its frames existed is read again once they
 * do, and a new reading of the clip is never served the old one.
 */
export function videoMarker(row: VideoRow | null): string {
  return ready(row) ? `|video:${row.audio_sha256 ?? 'silent'}:${row.frames.map(frame => frame.sha256 ?? frame.t_ms).join('.')}` : '';
}

/** One transcription per audio file, cached in ai_analyses (kind transcript) and paid once. */
export function transcriptKey(observationId: string, part: 'audio' | 'hook', sha256: string) {
  return `transcript:gpt-transcribe:${observationId}:${part}:${sha256.slice(0, 16)}`;
}

/** Billed seconds round up: one second more than the audio's length per file, before a call. */
export function transcriptionEstimateUsd(row: VideoRow, cached: ReadonlySet<'audio' | 'hook'>, usdPerMinute: number) {
  if (!ready(row) || !row.has_audio) return 0;
  const processed = (row.processed_ms ?? 0) / 1000;
  const seconds = (cached.has('audio') ? 0 : Math.ceil(processed) + 1) + (cached.has('hook') ? 0 : Math.ceil(Math.min(5, processed)) + 1);
  return seconds / 60 * usdPerMinute;
}

/**
 * The clip as the model sees it: what part was read, the transcript (or plainly that the audio was
 * not heard), then each frame labelled with its second. `transcripts` null means not transcribed.
 */
export function videoParts(row: VideoRow, frames: {t_ms: number; dataUrl: string}[], transcripts: Transcripts | null): Part[] {
  const duration = row.duration_ms ?? 0, processed = row.processed_ms ?? 0;
  const cut = duration > processed + 500;
  const heard = transcripts === null
    ? 'ไม่ได้ฟังเสียงของคลิปนี้ ห้ามสรุปว่าในเสียงมีหรือไม่มีอะไร'
    : !row.has_audio ? 'คลิปนี้ไม่มีเสียง'
      : `บทพูดที่ AI ถอดจากเสียง (อาจคลาดเคลื่อนบางคำ):\n5 วินาทีแรก: "${transcripts.hook || '(ไม่พบเสียงพูด)'}"\nทั้งช่วงที่ดู: "${transcripts.audio || '(ไม่พบเสียงพูด)'}"`;
  const parts: Part[] = [{type: 'text', text: `คลิปวิดีโอยาว ${mmss(duration)} · AI ดูช่วง 0:00–${mmss(processed)}${cut ? ' (เฉพาะ 2 นาทีแรก)' : ''} · ภาพจากคลิป ${frames.length} ภาพเรียงตามเวลาอยู่ด้านล่าง\n${heard}`}];
  for (const frame of frames) {
    parts.push({type: 'text', text: `ภาพที่ ${mmss(frame.t_ms)}`});
    parts.push({type: 'image_url', image_url: {url: frame.dataUrl, detail: 'low'}});
  }
  return parts;
}

/** What the page is told about each ad's clip (no paths, no links). */
export function videoContext(kind: 'own' | 'rival', format: string, row: VideoRow | null, heard: boolean, speech: boolean | null = null): VideoContext | null {
  const blank = {durationMs: null, processedMs: null, frames: 0, hasAudio: null, heard: false, speech: null};
  if (kind === 'own') return format === 'วิดีโอ' ? {status: 'owned', ...blank} : null;
  if (format !== 'VIDEO') return null;
  if (!row) return {status: 'none', ...blank};
  return {
    status: row.status as VideoContext['status'], durationMs: row.duration_ms, processedMs: row.processed_ms,
    frames: row.status === 'ready' ? row.frames.length : 0, hasAudio: row.has_audio, heard, speech: heard ? speech : null,
  };
}
