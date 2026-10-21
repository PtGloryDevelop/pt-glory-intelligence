import 'server-only';

export class AiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

// ponytail: one model for every call; set DEEPSEEK_MODEL to change it (cached rows are per model).
export const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
/**
 * USD per 1M tokens at peak [input cache hit, input cache miss, output], from api-docs.deepseek.com
 * on 2026-10-19; off-peak is half. Only deepseek-flash reads pictures. A model not listed here is
 * refused, so no call is ever priced by guess.
 */
const MODELS: Record<string, {price: [number, number, number]; vision: boolean}> = {
  'deepseek-flash': {price: [0.006, 0.3, 1.2], vision: true},
  'deepseek-v4-pro': {price: [0.044, 1.32, 3.96], vision: false},
};

export function modelConfig() {
  const config = MODELS[MODEL];
  if (!config) throw new AiError(`ไม่รู้จักโมเดล ${MODEL} ตั้ง DEEPSEEK_MODEL เป็น ${Object.keys(MODELS).join(' หรือ ')}`, 503);
  return config;
}

/**
 * DeepSeek's peak: 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Chinese public holidays are
 * off-peak but not known here, so they are priced at peak: the record can overstate, never understate.
 */
export function isPeak(at: Date) {
  const day = at.getUTCDay(), hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export function callUsd(tokens: {hit: number; miss: number; output: number}, at: Date) {
  const [hit, miss, output] = modelConfig().price;
  return (tokens.hit * hit + tokens.miss * miss + tokens.output * output) / 1e6 * (isPeak(at) ? 1 : 0.5);
}

/** Before a call: peak rate, no cache hits, so the estimate is not lower than the bill. */
export function estimateUsd(input: number, output: number) {
  const [, miss, out] = modelConfig().price;
  return (input * miss + output * out) / 1e6;
}

export type Message = {role: 'system' | 'user'; content: string | ({type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string; detail: 'low'}})[]};

/** One JSON-mode call. DeepSeek only guarantees the reply parses as JSON; the caller checks its shape. */
export async function callDeepSeek(messages: Message[], maxTokens: number): Promise<{result: unknown; input: number; output: number; usd: number}> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new AiError('ยังไม่ได้ตั้งค่าคีย์ DeepSeek (DEEPSEEK_API_KEY) บนเซิร์ฟเวอร์ แจ้งผู้ดูแลระบบ', 503);
  modelConfig();
  const at = new Date();
  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      // Thinking is on by default and bills its reasoning as output; these calls only fill in fields.
      body: JSON.stringify({model: MODEL, messages, max_tokens: maxTokens, response_format: {type: 'json_object'}, thinking: {type: 'disabled'}}),
    });
  } catch { throw new AiError('ติดต่อ DeepSeek ไม่ได้ ลองใหม่อีกครั้ง', 502); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 402) throw new AiError('ยอดเงินในบัญชี DeepSeek หมด', 402);
    if (response.status === 401) throw new AiError('DEEPSEEK_API_KEY ไม่ถูกต้อง', 503);
    if (response.status === 429) throw new AiError('DeepSeek จำกัดจำนวนครั้ง รอสักครู่แล้วลองใหม่', 429);
    if (response.status === 503) throw new AiError('DeepSeek มีคนใช้มาก รอสักครู่แล้วลองใหม่', 503);
    console.error('DeepSeek error', response.status, data?.error?.code ?? data?.error?.type);
    throw new AiError('DeepSeek ตอบกลับผิดพลาด', 502);
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AiError('DeepSeek ตอบยาวเกินกำหนด ลองใหม่อีกครั้ง', 502);
  const content = choice?.message?.content;
  // JSON mode "may occasionally return empty content" (DeepSeek's JSON Output guide).
  if (typeof content !== 'string' || !content.trim()) throw new AiError('DeepSeek ตอบกลับว่าง ลองใหม่อีกครั้ง', 502);
  let result: unknown;
  try { result = JSON.parse(content); } catch { throw new AiError('อ่านผลจาก DeepSeek ไม่ได้', 502); }
  const input = Number(data?.usage?.prompt_tokens) || 0, output = Number(data?.usage?.completion_tokens) || 0;
  // prompt_tokens = cache hits + misses; without the split every prompt token is priced as a miss.
  const hit = Math.min(Number(data?.usage?.prompt_cache_hit_tokens) || 0, input);
  return {result, input, output, usd: callUsd({hit, miss: input - hit, output}, at)};
}
