import assert from 'node:assert/strict';
import test from 'node:test';
import {AI_SOURCES, readAdReading, SCORE_DIMS, AI_DIMS} from '../lib/ai/compare-shared.ts';
import {AD_FORMAT} from '../lib/ai/formats.ts';
import {mmss, transcriptKey, transcriptionEstimateUsd, videoContext, videoMarker, videoParts, type VideoRow} from '../lib/ai/video-input.ts';

process.env.OPENAI_API_KEY = 'test-key';
const {transcribeAudio, PRICED_MODELS, TRANSCRIBE_MODEL} = await import('../lib/ai/openai.ts');
const {AiError} = await import('../lib/ai/call.ts');

const sha = (c: string) => c.repeat(64);
const row = (overrides: Partial<VideoRow> = {}): VideoRow => ({
  status: 'ready', duration_ms: 48000, processed_ms: 48000, has_audio: true,
  frames: [0, 1000, 3000, 47000].map((t_ms, i) => ({t_ms, path: `video/2189/frame-${i}.jpg`, sha256: sha(String(i))})),
  audio_path: 'video/2189/audio.mp3', audio_sha256: sha('a'), hook_audio_path: 'video/2189/hook.mp3', hook_audio_sha256: sha('b'),
  ...overrides,
});
const frames = (r: VideoRow) => r.frames.map(f => ({t_ms: f.t_ms, dataUrl: 'data:image/jpeg;base64,AA=='}));

test('the model sees each frame under its second, and the transcript with its hook apart', () => {
  const parts = videoParts(row(), frames(row()), {hook: 'คุณหมอรู้สึกตื้อ ๆ ไหมคะ', audio: 'คุณหมอรู้สึกตื้อ ๆ ไหมคะ ... รักษาต่อเนื่อง 5-6 ครั้ง'});
  const first = parts[0];
  assert.equal(first.type, 'text');
  if (first.type === 'text') {
    assert.match(first.text, /คลิปวิดีโอยาว 0:48 · AI ดูช่วง 0:00–0:48 · ภาพจากคลิป 4 ภาพ/);
    assert.match(first.text, /5 วินาทีแรก: "คุณหมอรู้สึกตื้อ ๆ ไหมคะ"/);
    assert.match(first.text, /อาจคลาดเคลื่อน/, 'labelled as an AI transcription');
    assert.doesNotMatch(first.text, /เฉพาะ 2 นาทีแรก/);
  }
  assert.deepEqual(parts.slice(1).map(part => part.type === 'text' ? part.text : 'image'),
    ['ภาพที่ 0:00', 'image', 'ภาพที่ 0:01', 'image', 'ภาพที่ 0:03', 'image', 'ภาพที่ 0:47', 'image']);
});

test('what was not heard is said plainly: a long clip read in part, no audio, music only, not transcribed', () => {
  const head = (r: VideoRow, t: Parameters<typeof videoParts>[2]) => { const part = videoParts(r, frames(r), t)[0]; return part.type === 'text' ? part.text : ''; };
  assert.match(head(row({duration_ms: 430060, processed_ms: 120000}), {audio: 'x', hook: 'y'}), /ยาว 7:10 · AI ดูช่วง 0:00–2:00 \(เฉพาะ 2 นาทีแรก\)/);
  assert.match(head(row({has_audio: false}), {audio: null, hook: null}), /คลิปนี้ไม่มีเสียง/);
  assert.match(head(row(), {audio: '', hook: ''}), /5 วินาทีแรก: "\(ไม่พบเสียงพูด\)"/, 'empty speech is no speech, not a guess');
  assert.match(head(row(), null), /ไม่ได้ฟังเสียงของคลิปนี้ ห้ามสรุปว่าในเสียงมีหรือไม่มีอะไร/);
});

test('a reading made before the clip was ready is not reused once it is; a cover-only key has no marker', () => {
  assert.equal(videoMarker(null), '');
  assert.equal(videoMarker(row({status: 'pending', frames: []})), '');
  const ready = videoMarker(row());
  assert.match(ready, /^\|video:a{64}:/);
  assert.notEqual(ready, videoMarker(row({audio_sha256: sha('c')})), 'a new reading of the clip is a new key');
  assert.match(videoMarker(row({has_audio: false, audio_sha256: null})), /^\|video:silent:/);
});

test('transcripts are keyed per observation, part and file, within the cache key limit', () => {
  const key = transcriptKey('2189', 'hook', sha('b'));
  assert.equal(key, `transcript:gpt-transcribe:2189:hook:${'b'.repeat(16)}`);
  assert.ok(key.length >= 8 && key.length <= 300);
});

test('the estimate pays for the audio not transcribed before: a second over each file, rounded up', () => {
  const price = 0.0045;
  // 48 s + 1, and 5 s + 1: 55 billed seconds.
  assert.ok(Math.abs(transcriptionEstimateUsd(row(), new Set(), price) - 55 / 60 * price) < 1e-12);
  assert.ok(Math.abs(transcriptionEstimateUsd(row(), new Set(['audio']), price) - 6 / 60 * price) < 1e-12);
  assert.equal(transcriptionEstimateUsd(row(), new Set(['audio', 'hook']), price), 0);
  assert.equal(transcriptionEstimateUsd(row({has_audio: false}), new Set(), price), 0);
  assert.ok(Math.abs(transcriptionEstimateUsd(row({duration_ms: 430060, processed_ms: 120000}), new Set(), price) - 127 / 60 * price) < 1e-12);
});

test('the page is told what AI saw of each clip, never a path', () => {
  assert.deepEqual(videoContext('rival', 'VIDEO', row(), true), {status: 'ready', durationMs: 48000, processedMs: 48000, frames: 4, hasAudio: true, heard: true});
  assert.equal(videoContext('rival', 'VIDEO', null, false)?.status, 'none', 'collected before the reader existed');
  assert.equal(videoContext('rival', 'VIDEO', row({status: 'expired', frames: []}), false)?.frames, 0);
  assert.equal(videoContext('rival', 'IMAGE', null, false), null);
  assert.equal(videoContext('own', 'วิดีโอ', null, false)?.status, 'owned');
  assert.equal(videoContext('own', 'ภาพ', null, false), null);
  assert.doesNotMatch(JSON.stringify(videoContext('rival', 'VIDEO', row(), true)), /video\/|\.mp3|\.jpg/);
});

test('"เสียง" is a source the schema allows and the reader keeps', () => {
  assert.ok((AI_SOURCES as readonly string[]).includes('เสียง'));
  const cell = (AD_FORMAT.schema as {properties: Record<string, {properties: {source: {enum: string[]}}}>}).properties.pain.properties.source;
  assert.ok(cell.enum.includes('เสียง'));
  const reply = {
    ...Object.fromEntries(AI_DIMS.map(dim => [dim, {value: 'อ่านได้', source: 'เสียง', quote: 'รักษาต่อเนื่อง 5-6 ครั้ง'}])),
    claims: {items: [{text: 'อาการดีขึ้น 30-40 เปอร์เซ็นต์', risky: true}], quote: 'อาการดีขึ้น 30-40 เปอร์เซ็นต์'},
    scores: Object.fromEntries(SCORE_DIMS.map(dim => [dim, {score: 5, why: 'เหตุผล'}])), fix: 'ตัดคำอ้างผลลัพธ์ออก',
  };
  assert.equal(readAdReading(reply)?.pain.source, 'เสียง');
});

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test('transcription: gpt-transcribe in Thai, priced from the seconds OpenAI bills, and counted in the credit', async () => {
  let sent: FormData | null = null, url = '';
  globalThis.fetch = (async (target: string | URL | Request, init?: RequestInit) => {
    url = String(target); sent = init?.body as FormData;
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    return new Response(JSON.stringify({text: ' คุณหมอรู้สึกตื้อ ๆ ไหมคะ ', languages: [{code: 'th'}], usage: {type: 'duration', seconds: 49}}), {status: 200});
  }) as typeof fetch;
  const heard = await transcribeAudio(Buffer.from('mp3'));
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(sent!.get('model'), 'gpt-transcribe');
  assert.equal(sent!.get('language'), 'th');
  assert.equal(heard.text, 'คุณหมอรู้สึกตื้อ ๆ ไหมคะ');
  assert.equal(heard.seconds, 49);
  assert.ok(Math.abs(heard.usd - 49 / 60 * 0.0045) < 1e-12);
  assert.ok(PRICED_MODELS.includes(TRANSCRIBE_MODEL), 'its rows count toward the caps and the credit bar');
});

test('transcription refuses to price by guess and turns provider errors into messages', async () => {
  const reply = (status: number, body: unknown) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), {status})) as typeof fetch; };
  reply(200, {text: 'x'});
  await assert.rejects(transcribeAudio(Buffer.from('mp3')), (error: unknown) => error instanceof AiError && /ความยาวเสียง/.test(error.message));
  reply(429, {error: {code: 'insufficient_quota'}});
  await assert.rejects(transcribeAudio(Buffer.from('mp3')), (error: unknown) => error instanceof AiError && error.status === 402);
  const errors = console.error; console.error = () => {};
  try {
    reply(400, {error: {code: 'invalid_value'}});
    await assert.rejects(transcribeAudio(Buffer.from('mp3')), (error: unknown) => error instanceof AiError && /ถอดเสียง/.test(error.message));
  } finally { console.error = errors; }
  assert.equal(mmss(430060), '7:10');
});
