import 'server-only';
import {createHash} from 'node:crypto';
import {dbUser} from '../db/user.ts';
import {getAdDetail} from '../read/queries.ts';
import {signArchivedPreviews} from '../media/presentation.ts';
import {resolveMedia} from '../media/resolve.ts';
import {cachedOwnedImage} from '../owned-ads/media-cache.ts';
import {summarizeOwnedReport} from '../owned-ads/model.ts';
import type {CompanyAd} from '../owned-ads/source-rows.ts';
import type {Media} from '../media.ts';
import {AI_DIMS, type AdReading, type AdRef, type AiRun, type AiEstimate, type SetReading, adRefId} from './compare-shared.ts';
export {parseAdRefs} from './compare-shared.ts';

// ponytail: one model for every call; set OPENAI_MODEL to change it (cached rows are per model).
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
/** USD per 1M tokens [input, output]. Unknown models are priced as gpt-4.1-mini. */
const PRICES: Record<string, [number, number]> = {
  'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4], 'gpt-4o-mini': [0.15, 0.6], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4],
};
const price = PRICES[MODEL] ?? PRICES['gpt-4.1-mini'];
// Measured order of magnitude for one ad (copy + low-detail image) and one set summary; shown before running.
const EST_AD = (2500 * price[0] + 700 * price[1]) / 1e6;
const EST_SET = (4000 * price[0] + 900 * price[1]) / 1e6;
const DAILY_CAP = Number(process.env.AI_DAILY_USD) || 1;
const TOTAL_CAP = Number(process.env.AI_TOTAL_USD) || 4.5;
const VERSION = 'v1';
const SET_VERSION = 'v2'; // bump when SET_PROMPT changes

export class AiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

type Loaded = {ref: AdRef; side: string; label: string; format: string; text: string; image: string | null; facts: string};

async function loadAds(refs: AdRef[]): Promise<Loaded[]> {
  const db = await dbUser();
  const own = refs.filter(ref => ref.kind === 'own');
  let rows: CompanyAd[] = [];
  if (own.length) {
    const snapshot = await db.from('owned_library_syncs').select('id').eq('status', 'completed').order('finished_at', {ascending: false}).limit(1).single();
    if (snapshot.error) throw new AiError('เปิดข้อมูลแอดของเราไม่สำเร็จ', 503);
    const found = await db.from('owned_library_ads').select('data').eq('sync_id', snapshot.data.id).in('ad_id', own.map(ref => ref.ad));
    if (found.error) throw new AiError('เปิดข้อมูลแอดของเราไม่สำเร็จ', 503);
    rows = (found.data ?? []).map(row => row.data as CompanyAd);
  }
  return Promise.all(refs.map(async (ref): Promise<Loaded> => {
    if (ref.kind === 'own') {
      const ad = rows.find(row => row.account_id === ref.account && row.ad_id === ref.ad);
      if (!ad) throw new AiError('ไม่พบแอดของเราที่เลือกในข้อมูลล่าสุด', 404);
      const roas = summarizeOwnedReport([ad]).roas.value;
      return {
        ref, side: 'แอดของเรา', label: ad.ad_name, format: ad.video_id ? 'วิดีโอ' : 'ภาพ',
        text: [ad.title, ad.body_text].filter(Boolean).join('\n'), image: cachedOwnedImage(ad) ?? null,
        facts: `ค่าแอด ${ad.spend ?? '—'} ${ad.currency} · ROAS ${roas == null ? '—' : roas.toFixed(2)} · บทสนทนา ${ad.conversations ?? '—'}`,
      };
    }
    const detail = await getAdDetail(ref.ad, ref.dataset);
    if (!detail) throw new AiError('ไม่พบแอดคู่แข่งที่เลือก', 404);
    const signed = await signArchivedPreviews([detail]);
    const media = resolveMedia(detail.display_format, detail.media as Media, {archivePath: detail.archive_path, archiveStatus: detail.archive_status, presentationUrl: detail.archive_path ? signed.get(detail.archive_path) ?? null : null});
    return {
      ref, side: 'คู่แข่ง', label: detail.page_name ?? detail.page_id, format: detail.display_format ?? 'ไม่ระบุ',
      text: [detail.title, detail.body_text, detail.link_description, detail.cta_text && `ปุ่ม: ${detail.cta_text}`].filter(Boolean).join('\n'),
      image: 'src' in media ? media.src : null,
      facts: `${detail.is_active ? 'กำลังแสดง' : detail.is_active === false ? 'ไม่แสดงแล้ว' : 'ไม่ทราบสถานะ'} · ยิงมา ${detail.ad_age_days} วัน · ไม่มีข้อมูลงบหรือยอดขายของคู่แข่ง`,
    };
  }));
}

const supabaseHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname; } catch { return ''; } })();
/** Fetch the still ourselves (allowlisted hosts only) so OpenAI never needs to reach a signed or expiring URL. */
async function imageData(url: string | null): Promise<string | null> {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;
  if (parsed.protocol !== 'https:' || !(host.endsWith('.fbcdn.net') || host.endsWith('.facebook.com') || (supabaseHost && host === supabaseHost))) return null;
  try {
    const response = await fetch(parsed, {signal: AbortSignal.timeout(8000), redirect: 'error'});
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 4_000_000 ? null : `data:${type};base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

type Message = {role: 'system' | 'user'; content: string | ({type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string; detail: 'low'}})[]};
async function callOpenAI<T>(messages: Message[], name: string, schema: object, maxTokens: number): Promise<{result: T; input: number; output: number; usd: number}> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError('ยังไม่ได้ตั้งค่า OPENAI_API_KEY ใน .env.local', 503);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: MODEL, messages, max_completion_tokens: maxTokens, response_format: {type: 'json_schema', json_schema: {name, strict: true, schema}}}),
    });
  } catch { throw new AiError('ติดต่อ OpenAI ไม่ได้ ลองใหม่อีกครั้ง', 502); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code;
    if (code === 'insufficient_quota') throw new AiError('เครดิต OpenAI หมด', 402);
    if (response.status === 401) throw new AiError('OPENAI_API_KEY ไม่ถูกต้อง', 503);
    if (response.status === 429) throw new AiError('OpenAI จำกัดจำนวนครั้ง รอสักครู่แล้วลองใหม่', 429);
    console.error('OpenAI error', response.status, code);
    throw new AiError('OpenAI ตอบกลับผิดพลาด', 502);
  }
  const input = Number(data?.usage?.prompt_tokens) || 0, output = Number(data?.usage?.completion_tokens) || 0;
  let result: T;
  try { result = JSON.parse(data.choices[0].message.content); } catch { throw new AiError('อ่านผลจาก OpenAI ไม่ได้', 502); }
  return {result, input, output, usd: (input * price[0] + output * price[1]) / 1e6};
}

const cell = {type: 'object', additionalProperties: false, required: ['value', 'source', 'quote'], properties: {
  value: {type: 'string'}, source: {type: 'string', enum: ['ข้อความ', 'ภาพ', 'ภาพ + ข้อความ', 'ไม่พบ']}, quote: {type: 'string'},
}};
const AD_SCHEMA = {type: 'object', additionalProperties: false, required: [...AI_DIMS, 'claims'], properties: {
  ...Object.fromEntries(AI_DIMS.map(dim => [dim, cell])),
  claims: {type: 'object', additionalProperties: false, required: ['items', 'quote'], properties: {
    items: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['text', 'risky'], properties: {text: {type: 'string'}, risky: {type: 'boolean'}}}},
    quote: {type: 'string'},
  }},
}};
const refList = {type: 'array', items: {type: 'integer'}};
const SET_SCHEMA = {type: 'object', additionalProperties: false, required: ['diffs', 'ideas'], properties: {
  diffs: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['text', 'ads'], properties: {text: {type: 'string'}, ads: refList}}},
  ideas: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['text', 'ads'], properties: {text: {type: 'string'}, ads: refList}}},
}};

const AD_PROMPT = `คุณช่วยทีมการตลาดไทยอ่านโฆษณา Facebook ทีละตัว ตอบภาษาไทย สั้น ไม่เกิน 120 ตัวอักษรต่อช่อง
ใช้เฉพาะสิ่งที่อยู่ในข้อความหรือภาพของแอดนี้ ห้ามเดา ถ้าไม่พบให้ value="ไม่พบในแอด" source="ไม่พบ" quote=""
quote ต้องคัดลอกคำจริงจากข้อความหรือคำบนภาพ ไม่เกิน 80 ตัวอักษร
pain = ปัญหาหรือความต้องการของลูกค้าที่แอดพูดถึง
angle = มุมขายหลัก เช่น ราคา ผลลัพธ์ ความน่าเชื่อถือ คนดัง ความเร่งด่วน
hook = คำเปิดหรือสิ่งแรกที่ดึงความสนใจ (บรรทัดแรก หรือข้อความใหญ่บนภาพ)
offer = ราคา จำนวน ของแถม ส่งฟรี เงื่อนไข คงตัวเลขตามจริง
proof = หลักฐานความน่าเชื่อ เช่น รีวิว ผลทดสอบ เลข อย. ผู้เชี่ยวชาญ ส่วนผสม
format = รูปแบบครีเอทีฟ (ภาพนิ่ง วิดีโอ หลายภาพ) และลักษณะที่เห็น
claims = คำอ้างเรื่องสุขภาพหรือผลลัพธ์ทั้งหมด risky=true ถ้าเสี่ยงผิดเกณฑ์โฆษณา อย. เช่น รักษา หายขาด ถาวร ลดน้ำหนักเป็นตัวเลข อ้างแพทย์
ห้ามคาดเดายอดขาย งบ หรือผลลัพธ์ของแอด`;

const SET_PROMPT = `คุณช่วยทีมการตลาดไทยสรุปการเทียบโฆษณา ตอบภาษาไทย ประโยคละไม่เกิน 160 ตัวอักษร
ข้อมูลคือผลอ่านแอดแต่ละตัว (index เริ่มที่ 0) แอดของเรามีตัวเลขผลลัพธ์ แอดคู่แข่งไม่มีงบหรือยอดขาย ห้ามอ้างว่าคู่แข่งขายดีกว่าหรือได้ผลกว่า
diffs = จุดที่แอดเรากับคู่แข่งต่างกันจริง 2–4 ข้อ (ข้อเสนอ มุมขาย คำเปิด หลักฐาน รูปแบบ)
ideas = ไอเดียทดลองสำหรับแอดฝั่ง "แอดของเรา" เท่านั้น 2–4 ข้อ (เราแก้แอดคู่แข่งไม่ได้) เขียนเป็นสิ่งที่ทีมทำกับแอดเราได้เลย เช่น เปลี่ยนคำเปิด ใส่ราคา เพิ่มหลักฐาน แล้ววัดผลด้วยตัวเลขของเรา ห้ามแนะนำคำอ้างที่เสี่ยงผิดเกณฑ์ อย.
ads = index ของแอดที่เป็นหลักฐานของข้อนั้น`;

const sha = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const adKey = (ad: Loaded) => `ad:${VERSION}:${MODEL}:${adRefId(ad.ref)}:${sha(ad.text)}`;

async function spent(db: Awaited<ReturnType<typeof dbUser>>) {
  // ponytail: sums every row in JS; fine for thousands of calls, move to SQL if the table grows large.
  const {data, error} = await db.from('ai_analyses').select('usd,created_at');
  if (error) throw new AiError('อ่านค่าใช้จ่าย AI ไม่สำเร็จ', 503);
  const dayStart = new Date(Date.now() + 7 * 3600e3); dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.getTime() - 7 * 3600e3; // Bangkok midnight
  let total = 0, today = 0;
  for (const row of data ?? []) { const usd = Number(row.usd); total += usd; if (Date.parse(row.created_at) >= since) today += usd; }
  return {today, total, dailyCap: DAILY_CAP, totalCap: TOTAL_CAP};
}

/** dryRun: what is cached, what a run would cost, and what has been spent. Never calls OpenAI. */
export async function runComparison(refs: AdRef[], dryRun: boolean): Promise<AiEstimate | AiRun> {
  const db = await dbUser();
  const ads = await loadAds(refs);
  const keys = ads.map(adKey);
  const setKey = `set:${SET_VERSION}:${MODEL}:${sha(keys.join('|'))}`;
  const cached = await db.from('ai_analyses').select('key,result').in('key', [...keys, setKey]);
  if (cached.error) throw new AiError('อ่านผลวิเคราะห์เดิมไม่สำเร็จ', 503);
  const hit = new Map((cached.data ?? []).map(row => [row.key as string, row.result]));
  const missing = ads.filter((_, index) => !hit.has(keys[index]));
  const estimate = missing.length * EST_AD + (hit.has(setKey) ? 0 : EST_SET);
  const budget = await spent(db);
  if (dryRun) return {model: MODEL, cached: ads.length - missing.length, missing: missing.length, setCached: hit.has(setKey), estimate, spent: budget};
  if (estimate > 0 && (budget.today + estimate > DAILY_CAP || budget.total + estimate > TOTAL_CAP))
    throw new AiError(`เกินเพดานค่าใช้จ่าย AI (วันนี้ ${budget.today.toFixed(3)}/${DAILY_CAP} USD · รวม ${budget.total.toFixed(3)}/${TOTAL_CAP} USD)`, 429);

  let cost = 0;
  const save = async (key: string, kind: 'ad' | 'set', call: {result: unknown; input: number; output: number; usd: number}) => {
    cost += call.usd;
    const {error} = await db.from('ai_analyses').upsert({key, kind, model: MODEL, result: call.result, input_tokens: call.input, output_tokens: call.output, usd: call.usd.toFixed(6)});
    if (error) console.error('AI analysis not cached', error.message);
  };
  await Promise.all(ads.map(async (ad, index) => {
    if (hit.has(keys[index])) return;
    const image = await imageData(ad.image);
    const content: Exclude<Message['content'], string> = [{type: 'text', text: `ฝั่ง: ${ad.side}\nชื่อ: ${ad.label}\nรูปแบบ: ${ad.format}\n${image ? '' : 'ไม่มีภาพประกอบ อ่านจากข้อความเท่านั้น\n'}ข้อความในแอด:\n${ad.text.slice(0, 4000) || '(ไม่มีข้อความ)'}`}];
    if (image) content.push({type: 'image_url', image_url: {url: image, detail: 'low'}});
    const call = await callOpenAI<AdReading>([{role: 'system', content: AD_PROMPT}, {role: 'user', content}], 'ad_reading', AD_SCHEMA, 900);
    hit.set(keys[index], call.result);
    await save(keys[index], 'ad', call);
  }));
  if (!hit.has(setKey)) {
    const input = ads.map((ad, index) => ({index, side: ad.side, name: ad.label, facts: ad.facts, reading: hit.get(keys[index])}));
    const call = await callOpenAI<SetReading>([{role: 'system', content: SET_PROMPT}, {role: 'user', content: JSON.stringify(input)}], 'set_reading', SET_SCHEMA, 1200);
    hit.set(setKey, call.result);
    await save(setKey, 'set', call);
  }
  return {
    model: MODEL, cost, spent: {...budget, today: budget.today + cost, total: budget.total + cost},
    ads: Object.fromEntries(ads.map((ad, index) => [adRefId(ad.ref), hit.get(keys[index]) as AdReading])),
    summary: hit.get(setKey) as SetReading,
  };
}

/** What AI calls have cost (as recorded per call), for the usage bars. */
export async function aiUsage() {
  return {...await spent(await dbUser()), model: MODEL, creditUsd: Number(process.env.OPENAI_CREDIT_USD) || 5};
}
