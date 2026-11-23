import 'server-only';
import {createHash} from 'node:crypto';
import {dbUser} from '../db/user.ts';
import {getAdDetail} from '../read/queries.ts';
import {signArchivedPreviews} from '../media/presentation.ts';
import {resolveMedia} from '../media/resolve.ts';
import {cachedOwnedImage, ownedMediaCache, ownedMediaKey} from '../owned-ads/media-cache.ts';
import {metaReadConfigured, resolveWithToken} from '../owned-ads/meta-media.ts';
import {summarizeOwnedReport} from '../owned-ads/model.ts';
import type {CompanyAd} from '../owned-ads/source-rows.ts';
import type {Media} from '../media.ts';
import {ADS_DIMS, AI_DIMS, AI_SOURCES, SCORE_DIMS, readAdReading, readAdsReading, readSetReading, type AdReading, type AdRef, type AdsReading, type AdsRun, type AiRun, type AiEstimate, type SetReading, type TeamView, adRefId} from './compare-shared.ts';
import {AiError, CAN_TRANSCRIBE, MODEL, PROVIDER_LABEL, SPEND, TRANSCRIBE_MODEL, TRANSCRIBE_USD_PER_MINUTE, callModel, estimateUsd, modelConfig, transcribeAudio, type Message} from './provider.ts';
import type {ReplyFormat} from './call.ts';
import {ADS_FORMAT, AD_FORMAT, SET_FORMAT} from './formats.ts';
import {transcriptKey, transcriptionEstimateUsd, videoContext, videoMarker, videoParts, type Transcripts, type VideoRow} from './video-input.ts';
import {videoDownloader} from '../media/store-supabase.ts';
export {parseAdRefs} from './compare-shared.ts';
export {AiError} from './provider.ts';

// Tokens [input, output] for one ad (copy + low-detail image) and one set summary, measured on gpt-4.1-mini;
// an order of magnitude shown before running. What is recorded is the provider's own count.
const EST_AD = [3200, 700] as const, EST_SET = [2400, 500] as const;
// A clip adds up to eight low-detail frames and a transcript to the input (an order of magnitude, as above).
const EST_VIDEO_INPUT = 3200;
// A ceiling, not a target (output is billed as used): Thai can take more tokens here than it did on OpenAI.
const MAX_OUTPUT = 4000;
const DAILY_CAP = Number(process.env.AI_DAILY_USD) || 1;
const TOTAL_CAP = Number(process.env.AI_TOTAL_USD) || 4.5;
const VERSION = 'v6'; // bump when AD_PROMPT changes (v6: video clips read from frames and transcript, sources defined)
const SET_VERSION = 'v8'; // bump when SET_PROMPT changes (v8: DeepSeek JSON mode, shape in the prompt)

type Loaded = {ref: AdRef; side: string; label: string; format: string; text: string; image: string | null; facts: string; owned?: CompanyAd;
  /** The observation ad_detail chose, and its clip as the video reader left it (rival VIDEO ads only). */
  observationId: string | null; video: VideoRow | null;
  /** The ad team's view names the headline and the caption apart, so the model knows which is which. */
  headline: string | null; caption: string};

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
        text: [ad.title, ad.body_text].filter(Boolean).join('\n'), image: cachedOwnedImage(ad) ?? null, owned: ad, observationId: null, video: null,
        headline: ad.title ?? null, caption: ad.body_text ?? '',
        facts: `ค่าแอด ${ad.spend ?? '—'} ${ad.currency} · ROAS ${roas == null ? '—' : roas.toFixed(2)} · บทสนทนา ${ad.conversations ?? '—'}`,
      };
    }
    const detail = await getAdDetail(ref.ad, ref.dataset);
    if (!detail) throw new AiError('ไม่พบแอดคู่แข่งที่เลือก', 404);
    const signed = await signArchivedPreviews([detail]);
    const observationId = (detail as {ad_observation_id?: number | string | null}).ad_observation_id;
    // RLS lets any signed-in role read it; a failure only means the clip is not used.
    const reading = detail.display_format === 'VIDEO' && observationId != null
      ? await db.from('ad_video_readings').select('status, duration_ms, processed_ms, has_audio, frames, audio_path, audio_sha256, hook_audio_path, hook_audio_sha256')
        .eq('ad_observation_id', String(observationId)).maybeSingle()
      : null;
    const media = resolveMedia(detail.display_format, detail.media as Media, {archivePath: detail.archive_path, archiveStatus: detail.archive_status, presentationUrl: detail.archive_path ? signed.get(detail.archive_path) ?? null : null});
    return {
      ref, side: 'คู่แข่ง', label: detail.page_name ?? detail.page_id, format: detail.display_format ?? 'ไม่ระบุ',
      text: [detail.title, detail.body_text, detail.link_description, detail.cta_text && `ปุ่ม: ${detail.cta_text}`].filter(Boolean).join('\n'),
      image: 'src' in media ? media.src : null,
      headline: detail.title ?? null, caption: [detail.body_text, detail.link_description, detail.cta_text && `ปุ่ม: ${detail.cta_text}`].filter(Boolean).join('\n'),
      facts: `${detail.is_active ? 'กำลังแสดง' : detail.is_active === false ? 'ไม่แสดงแล้ว' : 'ไม่ทราบสถานะ'} · ยิงมา ${detail.ad_age_days} วัน · ไม่มีข้อมูลงบหรือยอดขายของคู่แข่ง`,
      observationId: observationId == null ? null : String(observationId),
      video: reading && !reading.error ? (reading.data as VideoRow | null) : null,
    };
  }));
}

/**
 * Our ad's picture for AI. The snapshot's link expires within days, and the page's own refresh may
 * have run in another server instance (its cache is per process), so ask Meta for a fresh link when
 * a read token is set. Called only for ads not read before, so cached readings cost no Meta call.
 */
async function ownedImage(row: CompanyAd): Promise<string | null> {
  const cached = ownedMediaCache.get(ownedMediaKey(row));
  if (cached && cached.until > Date.now() && cached.media.url) return cached.media.url;
  if (metaReadConfigured()) {
    const creative = (row as CompanyAd & {creative_id?: string | null}).creative_id ?? null;
    const [media] = await resolveWithToken([{account_id: row.account_id, ad_id: row.ad_id, creative_id: creative, video_id: row.video_id ?? null}], false).catch(() => []);
    if (media?.url) {
      if (ownedMediaCache.size > 1000) ownedMediaCache.clear();
      ownedMediaCache.set(ownedMediaKey(media), {until: Date.now() + 30 * 60000, media});
      return media.url;
    }
  }
  return row.creative_url ?? null;
}

const supabaseHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname; } catch { return ''; } })();
/** Fetch the still ourselves (allowlisted hosts only) so the AI provider never needs to reach a signed or expiring URL. */
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

// The prompt shows the shape (DeepSeek's JSON mode takes no schema); OpenAI is also held to the matching
// strict schema in formats.ts. Either way readAdReading/readSetReading check the reply before it is kept.
const blank = {value: '...', source: 'ข้อความ', quote: '...'};
const AD_SHAPE = JSON.stringify({
  ...Object.fromEntries(AI_DIMS.map(dim => [dim, blank])),
  claims: {items: [{text: '...', risky: false}], quote: '...'},
  scores: Object.fromEntries(SCORE_DIMS.map(dim => [dim, {score: 0, why: '...'}])),
  fix: '...',
});
const SET_SHAPE = JSON.stringify({diffs: [{text: '...', ads: [0, 1]}], ideas: [{text: '...', ads: [0]}], hooks: [{text: '...', why: '...'}]});

/** How a clip is read, the same in both team views (spec 2026-11-23). */
const VIDEO_RULES = `ถ้าแอดเป็นคลิปและได้รับ "ภาพจากคลิป" เรียงตามเวลาพร้อมบทพูดที่ AI ถอดจากเสียง ให้อ่านจากภาพทุกภาพ เสียง และข้อความรวมกัน
ป้ายแหล่งที่มา: "ข้อความ" = เฉพาะส่วน "ข้อความในแอด" (แคปชั่น พาดหัว) · "เสียง" = เฉพาะบทพูดที่ถอดจากเสียงของคลิป · "ภาพ" = สิ่งที่เห็นหรือตัวหนังสือบนภาพ (ภาพจากคลิปให้บอกวินาทีไว้ท้าย value เช่น "(0:03)")
quote ต้องคัดลอกตรงตัวจากแหล่งตามป้ายนั้น ถ้าเรื่องเดียวกันมีหลายแหล่ง ให้ใส่ป้ายตามแหล่งที่ quote คัดลอกมา คำที่ได้ยินในคลิปแต่ไม่มีในข้อความในแอด ต้องใช้ป้าย "เสียง" เสมอ
คำเปิดของคลิปให้ดูจากภาพ 0:00–0:03 และบทพูด 5 วินาทีแรก คำอ้างที่ได้ยินในเสียงต้องอยู่ใน claims ด้วย
ถ้าข้อมูลบอกว่าไม่ได้ฟังเสียง ห้ามสรุปว่าในเสียงมีหรือไม่มีคำอ้าง`;

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
${VIDEO_RULES}
ห้ามคาดเดายอดขาย งบ หรือผลลัพธ์ของแอด

scores = ให้คะแนนคุณภาพครีเอทีฟ 0–10 (จำนวนเต็ม) แบบ creative director ที่เข้มงวด ไม่ใจดี ไม่ใช่การเดาผลลัพธ์
เกณฑ์: 3 = อ่อน 5 = ธรรมดาเหมือนแอดทั่วไป 7 = ดีพอจะยิงต่อ 9–10 = โดดเด่นจริง หายากมาก ถ้าลังเลระหว่างสองคะแนนให้เลือกคะแนนที่ต่ำกว่า
hook = หยุดนิ้วคนที่เลื่อนฟีดได้แค่ไหนในวินาทีแรก (บรรทัดแรก หรือข้อความใหญ่บนภาพ)
clarity = อ่านแล้วรู้ทันทีไหมว่าขายอะไร ให้ใคร ได้อะไร
cta = บอกชัดไหมว่าต้องทำอะไรต่อ (ทักแชท สั่งซื้อ กดลิงก์) และมีเหตุให้ทำตอนนี้
emotion = แตะปัญหาหรือความรู้สึกจริงของลูกค้าแค่ไหน
offer = ข้อเสนอชัดและคุ้มแค่ไหน ถ้าไม่บอกราคาหรือข้อเสนอเลยให้ 0–3
fit = ภาพกับข้อความเล่าเรื่องเดียวกันไหม ถ้าไม่มีภาพให้ score=null
why = เหตุผลของคะแนน อ้างสิ่งที่เห็นในแอด ไม่เกิน 80 ตัวอักษร
fix = สิ่งเดียวที่ควรแก้ก่อนเพื่อให้แอดนี้ดีขึ้นมากที่สุด (มักเป็นส่วนที่คะแนนต่ำสุด) เขียนเป็นคำสั่งที่ทำได้เลย ไม่เกิน 120 ตัวอักษร ห้ามแต่งตัวเลขหรือคำอ้างที่ไม่มีในแอด ห้ามแนะนำให้ใช้คำอ้างที่ risky หรือคำอ้างผลต่อโรค อวัยวะ หรือระยะเวลาเห็นผล

source ใช้ได้แค่ ${AI_SOURCES.map(name => `"${name}"`).join(' ')} · score เป็นจำนวนเต็ม 0–10 หรือ null
ตอบเป็น JSON object เดียว มีครบทุกช่องตามรูปแบบนี้ (... คือส่วนที่ให้เติม):
${AD_SHAPE}`;

const SET_PROMPT = `คุณช่วยทีมการตลาดไทยสรุปการเทียบโฆษณา ตอบภาษาไทย ประโยคละไม่เกิน 160 ตัวอักษร
ข้อมูลคือผลอ่านแอดแต่ละตัว (index เริ่มที่ 0) พร้อมคะแนนครีเอทีฟ 0–10 ที่ AI ให้ แอดของเรามีตัวเลขผลลัพธ์จริง แอดคู่แข่งไม่มีงบหรือยอดขาย ห้ามอ้างว่าคู่แข่งขายดีกว่าหรือได้ผลกว่า
จำนวนวันที่คู่แข่งยิง: 30 วันขึ้นไปและยังแสดงอยู่ = คู่แข่งใช้แอดนี้ต่อเนื่อง ควรศึกษา (แต่ห้ามสรุปว่าขายดีหรือได้ผล เพราะไม่มีข้อมูลนั้น) ไม่เกิน 10 วัน = อาจยังทดสอบอยู่ อย่าเพิ่งยึดเป็นแบบ ข้อมูลนี้ไม่มีจำนวนวันของแอดเรา ห้ามพูดว่าแอดเราไม่มีข้อมูลวัน
ถ้าตัวเลขจริงของแอดเราดีแต่คะแนนต่ำ ให้เชื่อตัวเลขจริงก่อน แนะนำเป็นการทดลองเพิ่ม ไม่ใช่ให้หยุดแอด
ถ้า scores.fit เป็น null แปลว่า AI ไม่ได้เห็นภาพของแอดนั้น (ระบบอาจโหลดภาพไม่ได้) ห้ามสรุปว่าแอดนั้นไม่มีภาพหรือเป็นข้อความล้วน และห้ามเทียบเรื่องภาพ
diffs = จุดที่แอดเรากับคู่แข่งต่างกันจริง 2–4 ข้อ (คำเปิด ข้อเสนอ มุมขาย CTA หลักฐาน รูปแบบ) เริ่มจากส่วนที่คะแนนห่างกันมากที่สุด
ideas = ไอเดียทดลองสำหรับแอดฝั่ง "แอดของเรา" เท่านั้น 2–4 ข้อ (เราแก้แอดคู่แข่งไม่ได้) เขียนเป็นสิ่งที่ทีมทำกับแอดเราได้เลย เช่น เปลี่ยนคำเปิด ใส่ราคา เพิ่มหลักฐาน แล้ววัดผลด้วยตัวเลขของเรา
hooks = คำเปิดใหม่ 3 แบบสำหรับแอดของเรา ให้ทีมยิงทดสอบ แต่ละแบบใช้มุมต่างกัน (เช่น ปัญหา ผลลัพธ์ที่พูดได้ ข้อเสนอ) text = ประโยคพร้อมใช้ ไม่เกิน 90 ตัวอักษร why = ทำไมน่าลอง ไม่เกิน 100 ตัวอักษร
กฎของ ideas และ hooks: ใช้เฉพาะข้อเท็จจริงที่มีในแอดของเรา (ราคา ของแถม ส่วนผสม วิธีใช้) ห้ามแต่งตัวเลข รีวิว หรือคำอ้างใหม่ ห้ามลอกคำของคู่แข่งมาทั้งประโยค
กฎ อย. เข้มที่สุด: ห้ามนำคำอ้างใน claims ที่ risky=true มาใช้ซ้ำแม้จะเรียบเรียงใหม่ ห้ามอ้างว่ารักษา ป้องกัน หรือบรรเทาโรคหรืออาการ ห้ามอ้างผลต่ออวัยวะหรือค่าเลือด (หลอดเลือด หัวใจ ความดัน ไขมัน น้ำตาล) ห้ามบอกว่าเห็นผลในกี่วัน ห้ามรับประกันผล (แน่นอน 100% หายขาด ถาวร) ห้ามอ้างแพทย์
hooks ที่ปลอดภัยใช้มุม เช่น ข้อเสนอและราคา ความสะดวก รสชาติ วิธีกิน คำถามชวนคิดเรื่องไลฟ์สไตล์ ส่วนผสมที่มีในแอด ชื่อสินค้าให้สะกดตามที่เขียนในแอดทุกตัวอักษร
ads = index ของแอดที่เป็นหลักฐานของข้อนั้น

ตอบเป็น JSON object เดียว มีครบทุกช่องตามรูปแบบนี้ (... คือส่วนที่ให้เติม):
${SET_SHAPE}`;

// ทีมยิงแอด: only the four topics the ad team works with, each its own prompt and cache.
const ADS_VERSION = 'v3'; // bump when ADS_AD_PROMPT changes (v3: video clips, sources defined)
const ADS_SET_VERSION = 'v1'; // bump when ADS_SET_PROMPT changes
const ADS_SHAPE = JSON.stringify(Object.fromEntries(ADS_DIMS.map(dim => [dim, blank])));

const ADS_AD_PROMPT = `คุณช่วยทีมยิงแอด Facebook ของไทยอ่านโฆษณาทีละตัว ตอบภาษาไทย สั้น ไม่เกิน 120 ตัวอักษรต่อช่อง
ใช้เฉพาะสิ่งที่อยู่ในข้อความหรือภาพของแอดนี้ ห้ามเดา ถ้าไม่พบให้ value="ไม่พบในแอด" source="ไม่พบ" quote=""
quote ต้องคัดลอกคำจริงจากข้อความหรือคำบนภาพ ไม่เกิน 80 ตัวอักษร ยกเว้น cover ไม่เกิน 200 ตัวอักษร
caption = โครงของแคปชั่น: เปิดด้วยอะไร ยาวหรือสั้น โทนภาษา (เป็นกันเอง ทางการ เร่งเร้า เล่าเรื่อง) และปิดท้ายชวนให้ทำอะไร quote = บรรทัดแรกของแคปชั่น
headline = ข้อความพาดหัว คัดลอกตามจริงทุกตัวอักษร ถ้ามี "พาดหัว (Meta)" ให้ใช้อันนั้น source="ข้อความ" ถ้าไม่มีให้ใช้ตัวหนังสือที่ใหญ่ที่สุดบนภาพ source="ภาพ" quote = คำเดียวกับ value
content = แนวคอนเทนต์ เลือกที่ตรงที่สุด เช่น พรีเซนเตอร์พูดกับกล้อง รีวิวลูกค้า ก่อน-หลัง สอนวิธีใช้ โปรโมชั่นและราคา คนดังหรืออินฟลู เล่าเรื่องหรือละครสั้น ภาพสินค้าล้วน แล้วต่อด้วยสิ่งที่เห็นสั้นๆ
cover = ภาพหน้าปก: ในภาพมีอะไร (คน สินค้า ฉาก สีเด่น) quote = ตัวหนังสือทั้งหมดบนภาพปก คัดลอกตามจริง เรียงจากบนลงล่าง คั่นด้วย " / " ถ้าไม่มีภาพให้ value="ไม่มีภาพให้ดู" source="ไม่พบ" quote="" ถ้าเป็นคลิป ภาพปกคือภาพที่ 0:00
${VIDEO_RULES}
ห้ามคาดเดายอดขาย งบ หรือผลลัพธ์ของแอด
source ใช้ได้แค่ ${AI_SOURCES.map(name => `"${name}"`).join(' ')}
ตอบเป็น JSON object เดียว มีครบทุกช่องตามรูปแบบนี้ (... คือส่วนที่ให้เติม):
${ADS_SHAPE}`;

const ADS_SET_PROMPT = `คุณช่วยทีมยิงแอดไทยสรุปการเทียบโฆษณา ตอบภาษาไทย ประโยคละไม่เกิน 160 ตัวอักษร
ข้อมูลคือผลอ่านแอดแต่ละตัว (index เริ่มที่ 0) 4 หัวข้อ: caption (แคปชั่น) headline (พาดหัว) content (แนวคอนเทนต์) cover (ภาพปกและคำในปก) แอดของเรามีตัวเลขผลลัพธ์จริง แอดคู่แข่งไม่มีงบหรือยอดขาย ห้ามอ้างว่าคู่แข่งขายดีกว่าหรือได้ผลกว่า
จำนวนวันที่คู่แข่งยิง: 30 วันขึ้นไปและยังแสดงอยู่ = คู่แข่งใช้แอดนี้ต่อเนื่อง ควรศึกษา (แต่ห้ามสรุปว่าขายดีหรือได้ผล) ไม่เกิน 10 วัน = อาจยังทดสอบอยู่ อย่าเพิ่งยึดเป็นแบบ
ถ้า cover.source เป็น "ไม่พบ" แปลว่า AI ไม่ได้เห็นภาพปกของแอดนั้น ห้ามเทียบเรื่องภาพปก
diffs = จุดที่แอดเรากับคู่แข่งต่างกันจริง 2–4 ข้อ เฉพาะ 4 หัวข้อนี้ ขึ้นต้นแต่ละข้อด้วยชื่อหัวข้อภาษาไทย เช่น "พาดหัว: ..."
ideas = สิ่งที่ทีมยิงแอดลองแก้ในแอดของเรา 2–4 ข้อ เฉพาะแคปชั่น พาดหัว แนวคอนเทนต์ หรือภาพปก (เราแก้แอดคู่แข่งไม่ได้) เขียนเป็นสิ่งที่ทำได้เลย แล้ววัดผลด้วยตัวเลขของเรา
hooks = พาดหัวหรือคำบนปกใหม่ 3 แบบสำหรับแอดของเรา ให้ทีมยิงทดสอบ แต่ละแบบใช้มุมต่างกัน text = คำพร้อมใช้ ไม่เกิน 60 ตัวอักษร why = ทำไมน่าลอง ไม่เกิน 100 ตัวอักษร
กฎของ ideas และ hooks: ใช้เฉพาะข้อเท็จจริงที่มีในแอดของเรา (ราคา ของแถม ส่วนผสม วิธีใช้) ห้ามแต่งตัวเลข รีวิว หรือคำอ้างใหม่ ห้ามลอกคำของคู่แข่งมาทั้งประโยค
กฎ อย. เข้มที่สุด: ห้ามอ้างว่ารักษา ป้องกัน หรือบรรเทาโรคหรืออาการ ห้ามอ้างผลต่ออวัยวะหรือค่าเลือด (หลอดเลือด หัวใจ ความดัน ไขมัน น้ำตาล) ห้ามบอกว่าเห็นผลในกี่วัน ห้ามรับประกันผล (แน่นอน 100% หายขาด ถาวร) ห้ามอ้างแพทย์ ชื่อสินค้าให้สะกดตามที่เขียนในแอดทุกตัวอักษร
ads = index ของแอดที่เป็นหลักฐานของข้อนั้น

ตอบเป็น JSON object เดียว มีครบทุกช่องตามรูปแบบนี้ (... คือส่วนที่ให้เติม):
${SET_SHAPE}`;

const sha = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const adsCopy = (ad: Loaded) => `พาดหัว (Meta): ${ad.headline?.trim() || '(ไม่มี)'}\nแคปชั่น:\n${ad.caption.slice(0, 4000) || '(ไม่มีข้อความ)'}`;

/** What differs between team views: prompts, cache keys, the copy the model is shown, and how its reply is checked. */
type ViewSpec = {
  adKey: (ad: Loaded) => string; setKey: (keys: string[]) => string; adPrompt: string; setPrompt: string; adFormat: ReplyFormat;
  copy: (ad: Loaded) => string;
  /** `seen` is false when the model was sent no picture: whatever it said about one is replaced. */
  read: (raw: unknown, seen: boolean) => AdReading | AdsReading | null;
};
const VIEWS: Record<TeamView, ViewSpec> = {
  general: {
    adKey: ad => `ad:${VERSION}:${MODEL}:${adRefId(ad.ref)}:${sha(ad.text + videoMarker(ad.video))}`,
    setKey: keys => `set:${SET_VERSION}:${MODEL}:${sha(keys.join('|'))}`,
    adPrompt: AD_PROMPT, setPrompt: SET_PROMPT, adFormat: AD_FORMAT,
    copy: ad => `ข้อความในแอด:\n${ad.text.slice(0, 4000) || '(ไม่มีข้อความ)'}`,
    read: (raw, seen) => {
      const reading = readAdReading(raw);
      // Without a picture there is nothing to judge, whatever the model guessed.
      if (reading && !seen) reading.scores.fit = {score: null, why: 'AI ไม่ได้เห็นภาพของแอดนี้'};
      return reading;
    },
  },
  ads: {
    adKey: ad => `adsteam:ad:${ADS_VERSION}:${MODEL}:${adRefId(ad.ref)}:${sha(adsCopy(ad) + videoMarker(ad.video))}`,
    setKey: keys => `adsteam:set:${ADS_SET_VERSION}:${MODEL}:${sha(keys.join('|'))}`,
    adPrompt: ADS_AD_PROMPT, setPrompt: ADS_SET_PROMPT, adFormat: ADS_FORMAT,
    copy: adsCopy,
    read: (raw, seen) => {
      const reading = readAdsReading(raw);
      if (reading && !seen) reading.cover = {value: 'AI ไม่ได้เห็นภาพปกของแอดนี้', source: 'ไม่พบ', quote: ''};
      return reading;
    },
  },
};

async function spent(db: Awaited<ReturnType<typeof dbUser>>) {
  // ponytail: sums every row in JS; fine for thousands of calls, move to SQL if the table grows large.
  // This provider's rows only (provider.ts SPEND): the caps and the credit bar track its own balance.
  // Readings and the compare-round talk (questions, note drafts) share one budget.
  const rows = (table: 'ai_analyses' | 'compare_messages') => {
    const query = db.from(table).select('usd,created_at').in('model', SPEND.models);
    return SPEND.since ? query.gte('created_at', SPEND.since) : query;
  };
  const [readings, talk] = await Promise.all([rows('ai_analyses'), rows('compare_messages')]);
  if (readings.error) throw new AiError('อ่านค่าใช้จ่าย AI ไม่สำเร็จ', 503);
  // Before migration 0077 there is no talk to count, and nothing can be added to it either.
  if (talk.error) console.error('Compare talk cost unreadable', talk.error.code);
  const dayStart = new Date(Date.now() + 7 * 3600e3); dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.getTime() - 7 * 3600e3; // Bangkok midnight
  let total = 0, today = 0;
  for (const row of [...readings.data ?? [], ...talk.data ?? []]) { const usd = Number(row.usd); total += usd; if (Date.parse(row.created_at) >= since) today += usd; }
  return {today, total, dailyCap: DAILY_CAP, totalCap: TOTAL_CAP};
}

/** Refuses a call that would pass the daily or total AI cap; returns what has been spent. */
export async function withinBudget(estimate: number) {
  const budget = await spent(await dbUser());
  if (estimate > 0 && (budget.today + estimate > DAILY_CAP || budget.total + estimate > TOTAL_CAP))
    throw new AiError(`เกินเพดานค่าใช้จ่าย AI (วันนี้ ${budget.today.toFixed(3)}/${DAILY_CAP} USD · รวม ${budget.total.toFixed(3)}/${TOTAL_CAP} USD)`, 429);
  return budget;
}

/** A clip AI can be shown: the video reader finished it, and the model reads pictures. */
const clipOf = (ad: Loaded, vision: boolean) =>
  vision && ad.video?.status === 'ready' && ad.video.frames.length > 0 && ad.observationId ? ad.video : null;

/** The clip's transcript cache keys, or null when it has no audio to hear or nothing here transcribes. */
function transcriptKeysOf(ad: Loaded, clip: VideoRow | null) {
  if (!clip?.has_audio || !CAN_TRANSCRIBE || !ad.observationId || !clip.audio_path || !clip.audio_sha256 || !clip.hook_audio_path || !clip.hook_audio_sha256) return null;
  return {audio: transcriptKey(ad.observationId, 'audio', clip.audio_sha256), hook: transcriptKey(ad.observationId, 'hook', clip.hook_audio_sha256)};
}

/** dryRun: what is cached, what a run would cost, and what has been spent. Never calls the AI provider. */
export async function runComparison(refs: AdRef[], dryRun: boolean, view: TeamView = 'general'): Promise<AiEstimate | AiRun | AdsRun> {
  const {vision} = modelConfig();
  const spec = VIEWS[view];
  const db = await dbUser();
  const ads = await loadAds(refs);
  const keys = ads.map(spec.adKey);
  const setKey = spec.setKey(keys);
  const clips = ads.map(ad => clipOf(ad, vision));
  const heardKeys = ads.map((ad, index) => transcriptKeysOf(ad, clips[index]));
  const cached = await db.from('ai_analyses').select('key,result')
    .in('key', [...keys, setKey, ...heardKeys.flatMap(key => key ? [key.audio, key.hook] : [])]);
  if (cached.error) throw new AiError('อ่านผลวิเคราะห์เดิมไม่สำเร็จ', 503);
  const hit = new Map((cached.data ?? []).map(row => [row.key as string, row.result]));
  const missing = ads.filter((_, index) => !hit.has(keys[index]));
  // A clip read for the first time adds its frames and any audio not transcribed before.
  const clipEstimate = ads.reduce((sum, _, index) => {
    const clip = clips[index], key = heardKeys[index];
    if (hit.has(keys[index]) || !clip) return sum;
    const cachedParts = new Set((['audio', 'hook'] as const).filter(part => key && hit.has(key[part])));
    return sum + estimateUsd(EST_VIDEO_INPUT, 0) + (key ? transcriptionEstimateUsd(clip, cachedParts, TRANSCRIBE_USD_PER_MINUTE) : 0);
  }, 0);
  const estimate = missing.length * estimateUsd(...EST_AD) + clipEstimate + (hit.has(setKey) ? 0 : estimateUsd(...EST_SET));
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
  const download = clips.some(Boolean) ? videoDownloader() : null;
  /** One part's transcript: cached, or transcribed now and cached, so a clip's audio is paid for once. */
  const transcript = async (key: string, path: string): Promise<string> => {
    if (hit.has(key)) return String((hit.get(key) as {text?: unknown} | null)?.text ?? '');
    const heard = await transcribeAudio(await download!(path));
    cost += heard.usd;
    hit.set(key, {text: heard.text, seconds: heard.seconds});
    const {error} = await db.from('ai_analyses').upsert({key, kind: 'transcript', model: TRANSCRIBE_MODEL, result: {text: heard.text, seconds: heard.seconds}, input_tokens: 0, output_tokens: 0, usd: heard.usd.toFixed(6)});
    if (error) console.error('Transcript not cached', error.message);
    return heard.text;
  };
  await Promise.all(ads.map(async (ad, index) => {
    if (hit.has(keys[index])) return;
    const header = `ฝั่ง: ${ad.side}\nชื่อ: ${ad.label}\nรูปแบบ: ${ad.format}\n`;
    let content: Exclude<Message['content'], string> | null = null, seen = false, key = keys[index];
    const clip = clips[index], heardKey = heardKeys[index];
    if (clip) {
      try {
        const frames = await Promise.all(clip.frames.map(async frame =>
          ({t_ms: frame.t_ms, dataUrl: `data:image/jpeg;base64,${(await download!(frame.path)).toString('base64')}`})));
        const transcripts: Transcripts | null = !clip.has_audio ? {audio: null, hook: null}
          : heardKey ? {hook: await transcript(heardKey.hook, clip.hook_audio_path!), audio: await transcript(heardKey.audio, clip.audio_path!)} : null;
        content = [{type: 'text', text: `${header}${spec.copy(ad)}`}, ...videoParts(clip, frames, transcripts)];
        seen = frames.length > 0;
      } catch (error) {
        // The team must see a transcription refusal (no credit, a bad key); a storage hiccup falls back to the cover.
        if (error instanceof AiError) throw error;
        console.error('Clip not used', {ad: adRefId(ad.ref), error: error instanceof Error ? error.name : 'unknown'});
        // Kept under the key of a reading without the clip, so the next run reads the clip.
        key = spec.adKey({...ad, video: null});
      }
    }
    if (!content) {
      // A model that cannot read pictures is not sent one (nor is Meta asked for it).
      const image = vision ? await imageData(ad.owned ? await ownedImage(ad.owned) : ad.image) : null;
      content = [{type: 'text', text: `${header}${image ? '' : 'ไม่มีภาพประกอบ อ่านจากข้อความเท่านั้น\n'}${spec.copy(ad)}`}];
      if (image) content.push({type: 'image_url', image_url: {url: image, detail: 'low'}});
      seen = Boolean(image);
    }
    const call = await callModel([{role: 'system', content: spec.adPrompt}, {role: 'user', content}], MAX_OUTPUT, spec.adFormat);
    const reading = spec.read(call.result, seen);
    if (!reading) throw new AiError('AI ตอบไม่ครบตามรูปแบบ ลองใหม่อีกครั้ง', 502);
    hit.set(keys[index], reading);
    await save(key, 'ad', {...call, result: reading});
  }));
  if (!hit.has(setKey)) {
    const input = ads.map((ad, index) => ({index, side: ad.side, name: ad.label, facts: ad.facts, reading: hit.get(keys[index])}));
    const call = await callModel([{role: 'system', content: spec.setPrompt}, {role: 'user', content: JSON.stringify(input)}], MAX_OUTPUT, SET_FORMAT);
    const summary = readSetReading(call.result, ads.length);
    if (!summary) throw new AiError('AI ตอบไม่ครบตามรูปแบบ ลองใหม่อีกครั้ง', 502);
    hit.set(setKey, summary);
    await save(setKey, 'set', {...call, result: summary});
  }
  const context = ads.map((ad, index) => {
    const heardKey = heardKeys[index];
    const heard = Boolean(heardKey && hit.has(heardKey.audio) && hit.has(heardKey.hook));
    return {id: adRefId(ad.ref), ref: ad.ref, side: ad.side, label: ad.label, facts: ad.facts, video: videoContext(ad.ref.kind, ad.format, ad.video, heard)};
  });
  const run = {model: MODEL, cost, spent: {...budget, today: budget.today + cost, total: budget.total + cost}, summary: hit.get(setKey) as SetReading, context};
  return view === 'ads'
    ? {...run, view, ads: Object.fromEntries(ads.map((ad, index) => [adRefId(ad.ref), hit.get(keys[index]) as AdsReading]))}
    : {...run, ads: Object.fromEntries(ads.map((ad, index) => [adRefId(ad.ref), hit.get(keys[index]) as AdReading]))};
}

/** What AI calls have cost (as recorded per call), for the usage bars. */
export async function aiUsage() {
  return {...await spent(await dbUser()), model: MODEL, provider: PROVIDER_LABEL, creditUsd: SPEND.creditUsd};
}
