import 'server-only';

import {AiError, type Call, type Message, type ReplyFormat} from './call.ts';

// One model for every call; set OPENAI_MODEL to change it (cached rows are per model).
export const MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
/**
 * USD per 1M tokens [cached input, input, output], short context (≤272K input), from
 * developers.openai.com/api/docs/pricing on 2026-11-23. Both read pictures. A model not listed here
 * is refused, so no call is ever priced by guess.
 */
const MODELS: Record<string, {price: [number, number, number]; vision: boolean}> = {
  'gpt-6-luna': {price: [0.01, 0.1, 0.5], vision: true},
  'gpt-6.1-terra': {price: [0.05, 1, 5], vision: true},
};
/**
 * Speech to text for the video reading (spec 2026-11-23): USD per minute of audio, billed by the
 * whole second OpenAI reports in usage.seconds (measured in Ticket 1: a 48.0 s clip was billed 49 s).
 */
export const TRANSCRIBE_MODEL = 'gpt-transcribe';
export const TRANSCRIBE_USD_PER_MINUTE = 0.0045;
/** Whether this deployment holds an OpenAI key at all. The key is read in this file only. */
export const keySet = () => Boolean(process.env.OPENAI_API_KEY);
/** Model names whose rows count against the OpenAI credit (see provider.ts), transcription included. */
export const PRICED_MODELS = [...Object.keys(MODELS), TRANSCRIBE_MODEL];

/**
 * Both models think before answering, and the thinking is billed as output. These calls fill in
 * fields from what the ad shows, so a little is enough; OPENAI_REASONING_EFFORT can raise it.
 */
const EFFORTS = ['none', 'low', 'medium', 'high'] as const;
const EFFORT = (EFFORTS as readonly string[]).includes(process.env.OPENAI_REASONING_EFFORT ?? '') ? process.env.OPENAI_REASONING_EFFORT : 'low';

export function modelConfig() {
  const config = MODELS[MODEL];
  if (!config) throw new AiError(`ไม่รู้จักโมเดล ${MODEL} ตั้ง OPENAI_MODEL เป็น ${Object.keys(MODELS).join(' หรือ ')}`, 503);
  return config;
}

export function callUsd(tokens: {cached: number; uncached: number; output: number}) {
  const [cached, input, output] = modelConfig().price;
  return (tokens.cached * cached + tokens.uncached * input + tokens.output * output) / 1e6;
}

/** Before a call: no cache hits, so the estimate is not lower than the bill (thinking is extra output). */
export function estimateUsd(input: number, output: number) {
  const [, price, out] = modelConfig().price;
  return (input * price + output * out) / 1e6;
}

/**
 * Thai speech to text for one MP3 cut by the video reader. The text is an AI transcription and is
 * shown as one; empty text means no speech was heard (music only), never a guess.
 */
export async function transcribeAudio(bytes: Buffer): Promise<{text: string; seconds: number; usd: number}> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError('ยังไม่ได้ตั้งค่าคีย์ OpenAI (OPENAI_API_KEY) บนเซิร์ฟเวอร์ แจ้งผู้ดูแลระบบ', 503);
  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'th');
  form.append('file', new Blob([new Uint8Array(bytes)], {type: 'audio/mpeg'}), 'audio.mp3');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', signal: AbortSignal.timeout(120_000), headers: {Authorization: `Bearer ${key}`}, body: form,
    });
  } catch { throw new AiError('ติดต่อ OpenAI ไม่ได้ ลองใหม่อีกครั้ง', 502); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? data?.error?.type;
    if (response.status === 429 && code === 'insufficient_quota') throw new AiError('เครดิตในบัญชี OpenAI หมด', 402);
    if (response.status === 401) throw new AiError('OPENAI_API_KEY ไม่ถูกต้อง', 503);
    if (response.status === 429) throw new AiError('OpenAI จำกัดจำนวนครั้ง รอสักครู่แล้วลองใหม่', 429);
    if (response.status >= 500) throw new AiError('OpenAI ขัดข้องชั่วคราว รอสักครู่แล้วลองใหม่', 503);
    console.error('OpenAI transcription error', response.status, code);
    throw new AiError('ถอดเสียงจากคลิปไม่สำเร็จ', 502);
  }
  if (typeof data?.text !== 'string') throw new AiError('อ่านผลถอดเสียงไม่ได้', 502);
  // Billed by the second; without the usage figure nothing is priced by guess.
  const seconds = Number(data?.usage?.type === 'duration' ? data.usage.seconds : NaN);
  if (!Number.isFinite(seconds) || seconds < 0) throw new AiError('OpenAI ไม่ได้บอกความยาวเสียงที่คิดเงิน', 502);
  return {text: data.text.trim(), seconds, usd: seconds / 60 * TRANSCRIBE_USD_PER_MINUTE};
}

/** One call. With a format the reply is held to that schema (strict); the caller still checks it. */
export async function callOpenAI(messages: Message[], maxTokens: number, format?: ReplyFormat): Promise<Call> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError('ยังไม่ได้ตั้งค่าคีย์ OpenAI (OPENAI_API_KEY) บนเซิร์ฟเวอร์ แจ้งผู้ดูแลระบบ', 503);
  modelConfig();
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: MODEL, messages, max_completion_tokens: maxTokens, reasoning_effort: EFFORT,
        response_format: format ? {type: 'json_schema', json_schema: {name: format.name, strict: true, schema: format.schema}} : {type: 'json_object'},
      }),
    });
  } catch { throw new AiError('ติดต่อ OpenAI ไม่ได้ ลองใหม่อีกครั้ง', 502); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? data?.error?.type;
    if (response.status === 429 && code === 'insufficient_quota') throw new AiError('เครดิตในบัญชี OpenAI หมด', 402);
    if (response.status === 401) throw new AiError('OPENAI_API_KEY ไม่ถูกต้อง', 503);
    if (response.status === 429) throw new AiError('OpenAI จำกัดจำนวนครั้ง รอสักครู่แล้วลองใหม่', 429);
    if (response.status >= 500) throw new AiError('OpenAI ขัดข้องชั่วคราว รอสักครู่แล้วลองใหม่', 503);
    console.error('OpenAI error', response.status, code);
    throw new AiError('OpenAI ตอบกลับผิดพลาด', 502);
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AiError('OpenAI ตอบยาวเกินกำหนด ลองใหม่อีกครั้ง', 502);
  // With a schema, a refusal comes back in its own field instead of the content.
  if (typeof choice?.message?.refusal === 'string' && choice.message.refusal) throw new AiError('AI ไม่ตอบคำขอนี้ ลองถามใหม่อีกแบบ', 422);
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AiError('OpenAI ตอบกลับว่าง ลองใหม่อีกครั้ง', 502);
  let result: unknown;
  try { result = JSON.parse(content); } catch { throw new AiError('อ่านผลจาก OpenAI ไม่ได้', 502); }
  const input = Number(data?.usage?.prompt_tokens) || 0, output = Number(data?.usage?.completion_tokens) || 0;
  // completion_tokens already includes the thinking; cached_tokens is the part of the prompt read from cache.
  const cached = Math.min(Number(data?.usage?.prompt_tokens_details?.cached_tokens) || 0, input);
  return {result, input, output, usd: callUsd({cached, uncached: input - cached, output})};
}
