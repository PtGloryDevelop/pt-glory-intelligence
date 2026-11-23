import assert from 'node:assert/strict';
import test from 'node:test';

// MODEL and the key are read from the environment; set them before the module loads. fetch is mocked
// in every test, so no suite ever reaches OpenAI.
process.env.OPENAI_MODEL = 'gpt-6-luna';
process.env.OPENAI_API_KEY = 'test-key';
delete process.env.OPENAI_REASONING_EFFORT;
const {callOpenAI, callUsd, estimateUsd} = await import('../lib/ai/openai.ts');
const {AiError} = await import('../lib/ai/call.ts');

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
const completion = (message: object, usage: object = {prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: {cached_tokens: 200}}, finish = 'stop') =>
  ({choices: [{message: {role: 'assistant', ...message}, finish_reason: finish}], usage});
const near = (value: number, expected: number) => Math.abs(value - expected) < 1e-12;
const aiError = (status: number, words: RegExp) => (error: unknown) => error instanceof AiError && error.status === status && words.test(error.message);
const format = {name: 'shape', schema: {type: 'object', properties: {ok: {type: 'boolean'}}, required: ['ok'], additionalProperties: false}};

test('cost: cached, uncached and output at gpt-6-luna rates', () => {
  assert.ok(near(callUsd({cached: 1e6, uncached: 0, output: 0}), 0.01));
  assert.ok(near(callUsd({cached: 0, uncached: 1e6, output: 1e6}), 0.6));
  // The estimate shown before a run assumes no cache: 3200 in + 700 out.
  assert.ok(near(estimateUsd(3200, 700), 0.00067));
});

test('call: strict schema, low effort, key in the header, cost from OpenAI\'s own usage', async () => {
  const calls = mockFetch(200, completion({content: '{"ok":true}'}));
  const call = await callOpenAI([{role: 'system', content: 'ตอบเป็น JSON'}, {role: 'user', content: [{type: 'text', text: 'แอด'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA==', detail: 'low'}}]}], 4000, format);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.max_completion_tokens, 4000);
  assert.equal(body.max_tokens, undefined, 'the older name');
  assert.equal(body.reasoning_effort, 'low');
  assert.deepEqual(body.response_format, {type: 'json_schema', json_schema: {name: 'shape', strict: true, schema: format.schema}});
  assert.deepEqual(body.messages[1].content[1], {type: 'image_url', image_url: {url: 'data:image/png;base64,AA==', detail: 'low'}});
  assert.deepEqual(call.result, {ok: true});
  assert.equal(call.input, 1000);
  assert.equal(call.output, 500);
  // 200 cached + 800 uncached + 500 output (thinking included): 0.000002 + 0.00008 + 0.00025.
  assert.ok(near(call.usd, 0.000332), String(call.usd));
});

test('without a format the call asks for JSON mode; without the cache split every prompt token is uncached', async () => {
  const calls = mockFetch(200, completion({content: '{}'}, {prompt_tokens: 1000, completion_tokens: 0}));
  const call = await callOpenAI([{role: 'user', content: 'json'}], 100);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).response_format, {type: 'json_object'});
  assert.ok(near(call.usd, 0.0001), String(call.usd));
});

test('provider errors become messages the team can act on', async () => {
  const cases: [number, object, number, RegExp][] = [
    [429, {error: {code: 'insufficient_quota', type: 'insufficient_quota'}}, 402, /เครดิต.*หมด/],
    [429, {error: {code: 'rate_limit_exceeded'}}, 429, /จำกัดจำนวนครั้ง/],
    [401, {error: {code: 'invalid_api_key'}}, 503, /OPENAI_API_KEY ไม่ถูกต้อง/],
    [500, {error: {}}, 503, /ขัดข้อง/], [503, {error: {}}, 503, /ขัดข้อง/],
    [400, {error: {code: 'invalid_request_error'}}, 502, /ตอบกลับผิดพลาด/], [404, {error: {code: 'model_not_found'}}, 502, /ตอบกลับผิดพลาด/],
  ];
  const errors = console.error;
  console.error = () => {};
  try {
    for (const [status, body, expected, words] of cases) {
      mockFetch(status, body);
      await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100, format), aiError(expected, words), `HTTP ${status}`);
    }
  } finally { console.error = errors; }
});

test('a refusal, an empty, cut-off or non-JSON reply is refused', async () => {
  mockFetch(200, completion({content: null, refusal: 'I cannot help with that.'}));
  await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100, format), aiError(422, /ไม่ตอบ/));
  mockFetch(200, completion({content: ''}));
  await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100, format), aiError(502, /ว่าง/));
  mockFetch(200, completion({content: '{"ok":'}, undefined, 'length'));
  await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100, format), aiError(502, /ยาวเกินกำหนด/));
  mockFetch(200, completion({content: 'not json'}));
  await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100, format), aiError(502, /อ่านผล/));
});

test('no key or no network: refused before or at the call', async () => {
  const calls = mockFetch(200, completion({content: '{}'}));
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100), aiError(503, /OPENAI_API_KEY/));
    assert.equal(calls.length, 0, 'nothing sent without a key');
  } finally { process.env.OPENAI_API_KEY = 'test-key'; }
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  await assert.rejects(callOpenAI([{role: 'user', content: 'json'}], 100), aiError(502, /ติดต่อ OpenAI ไม่ได้/));
});

test('a model without a known price is refused, and an unknown effort falls back to low', async () => {
  process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  process.env.OPENAI_REASONING_EFFORT = 'max';
  try {
    // A query string loads a second copy of the module, which reads the environment afresh.
    const fresh = '../lib/ai/openai.ts?unknown-model';
    const other = await import(fresh) as typeof import('../lib/ai/openai.ts');
    const calls = mockFetch(200, completion({content: '{}'}));
    assert.throws(() => other.modelConfig(), (error: unknown) => error instanceof AiError && error.status === 503 && /OPENAI_MODEL/.test(error.message));
    await assert.rejects(other.callOpenAI([{role: 'user', content: 'json'}], 100), /OPENAI_MODEL/);
    assert.equal(calls.length, 0);
  } finally { process.env.OPENAI_MODEL = 'gpt-6-luna'; }
  try {
    const fresh = '../lib/ai/openai.ts?effort';
    const other = await import(fresh) as typeof import('../lib/ai/openai.ts');
    const calls = mockFetch(200, completion({content: '{}'}));
    await other.callOpenAI([{role: 'user', content: 'json'}], 100);
    assert.equal(JSON.parse(String(calls[0].init.body)).reasoning_effort, 'low');
  } finally { delete process.env.OPENAI_REASONING_EFFORT; }
});
