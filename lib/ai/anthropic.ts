import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import {AiError, type Call, type Message, type ReplyFormat} from './call.ts';

// One model for every call; set ANTHROPIC_MODEL to change it (cached rows are per model).
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
type Price = [cacheRead: number, cacheWrite: number, input: number, output: number];
/**
 * USD per 1M tokens [cache read, 5-minute cache write, input, output], from
 * platform.claude.com/docs/en/about-claude/pricing on 2026-11-26. All three read pictures. A model
 * not listed here is refused, so no call is ever priced by guess.
 *
 * `fallback` is the model the API runs the same request on when this model's safety classifier
 * declines it (see callClaude). Claude Haiku 5.5 has no server-side fallback.
 */
const MODELS: Record<string, {price: Price; vision: boolean; fallback?: string}> = {
  'claude-opus-5-5': {price: [0.2, 5, 4, 20], vision: true, fallback: 'claude-opus-4-8'},
  'claude-sonnet-5-5': {price: [0.1, 2.5, 2, 10], vision: true, fallback: 'claude-sonnet-5'},
  'claude-haiku-5-5': {price: [0.01, 0.125, 0.1, 0.5], vision: true},
};
/** Models that only ever answer as a fallback: priced, never chosen with ANTHROPIC_MODEL. */
const FALLBACK_PRICES: Record<string, Price> = {
  'claude-opus-4-8': [0.5, 6.25, 5, 25],
  'claude-sonnet-5': [0.2, 2.5, 2, 10],
};
/** Claude Haiku 5.5 costs more on a prompt over 100,000 tokens; ours are a few thousand. */
const HAIKU_LONG: Price = [0.05, 0.625, 0.5, 2.5];
/** The dearest rates above: an attempt by a model this table does not know is recorded at these, never lower. */
const DEAREST: Price = [0.5, 6.25, 5, 25];
/** Model names whose rows count against the Claude credit (see provider.ts). */
export const PRICED_MODELS = Object.keys(MODELS);

/**
 * Every current Claude model thinks before it answers, and the thinking is billed as output. These
 * calls fill in fields from what the ad shows, so a little is enough; ANTHROPIC_EFFORT can raise it.
 */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const EFFORT = EFFORTS.find(level => level === process.env.ANTHROPIC_EFFORT) ?? 'low';
/** Thinking counts toward max_tokens but is not part of the reply: room for it above the caller's ceiling. */
const THINKING_ROOM = 4000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function modelConfig() {
  const config = MODELS[MODEL];
  if (!config) throw new AiError(`ไม่รู้จักโมเดล ${MODEL} ตั้ง ANTHROPIC_MODEL เป็น ${Object.keys(MODELS).join(' หรือ ')}`, 503);
  return config;
}

type Tokens = {input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null};
/** Claude's input_tokens leaves the cached part out: the whole prompt is the three counts together. */
const promptTokens = (tokens: Tokens) => tokens.input_tokens + (tokens.cache_read_input_tokens ?? 0) + (tokens.cache_creation_input_tokens ?? 0);

/** What one attempt cost, at the rates of the model that ran it. */
export function attemptUsd(model: string, tokens: Tokens) {
  const known = MODELS[model]?.price ?? FALLBACK_PRICES[model];
  if (!known) console.error('Claude attempt by a model with no listed price, recorded at the dearest rates', model);
  const [read, write, input, output] = model === 'claude-haiku-5-5' && promptTokens(tokens) > 100_000 ? HAIKU_LONG : known ?? DEAREST;
  return ((tokens.cache_read_input_tokens ?? 0) * read + (tokens.cache_creation_input_tokens ?? 0) * write
    + tokens.input_tokens * input + tokens.output_tokens * output) / 1e6;
}

/** Before a call: no cache hits, so the estimate is not lower than the bill (thinking is extra output). */
export function estimateUsd(input: number, output: number) {
  const [, , price, out] = modelConfig().price;
  return (input * price + output * out) / 1e6;
}

type Part = Exclude<Message['content'], string>[number];
const DATA_URL = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Our message parts as Claude's content blocks. Pictures arrive as data URLs (compare.ts fetches them itself). */
function block(part: Part): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === 'text') return {type: 'text', text: part.text};
  const match = DATA_URL.exec(part.image_url.url);
  if (!match) throw new AiError('ภาพประกอบอยู่ในรูปแบบที่ Claude อ่านไม่ได้', 502);
  return {type: 'image', source: {type: 'base64', media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: match[2]}};
}

function failure(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AiError('ANTHROPIC_API_KEY ไม่ถูกต้อง', 503);
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError('คีย์ Claude นี้ไม่มีสิทธิ์ใช้โมเดลที่ตั้งไว้', 503);
  if (error instanceof Anthropic.RateLimitError) return new AiError('Claude จำกัดจำนวนครั้ง รอสักครู่แล้วลองใหม่', 429);
  // Before APIError: in this SDK a connection failure or timeout is a subclass of it, with no status.
  if (error instanceof Anthropic.APIConnectionError) return new AiError('ติดต่อ Claude ไม่ได้ ลองใหม่อีกครั้ง', 502);
  if (error instanceof Anthropic.APIError) {
    if (error.status === 402 || error.type === 'billing_error') return new AiError('เครดิตในบัญชี Claude หมด', 402);
    if (typeof error.status === 'number' && error.status >= 500) return new AiError('Claude ขัดข้องชั่วคราว รอสักครู่แล้วลองใหม่', 503);
    console.error('Claude error', error.status, error.type);
    return new AiError('Claude ตอบกลับผิดพลาด', 502);
  }
  console.error('Claude call failed', error instanceof Error ? error.name : 'unknown');
  return new AiError('ติดต่อ Claude ไม่ได้ ลองใหม่อีกครั้ง', 502);
}

/**
 * One call. The reply is held to the format's schema (structured outputs); the caller still checks it.
 *
 * When the model's safety classifier declines a request, the API runs it once more on the model's
 * `fallback` inside the same call. Each attempt is billed at the rates of the model that ran it, and
 * the cost recorded here is the sum of every attempt the response reports.
 */
export async function callClaude(messages: Message[], maxTokens: number, format?: ReplyFormat): Promise<Call> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError('ยังไม่ได้ตั้งค่าคีย์ Claude (ANTHROPIC_API_KEY) บนเซิร์ฟเวอร์ แจ้งผู้ดูแลระบบ', 503);
  const config = modelConfig();
  // Without a schema Claude answers in prose; every caller here names the shape it reads.
  if (!format) throw new AiError('Claude ต้องมีรูปแบบคำตอบกำกับทุกครั้ง', 500);
  const text = (content: Message['content']) => typeof content === 'string' ? content : content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
  const system = messages.filter(message => message.role === 'system').map(message => text(message.content)).join('\n\n');
  let response: Anthropic.Beta.BetaMessage;
  try {
    // 80 s and one retry stay inside the routes' 180 s; the client is made per call, so it holds no state.
    const client = new Anthropic({apiKey: key, timeout: 80_000, maxRetries: 1});
    response = await client.beta.messages.create({
      model: MODEL, max_tokens: maxTokens + THINKING_ROOM,
      ...(system ? {system} : {}),
      messages: messages.flatMap(message => message.role === 'system' ? [] : [{
        role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(block),
      }]),
      output_config: {effort: EFFORT, format: {type: 'json_schema', schema: format.schema}},
      ...(config.fallback ? {betas: [FALLBACK_BETA], fallbacks: [{model: config.fallback}]} : {}),
    });
  } catch (error) { throw failure(error); }
  // The serving attempt's counts are on usage itself; with a fallback, iterations lists every attempt.
  const attempts = response.usage.iterations?.filter(entry => entry.type === 'message' || entry.type === 'fallback_message') ?? [];
  const usd = attempts.length
    ? attempts.reduce((sum, entry) => sum + attemptUsd(entry.model ?? MODEL, entry), 0)
    : attemptUsd(response.model, response.usage);
  if (response.model !== MODEL) console.info('Claude fallback answered', {asked: MODEL, answered: response.model});
  if (response.stop_reason === 'refusal') {
    // The category only: it says which safeguard declined, never what was sent.
    console.error('Claude refusal', response.stop_details?.category ?? null);
    throw new AiError('AI ไม่ตอบคำขอนี้ ลองถามใหม่อีกแบบ', 422);
  }
  if (response.stop_reason === 'max_tokens') throw new AiError('Claude ตอบยาวเกินกำหนด ลองใหม่อีกครั้ง', 502);
  const content = response.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
  if (!content.trim()) throw new AiError('Claude ตอบกลับว่าง ลองใหม่อีกครั้ง', 502);
  let result: unknown;
  try { result = JSON.parse(content); } catch { throw new AiError('อ่านผลจาก Claude ไม่ได้', 502); }
  // output_tokens already includes the thinking.
  return {result, input: promptTokens(response.usage), output: response.usage.output_tokens, usd};
}
