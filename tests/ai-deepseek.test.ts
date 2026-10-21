import assert from 'node:assert/strict';
import test from 'node:test';

// MODEL and the key are read from the environment; set them before the module loads. fetch is mocked
// in every test, so no suite ever reaches DeepSeek.
process.env.DEEPSEEK_MODEL = 'deepseek-flash';
process.env.DEEPSEEK_API_KEY = 'test-key';
const {AiError, callDeepSeek, callUsd, estimateUsd, isPeak} = await import('../lib/ai/deepseek.ts');

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(status: number, body: unknown) {
  const calls: {url: string; init: RequestInit}[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({url: String(url), init: init ?? {}});
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  }) as typeof fetch;
  return calls;
}
const completion = (content: string | null, usage: object = {prompt_tokens: 1000, completion_tokens: 500, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 800}, finish = 'stop') =>
  ({choices: [{message: {role: 'assistant', content}, finish_reason: finish}], usage});
const near = (value: number, options: number[]) => options.some(option => Math.abs(option - value) < 1e-12);
const aiError = (status: number, words: RegExp) => (error: unknown) => error instanceof AiError && error.status === status && words.test(error.message);

test('peak hours are 01–04 and 06–10 UTC on weekdays', () => {
  const at = (iso: string) => isPeak(new Date(iso));
  // 2026-10-19 is a Monday, 2026-10-24 a Saturday.
  assert.deepEqual(['00:59', '01:00', '03:59', '04:00', '05:30', '06:00', '09:59', '10:00', '14:00'].map(time => at(`2026-10-19T${time}Z`)),
    [false, true, true, false, false, true, true, false, false]);
  assert.equal(at('2026-10-24T02:00Z'), false, 'weekend is off-peak');
  assert.equal(at('2026-10-25T07:00Z'), false, 'Sunday too');
});

test('cost: hits, misses and output at deepseek-flash rates, half price off-peak', () => {
  const peak = new Date('2026-10-19T02:00Z'), offPeak = new Date('2026-10-19T12:00Z');
  assert.ok(near(callUsd({hit: 1e6, miss: 0, output: 0}, peak), [0.006]));
  assert.ok(near(callUsd({hit: 0, miss: 1e6, output: 1e6}, peak), [1.5]));
  assert.ok(near(callUsd({hit: 0, miss: 1e6, output: 1e6}, offPeak), [0.75]));
  // The estimate shown before a run is the peak, all-miss price.
  assert.ok(near(estimateUsd(3200, 700), [0.0018]));
});

test('call: JSON mode, thinking off, key in the header, cost from DeepSeek\'s own usage', async () => {
  const calls = mockFetch(200, completion('{"ok":true}'));
  const call = await callDeepSeek([{role: 'system', content: 'ตอบเป็น JSON'}, {role: 'user', content: [{type: 'text', text: 'แอด'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA==', detail: 'low'}}]}], 4000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.max_completion_tokens, undefined, 'an OpenAI-only name');
  assert.deepEqual(body.response_format, {type: 'json_object'});
  assert.deepEqual(body.thinking, {type: 'disabled'});
  assert.deepEqual(body.messages[1].content[1], {type: 'image_url', image_url: {url: 'data:image/png;base64,AA==', detail: 'low'}});
  assert.deepEqual(call.result, {ok: true});
  assert.equal(call.input, 1000);
  assert.equal(call.output, 500);
  // 200 hits + 800 misses + 500 output: 0.0008412 at peak, half off-peak.
  assert.ok(near(call.usd, [0.0008412, 0.0004206]), String(call.usd));
});

test('without the cache split every prompt token is priced as a miss', async () => {
  mockFetch(200, completion('{}', {prompt_tokens: 1000, completion_tokens: 0}));
  const call = await callDeepSeek([{role: 'user', content: 'json'}], 100);
  assert.ok(near(call.usd, [0.0003, 0.00015]), String(call.usd));
});

test('provider errors become messages the team can act on', async () => {
  const cases: [number, number, RegExp][] = [
    [402, 402, /ยอดเงิน.*หมด/], [401, 503, /DEEPSEEK_API_KEY ไม่ถูกต้อง/], [429, 429, /จำกัดจำนวนครั้ง/],
    [503, 503, /มีคนใช้มาก/], [422, 502, /ตอบกลับผิดพลาด/], [500, 502, /ตอบกลับผิดพลาด/],
  ];
  for (const [status, expected, words] of cases) {
    mockFetch(status, {error: {message: 'x', type: 'y'}});
    await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(expected, words), `HTTP ${status}`);
  }
});

test('an empty, cut-off or non-JSON reply is refused', async () => {
  mockFetch(200, completion(''));
  await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(502, /ว่าง/));
  mockFetch(200, completion(null));
  await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(502, /ว่าง/));
  mockFetch(200, completion('{"pain":', undefined, 'length'));
  await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(502, /ยาวเกินกำหนด/));
  mockFetch(200, completion('not json'));
  await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(502, /อ่านผล/));
});

test('no key or no network: refused before or at the call', async () => {
  const calls = mockFetch(200, completion('{}'));
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(503, /DEEPSEEK_API_KEY/));
    assert.equal(calls.length, 0, 'nothing sent without a key');
  } finally { process.env.DEEPSEEK_API_KEY = 'test-key'; }
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  await assert.rejects(callDeepSeek([{role: 'user', content: 'json'}], 100), aiError(502, /ติดต่อ DeepSeek ไม่ได้/));
});

test('a model without a known price is refused, never priced by guess', async () => {
  process.env.DEEPSEEK_MODEL = 'gpt-4.1-mini';
  try {
    // A query string loads a second copy of the module, which reads DEEPSEEK_MODEL afresh.
    const fresh = '../lib/ai/deepseek.ts?unknown-model';
    const other = await import(fresh) as typeof import('../lib/ai/deepseek.ts');
    const calls = mockFetch(200, completion('{}'));
    assert.throws(() => other.modelConfig(), (error: unknown) => error instanceof other.AiError && error.status === 503 && /DEEPSEEK_MODEL/.test(error.message));
    await assert.rejects(other.callDeepSeek([{role: 'user', content: 'json'}], 100), /DEEPSEEK_MODEL/);
    assert.equal(calls.length, 0);
  } finally { process.env.DEEPSEEK_MODEL = 'deepseek-flash'; }
});
