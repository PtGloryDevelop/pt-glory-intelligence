// Ticket 1 of docs/superpowers/specs/2026-11-23-ad-video-reading.md: can gpt-transcribe read Thai ad
// voice-overs well enough? Takes up to N rival video observations whose links are still alive, cuts
// the audio (first 120 s, and the 0–5 s hook) and 8 frames with the local ffmpeg, transcribes both
// audio files, and writes what a person needs to judge it. Writes nothing to the database.
//   node --env-file=.env.local scripts/probe-video-transcribe.mjs --out <dir> [--limit 10] [--since-hours 6]
// Needs ffmpeg and ffprobe on PATH, DATABASE_URL (read-only use) and OPENAI_API_KEY.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';

const arg = (name, fallback = null) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const out = arg('out'), limit = Number(arg('limit', '10')), sinceHours = Number(arg('since-hours', '6'));
if (!out) throw Error('--out is required');
const MAX_BYTES = 150 * 1024 * 1024, WINDOW_S = 120, HOOK_S = 5, PRICE_PER_MIN = 0.0045;

const db = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000});
await db.connect();
let rows;
try {
  ({rows} = await db.query(`select o.id, a.ad_archive_id, po.page_name, o.body_text, o.title,
      coalesce(o.media->'videos'->0->>'video_sd_url', o.media->'videos'->0->>'video_hd_url') url
    from public.ad_observations o join public.ads a on a.id = o.ad_ref
    left join lateral (select page_name from public.page_observations p where p.page_ref = a.page_ref order by observed_at desc limit 1) po on true
    where o.display_format = 'VIDEO' and o.observed_at > now() - make_interval(hours => $1)
      and coalesce(o.media->'videos'->0->>'video_sd_url', o.media->'videos'->0->>'video_hd_url') is not null
    order by o.observed_at desc`, [sinceHours]));
} finally { await db.end(); }

// One clip per page first, so the sample is not ten cuts of one advertiser; then the rest.
const seen = new Set(), picked = [];
for (const row of rows) { if (picked.length < limit && !seen.has(row.page_name)) { seen.add(row.page_name); picked.push(row); } }
for (const row of rows) { if (picked.length < limit && !picked.includes(row)) picked.push(row); }

const run = (bin, args) => execFileSync(bin, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
async function download(url, file) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.fbcdn.net')) return 'host_not_allowed';
  const response = await fetch(parsed, {redirect: 'error', signal: AbortSignal.timeout(90_000)});
  if (response.status === 403 || response.status === 410) return 'expired';
  if (!response.ok) return `http_${response.status}`;
  if (!(response.headers.get('content-type') ?? '').startsWith('video/')) return 'not_video';
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return 'too_large';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) return 'too_large';
  writeFileSync(file, bytes);
  return null;
}
async function transcribe(file) {
  const started = Date.now();
  for (const language of ['th', null]) {
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    if (language) form.append('language', language);
    form.append('file', new Blob([readFileSync(file)], {type: 'audio/mpeg'}), 'audio.mp3');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {method: 'POST', headers: {Authorization: `Bearer ${process.env.OPENAI_API_KEY}`}, body: form, signal: AbortSignal.timeout(120_000)});
    const body = await response.json().catch(() => null);
    if (response.ok) return {text: body?.text ?? '', language: language ?? 'auto', ms: Date.now() - started, usage: body?.usage ?? null, keys: Object.keys(body ?? {})};
    // An unknown language code is the one refusal worth a second try without it.
    if (!(response.status === 400 && language)) return {error: `${response.status} ${body?.error?.code ?? body?.error?.type ?? ''}`.trim(), ms: Date.now() - started};
  }
}

mkdirSync(out, {recursive: true});
const results = [];
for (const row of picked) {
  const dir = join(out, String(row.id));
  mkdirSync(dir, {recursive: true});
  const video = join(dir, 'clip.mp4');
  const result = {observation: row.id, ad: row.ad_archive_id, page: row.page_name, library: `https://www.facebook.com/ads/library/?id=${row.ad_archive_id}`, caption: [row.title, row.body_text].filter(Boolean).join('\n').slice(0, 600)};
  result.status = await download(row.url, video).catch(error => `download_${error.constructor.name}`) ?? 'downloaded';
  if (result.status === 'downloaded') {
    result.videoBytes = statSync(video).size;
    result.durationS = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]));
    result.hasAudio = run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', video]).length > 0;
    const window = Math.min(result.durationS, WINDOW_S);
    // Frame times from the spec: 0, 1, 3, then evenly to the end of the window, at most 8.
    const step = Math.max(2, window / 8), times = [...new Set([0, 1, 3, ...Array.from({length: 8}, (_, k) => Math.round(k * step))])].filter(t => t < window).sort((a, b) => a - b).slice(0, 8);
    result.frames = times.map((t, k) => {
      const file = join(dir, `frame-${k}.jpg`);
      run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', file]);
      return {t, bytes: statSync(file).size};
    });
    if (result.hasAudio) {
      const audio = join(dir, 'audio.mp3'), hook = join(dir, 'hook.mp3');
      run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-t', String(WINDOW_S), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', audio]);
      run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-t', String(HOOK_S), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', hook]);
      result.audioBytes = statSync(audio).size; result.hookBytes = statSync(hook).size;
      result.transcript = await transcribe(audio);
      result.hookTranscript = await transcribe(hook);
      result.estimatedUsd = (window + Math.min(result.durationS, HOOK_S)) / 60 * PRICE_PER_MIN;
    }
  }
  results.push(result);
  console.log(`${result.status} ${result.durationS?.toFixed?.(1) ?? '-'}s audio=${result.hasAudio ?? '-'} ${result.transcript?.error ?? `${(result.transcript?.text ?? '').length} chars`} · ${row.page_name}`);
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
