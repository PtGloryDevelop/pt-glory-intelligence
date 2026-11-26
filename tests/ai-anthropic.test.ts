import assert from 'node:assert/strict';
import test from 'node:test';

// MODEL and the key are read from the environment; set them before the module loads. fetch is mocked
// in every test, so no suite ever reaches Anthropic.
process.env.ANTHROPIC_MODEL = 'claude-opus-5-5';
process.env.ANTHROPIC_API_KEY = 'test-key';
delete process.env.ANTHROPIC_EFFORT;
const {callClaude, attemptUsd, estimateUsd, PRICED_MODELS} = await import('../lib/ai/anthropic.ts');
const {AiError} = await import('../lib/ai/call.ts');
type Message = import('../lib/ai/call.ts').Message;

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

/** Answers every request the SDK makes (it retries some failures once) with the same reply. */
function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: {url: string; headers: Headers; body: Record<string, unknown>}[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}'))});
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'request-id': 'req_test', ...headers}});
  }) as typeof fetch;
  return calls;
}
const usage = {input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0};
const reply = (text: string, extra: object = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{type: 'thinking', thinking: '', signature: 'sig'}, {type: 'text', text}],
  stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage, ...extra,
});
const apiError = (type: string, message = 'x') => ({type: 'error', error: {type, message}});
const near = (value: number, expected: number) => Math.abs(value - expected) < 1e-12;
const aiError = (status: number, words: RegExp) => (error: unknown) => error instanceof AiError && error.status === status && words.test(error.message);
const format = {name: 'shape', schema: {type: 'object', properties: {ok: {type: 'boolean'}}, required: ['ok'], additionalProperties: false}};
const ask: Message[] = [{role: 'system', content: 'ตอบตามรูปแบบ'}, {role: 'user', content: [
  {type: 'text', text: 'แอด'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA==', detail: 'low'}},
]}];

test('cost: each model at its own rates, cache reads and writes apart', () => {
  const million = {input_tokens: 1e6, output_tokens: 1e6};
  assert.ok(near(attemptUsd('claude-opus-5-5', million), 24));
  assert.ok(near(attemptUsd('claude-sonnet-5-5', million), 12));
  assert.ok(near(attemptUsd('claude-haiku-5-5', {input_tokens: 50_000, output_tokens: 1e6}), 0.005 + 0.5));
  assert.ok(near(attemptUsd('claude-opus-5-5', {input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6}), 0.2 + 5));
  // The estimate shown before a run: the callers' 3200 in + 700 out, times what Claude was measured to
  // take above them. One ad on Claude Opus 5.5 averaged 0.058 USD in the evaluation; this says 0.070.
  assert.ok(near(estimateUsd(3200, 700), 2.6 * (3200 * 4 + 700 * 20) / 1e6));
  assert.ok(estimateUsd(3200, 700) >= 0.058);
  assert.deepEqual(PRICED_MODELS, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
});

test('cost: Haiku over 100,000 prompt tokens pays its higher tier; cached tokens count toward the length', () => {
  assert.ok(near(attemptUsd('claude-haiku-5-5', {input_tokens: 100_000, output_tokens: 1000}), (100_000 * 0.1 + 1000 * 0.5) / 1e6), 'at the line: the lower tier');
  assert.ok(near(attemptUsd('claude-haiku-5-5', {input_tokens: 60_000, output_tokens: 1000, cache_read_input_tokens: 50_000}), (50_000 * 0.05 + 60_000 * 0.5 + 1000 * 2.5) / 1e6));
});

test('cost: a fallback model is priced at its own rates, and a model outside the table never lower than the dearest', () => {
  assert.ok(near(attemptUsd('claude-opus-4-8', {input_tokens: 1e6, output_tokens: 1e6}), 30));
  assert.ok(near(attemptUsd('claude-sonnet-5', {input_tokens: 1e6, output_tokens: 1e6}), 12));
  const logged: unknown[][] = [];
  const realError = console.error; console.error = (...args: unknown[]) => { logged.push(args); };
  try { assert.ok(near(attemptUsd('claude-next', {input_tokens: 1e6, output_tokens: 1e6}), 30)); } finally { console.error = realError; }
  assert.equal(logged.length, 1, 'said in the server log');
});

test('call: schema, low effort, the fallback opted in, the key in a header, cost from Claude\'s own usage', async () => {
  const calls = mockFetch(200, reply('{"ok":true}'));
  const call = await callClaude(ask, 4000, format);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin + new URL(calls[0].url).pathname, 'https://api.anthropic.com/v1/messages');
  // Which header carries the key is the SDK's choice; it must be a header, never the address or the body.
  assert.match(calls[0].headers.get('x-api-key') ?? calls[0].headers.get('authorization') ?? '', /test-key$/);
  assert.ok(!calls[0].url.includes('test-key') && !JSON.stringify(calls[0].body).includes('test-key'));
  assert.match(calls[0].headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  const body = calls[0].body;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 8000, 'the reply ceiling plus room for thinking');
  assert.equal(body.system, 'ตอบตามรูปแบบ', 'the system prompt is its own field, not a message');
  assert.deepEqual(body.messages, [{role: 'user', content: [
    {type: 'text', text: 'แอด'}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'AA=='}},
  ]}]);
  assert.deepEqual(body.output_config, {effort: 'low', format: {type: 'json_schema', schema: format.schema}});
  assert.deepEqual(body.fallbacks, [{model: 'claude-opus-4-8'}]);
  assert.equal(body.thinking, undefined, 'thinking is left to the model: Claude Opus 5.5 refuses any other setting');
  assert.equal(body.temperature, undefined);
  assert.equal(body.betas, undefined, 'the beta goes in the header');
  assert.deepEqual(call.result, {ok: true});
  assert.equal(call.input, 1000);
  assert.equal(call.output, 500);
  assert.ok(near(call.usd, (1000 * 4 + 500 * 20) / 1e6));
});

test('call: a talk keeps its turns in order, and the earlier answer goes back as the assistant\'s', async () => {
  const calls = mockFetch(200, reply('{"ok":true}'));
  await callClaude([
    {role: 'system', content: 'กติกา'}, {role: 'user', content: 'ข้อมูลของรอบนี้'}, {role: 'assistant', content: '{"answer":"รับทราบ","ads":[]}'}, {role: 'user', content: 'ควรแก้อะไรก่อน'},
  ], 1500, format);
  assert.deepEqual(calls[0].body.messages, [
    {role: 'user', content: 'ข้อมูลของรอบนี้'}, {role: 'assistant', content: '{"answer":"รับทราบ","ads":[]}'}, {role: 'user', content: 'ควรแก้อะไรก่อน'},
  ]);
  assert.equal(calls[0].body.max_tokens, 5500);
});

test('call: the prompt counted is the whole prompt, cached parts included', async () => {
  mockFetch(200, reply('{"ok":true}', {usage: {input_tokens: 400, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 100}}));
  const call = await callClaude(ask, 4000, format);
  assert.equal(call.input, 1000);
  assert.ok(near(call.usd, (500 * 0.2 + 100 * 5 + 400 * 4 + 100 * 20) / 1e6));
});

test('call: when the fallback answers, the cost is every attempt at the rates of the model that ran it', async () => {
  const realInfo = console.info; console.info = () => {};
  try {
    mockFetch(200, reply('{"ok":true}', {
      model: 'claude-opus-4-8',
      content: [{type: 'fallback', from: {model: 'claude-opus-5-5'}, to: {model: 'claude-opus-4-8'}, trigger: {type: 'refusal', category: 'bio'}}, {type: 'text', text: '{"ok":true}'}],
      usage: {input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: [
        {type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null},
        {type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null},
      ]},
    }));
    const call = await callClaude(ask, 4000, format);
    assert.deepEqual(call.result, {ok: true});
    assert.ok(near(call.usd, (1000 * 4) / 1e6 + (900 * 5 + 300 * 25) / 1e6), 'the declined attempt is counted too: the record may overstate, never understate');
    assert.equal(call.input, 900, 'the tokens kept are the answering attempt\'s');
  } finally { console.info = realInfo; }
});

test('call: a refusal, a cut-off reply, an empty reply and broken JSON are errors, never a reading', async () => {
  const realError = console.error; console.error = () => {};
  try {
    mockFetch(200, reply('', {content: [], stop_reason: 'refusal', stop_details: {type: 'refusal', category: 'general_harms', explanation: 'x'}}));
    await assert.rejects(callClaude(ask, 4000, format), aiError(422, /ไม่ตอบคำขอนี้/));
    mockFetch(200, reply('{"ok":tr', {stop_reason: 'max_tokens'}));
    await assert.rejects(callClaude(ask, 4000, format), aiError(502, /ยาวเกินกำหนด/));
    mockFetch(200, reply('  '));
    await assert.rejects(callClaude(ask, 4000, format), aiError(502, /ตอบกลับว่าง/));
    mockFetch(200, reply('ได้เลย {"ok":true}'));
    await assert.rejects(callClaude(ask, 4000, format), aiError(502, /อ่านผลจาก Claude ไม่ได้/));
  } finally { console.error = realError; }
});

test('call: Anthropic\'s errors become the words the team sees, without the key or the reply', async () => {
  const realError = console.error; console.error = () => {};
  try {
    mockFetch(401, apiError('authentication_error'));
    await assert.rejects(callClaude(ask, 4000, format), aiError(503, /ANTHROPIC_API_KEY ไม่ถูกต้อง/));
    mockFetch(403, apiError('permission_error'));
    await assert.rejects(callClaude(ask, 4000, format), aiError(503, /ไม่มีสิทธิ์ใช้โมเดล/));
    mockFetch(402, apiError('billing_error'));
    await assert.rejects(callClaude(ask, 4000, format), aiError(402, /เครดิตในบัญชี Claude หมด/));
    mockFetch(400, apiError('invalid_request_error', 'messages: bad'));
    await assert.rejects(callClaude(ask, 4000, format), aiError(502, /^Claude ตอบกลับผิดพลาด$/));
    // The SDK tries these once more before giving up; retry-after 0 keeps the test quick.
    const limited = mockFetch(429, apiError('rate_limit_error'), {'retry-after': '0'});
    await assert.rejects(callClaude(ask, 4000, format), aiError(429, /จำกัดจำนวนครั้ง/));
    assert.equal(limited.length, 2, 'one retry');
    mockFetch(529, apiError('overloaded_error'), {'retry-after': '0'});
    await assert.rejects(callClaude(ask, 4000, format), aiError(503, /ขัดข้องชั่วคราว/));
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await assert.rejects(callClaude(ask, 4000, format), aiError(502, /ติดต่อ Claude ไม่ได้/));
  } finally { console.error = realError; }
});

test('call: nothing is sent without a reply format, or with a picture Claude cannot be handed', async () => {
  const calls = mockFetch(200, reply('{"ok":true}'));
  await assert.rejects(callClaude(ask, 4000), aiError(500, /รูปแบบคำตอบ/));
  await assert.rejects(callClaude([{role: 'user', content: [{type: 'image_url', image_url: {url: 'https://example.com/a.png', detail: 'low'}}]}], 4000, format), aiError(502, /Claude อ่านไม่ได้/));
  await assert.rejects(callClaude([{role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/avif;base64,AA==', detail: 'low'}}]}], 4000, format), aiError(502, /Claude อ่านไม่ได้/));
  assert.equal(calls.length, 0);
});

test('Claude Haiku 5.5 has no server-side fallback: none is asked for; a model outside the table is refused; no key, no call', async () => {
  const saved = {model: process.env.ANTHROPIC_MODEL, key: process.env.ANTHROPIC_API_KEY, effort: process.env.ANTHROPIC_EFFORT};
  try {
    process.env.ANTHROPIC_MODEL = 'claude-haiku-5-5'; process.env.ANTHROPIC_EFFORT = 'medium';
    // A query string loads a fresh copy, which reads the environment again.
    const haikuPath = '../lib/ai/anthropic.ts?haiku';
    const haiku = await import(haikuPath) as typeof import('../lib/ai/anthropic.ts');
    const calls = mockFetch(200, reply('{"ok":true}', {model: 'claude-haiku-5-5'}));
    const call = await haiku.callClaude(ask, 4000, format);
    assert.equal(calls[0].body.model, 'claude-haiku-5-5');
    assert.equal(calls[0].body.fallbacks, undefined);
    assert.equal(calls[0].headers.get('anthropic-beta'), null);
    assert.deepEqual(calls[0].body.output_config, {effort: 'medium', format: {type: 'json_schema', schema: format.schema}}, 'ANTHROPIC_EFFORT raises the effort');
    assert.ok(near(call.usd, (1000 * 0.1 + 500 * 0.5) / 1e6));

    process.env.ANTHROPIC_MODEL = 'claude-3-opus'; process.env.ANTHROPIC_EFFORT = 'extreme';
    const unknownPath = '../lib/ai/anthropic.ts?unknown';
    const unknown = await import(unknownPath) as typeof import('../lib/ai/anthropic.ts');
    const none = mockFetch(200, reply('{"ok":true}'));
    await assert.rejects(unknown.callClaude(ask, 4000, format), aiError(503, /ไม่รู้จักโมเดล claude-3-opus/));
    assert.throws(() => unknown.estimateUsd(1, 1), aiError(503, /ไม่รู้จักโมเดล/), 'nor priced by guess');

    process.env.ANTHROPIC_MODEL = 'claude-opus-5-5'; delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(callClaude(ask, 4000, format), aiError(503, /ANTHROPIC_API_KEY/));
    assert.equal(none.length, 0);
  } finally {
    for (const [name, value] of [['ANTHROPIC_MODEL', saved.model], ['ANTHROPIC_API_KEY', saved.key], ['ANTHROPIC_EFFORT', saved.effort]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
