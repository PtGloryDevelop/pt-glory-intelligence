import assert from 'node:assert/strict';
import test from 'node:test';
import {ADS_DIMS, AI_DIMS, SCORE_DIMS, readAdReading, readAdsReading, readSetReading} from '../lib/ai/compare-shared.ts';
import {readAnswer, readNoteDraft} from '../lib/ai/rounds-shared.ts';
import {ADS_FORMAT, AD_FORMAT, ANSWER_FORMAT, NOTE_FORMAT, SET_FORMAT} from '../lib/ai/formats.ts';
import type {JsonSchema} from '../lib/ai/call.ts';

type Node = {type?: string | string[]; properties?: Record<string, Node>; required?: string[]; additionalProperties?: boolean; items?: Node; enum?: string[]};

/** Strict mode: every object closed, every key required. */
function assertStrict(schema: Node, path: string) {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${path} must be closed`);
    assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort(), `${path} must require every key`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) assertStrict(child, `${path}.${key}`);
  }
  if (schema.type === 'array') assertStrict(schema.items!, `${path}[]`);
}

/** Does `value` fit `schema`? A small subset of JSON Schema: the parts formats.ts uses. */
function fits(schema: Node, value: unknown): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (!types.includes(kind) && !(kind === 'integer' && types.includes('number'))) return false;
  if (schema.enum && !schema.enum.includes(value as string)) return false;
  if (kind === 'array') return (value as unknown[]).every(item => fits(schema.items!, item));
  if (kind === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).every(key => key in (schema.properties ?? {}))
      && (schema.required ?? []).every(key => key in record && fits(schema.properties![key], record[key]));
  }
  return true;
}

const cell = {value: 'อ่านได้', source: 'ข้อความ', quote: 'ดื่มง่าย ไม่ขม'};
const adReply = {
  ...Object.fromEntries(AI_DIMS.map(dim => [dim, cell])),
  claims: {items: [{text: 'ช่วยดูแลหลอดเลือด', risky: true}], quote: 'ดูแลหลอดเลือด'},
  scores: Object.fromEntries(SCORE_DIMS.map((dim, index) => [dim, {score: index === 5 ? null : 6, why: 'เหตุผล'}])),
  fix: 'ใส่ราคาในบรรทัดแรก',
};
const adsReply = Object.fromEntries(ADS_DIMS.map(dim => [dim, cell]));
const setReply = {diffs: [{text: 'พาดหัว: ต่างกัน', ads: [0, 1]}], ideas: [{text: 'ลองใส่ราคา', ads: [0]}], hooks: [{text: 'พาดหัวใหม่', why: 'ลองมุมราคา'}]};

test('every reply format is strict: closed objects, every key required', () => {
  for (const format of [AD_FORMAT, ADS_FORMAT, SET_FORMAT, ANSWER_FORMAT, NOTE_FORMAT]) {
    assert.match(format.name, /^[a-z_]{1,64}$/, 'a name OpenAI accepts');
    assert.equal((format.schema as Node).type, 'object', 'the root must be an object');
    assertStrict(format.schema as Node, format.name);
  }
});

test('a reply that fits each schema is also one its reader keeps, so the schema never forces a refusal', () => {
  const pairs: [JsonSchema, unknown, (raw: unknown) => unknown][] = [
    [AD_FORMAT.schema, adReply, readAdReading],
    [ADS_FORMAT.schema, adsReply, readAdsReading],
    [SET_FORMAT.schema, setReply, raw => readSetReading(raw, 2)],
    [ANSWER_FORMAT.schema, {answer: 'แอดของเรา (แอด 0) ยังไม่มีราคา', ads: [0]}, raw => readAnswer(raw, 2)],
    [NOTE_FORMAT.schema, {title: 'รอบนี้', seen: 'สิ่งที่เห็น', next: ['ลองใส่ราคา']}, readNoteDraft],
  ];
  for (const [schema, reply, read] of pairs) {
    assert.ok(fits(schema as Node, reply), JSON.stringify(reply).slice(0, 60));
    assert.ok(read(reply), `reader keeps ${JSON.stringify(reply).slice(0, 60)}`);
  }
});

test('the schemas keep what the readers refuse out: a source outside the list, a score that is not a whole number', () => {
  assert.equal(fits(AD_FORMAT.schema as Node, {...adReply, pain: {...cell, source: 'เดา'}}), false);
  assert.equal(fits(AD_FORMAT.schema as Node, {...adReply, scores: {...adReply.scores, hook: {score: 6.5, why: 'x'}}}), false);
  assert.equal(fits(SET_FORMAT.schema as Node, {...setReply, extra: []}), false, 'no extra keys');
  assert.equal(fits(ANSWER_FORMAT.schema as Node, {answer: 'x'}), false, 'ads is required');
});

test('OpenAI answers by default; AI_PROVIDER=deepseek switches every call, its model and its credit back', async () => {
  const saved = {provider: process.env.AI_PROVIDER, openai: process.env.OPENAI_MODEL, deepseek: process.env.DEEPSEEK_MODEL};
  delete process.env.OPENAI_MODEL; delete process.env.DEEPSEEK_MODEL;
  try {
    delete process.env.AI_PROVIDER;
    // A query string loads a fresh copy, which reads the environment again.
    const openaiPath = '../lib/ai/provider.ts?default';
    const openai = await import(openaiPath) as typeof import('../lib/ai/provider.ts');
    assert.equal(openai.PROVIDER, 'openai');
    assert.equal(openai.MODEL, 'gpt-6-luna');
    assert.deepEqual(openai.SPEND.models, ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-transcribe'], 'transcriptions spend the same credit');
    // The October gpt-4.1-mini rows were another account: neither its model nor its dates count.
    assert.equal(openai.SPEND.since, '2026-11-22T17:00:00.000Z');
    process.env.AI_PROVIDER = 'deepseek';
    const deepseekPath = '../lib/ai/provider.ts?deepseek';
    const deepseek = await import(deepseekPath) as typeof import('../lib/ai/provider.ts');
    assert.equal(deepseek.PROVIDER, 'deepseek');
    assert.equal(deepseek.MODEL, 'deepseek-flash');
    assert.deepEqual(deepseek.SPEND.models, ['deepseek-flash', 'deepseek-v4-pro']);
    assert.equal(deepseek.SPEND.since, null);
  } finally {
    for (const [key, value] of [['AI_PROVIDER', saved.provider], ['OPENAI_MODEL', saved.openai], ['DEEPSEEK_MODEL', saved.deepseek]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('AI_PROVIDER=anthropic hands the reading to Claude on its own credit; hearing clips stays on OpenAI\'s, counted apart', async () => {
  const names = ['AI_PROVIDER', 'ANTHROPIC_MODEL', 'ANTHROPIC_CREDIT_USD', 'OPENAI_MODEL', 'OPENAI_CREDIT_USD', 'OPENAI_API_KEY'] as const;
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    process.env.AI_PROVIDER = 'anthropic'; process.env.OPENAI_API_KEY = 'test-key';
    // A query string loads a fresh copy, which reads the environment again.
    const claudePath = '../lib/ai/provider.ts?claude';
    const claude = await import(claudePath) as typeof import('../lib/ai/provider.ts');
    assert.equal(claude.PROVIDER, 'anthropic');
    assert.equal(claude.PROVIDER_LABEL, 'Claude');
    assert.equal(claude.MODEL, 'claude-opus-5-5');
    assert.deepEqual(claude.SPEND, {models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], since: null, creditUsd: 200});
    // Claude takes pictures and text, not sound: the clip is still heard by gpt-transcribe, on OpenAI's money.
    assert.equal(claude.CAN_TRANSCRIBE, true);
    assert.deepEqual(claude.TRANSCRIBE_SPEND, {models: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-transcribe'], since: '2026-11-22T17:00:00.000Z', creditUsd: 5});
    assert.ok(!claude.SPEND.models.includes('gpt-transcribe'), 'a transcription never counts against Claude\'s caps');

    delete process.env.OPENAI_API_KEY;
    const deafPath = '../lib/ai/provider.ts?claude-without-openai';
    const deaf = await import(deafPath) as typeof import('../lib/ai/provider.ts');
    assert.equal(deaf.CAN_TRANSCRIBE, false, 'no OpenAI key: clips are read from their frames and shown as not heard');
    assert.equal(deaf.TRANSCRIBE_SPEND, null);

    delete process.env.AI_PROVIDER; process.env.OPENAI_API_KEY = 'test-key';
    const onePath = '../lib/ai/provider.ts?one-credit';
    const one = await import(onePath) as typeof import('../lib/ai/provider.ts');
    assert.equal(one.PROVIDER, 'openai', 'still the default: deploying the code changes nothing until AI_PROVIDER is set');
    assert.equal(one.TRANSCRIBE_SPEND, null, 'with OpenAI reading too it is all one credit');
  } finally {
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});
