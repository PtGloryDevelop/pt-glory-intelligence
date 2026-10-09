// Shapes shared by the AI compare route and the compare page (no server imports).
import {isAdArchiveId, isUuid} from '../read/request.ts';

export const AI_DIMS = ['pain', 'angle', 'hook', 'offer', 'proof', 'format'] as const;
export type AiDim = (typeof AI_DIMS)[number];
export const AI_DIM_LABEL: Record<AiDim | 'claims' | 'age', string> = {
  pain: 'ปัญหาลูกค้าที่พูดถึง', angle: 'มุมขาย', hook: 'คำเปิด', offer: 'ข้อเสนอ',
  proof: 'หลักฐานความน่าเชื่อ', format: 'รูปแบบครีเอทีฟ', claims: 'คำอ้างที่เสี่ยง', age: 'ยิงมานานแค่ไหน',
};

/**
 * The creative scorecard, after the claude-ads "/ads creative" rubric: six
 * parts, 0–10 each, scored strictly. "fit" is null when there is no picture to
 * judge. A hook under HOOK_REWRITE_BELOW means: rewrite it before more budget.
 */
export const SCORE_DIMS = ['hook', 'clarity', 'cta', 'emotion', 'offer', 'fit'] as const;
export type ScoreDim = (typeof SCORE_DIMS)[number];
export const SCORE_LABEL: Record<ScoreDim, string> = {
  hook: 'Hook คำเปิด', clarity: 'ข้อความชัด', cta: 'CTA ชวนทำต่อ', emotion: 'โดนใจ', offer: 'ข้อเสนอ', fit: 'ภาพกับข้อความเข้ากัน',
};
export const HOOK_REWRITE_BELOW = 7;
export type ScoreCell = {score: number | null; why: string};
export type Scores = Record<ScoreDim, ScoreCell>;

export type AiCell = {value: string; source: 'ข้อความ' | 'ภาพ' | 'ภาพ + ข้อความ' | 'ไม่พบ'; quote: string};
export type AdReading = Record<AiDim, AiCell> & {claims: {items: {text: string; risky: boolean}[]; quote: string}; scores: Scores; fix: string};
export type SetReading = {diffs: {text: string; ads: number[]}[]; ideas: {text: string; ads: number[]}[]; hooks: {text: string; why: string}[]};
export type AdRef = {kind: 'own'; account: string; ad: string} | {kind: 'rival'; dataset: string; ad: string};
export type AiSpent = {today: number; total: number; dailyCap: number; totalCap: number};
export type AiEstimate = {model: string; cached: number; missing: number; setCached: boolean; estimate: number; spent: AiSpent};
export type AiRun = {model: string; cost: number; spent: AiSpent; ads: Record<string, AdReading>; summary: SetReading};

export const adRefId = (ref: AdRef) => ref.kind === 'own' ? `own:${ref.account}:${ref.ad}` : `rival:${ref.dataset}:${ref.ad}`;

/** Model output → whole numbers 0–10 (null stays null: nothing to judge). */
export function cleanScores(raw: Partial<Record<ScoreDim, Partial<ScoreCell>>> | undefined): Scores {
  return Object.fromEntries(SCORE_DIMS.map(dim => {
    const cell = raw?.[dim];
    const value = typeof cell?.score === 'number' && Number.isFinite(cell.score) ? Math.min(10, Math.max(0, Math.round(cell.score))) : null;
    return [dim, {score: value, why: typeof cell?.why === 'string' ? cell.why : ''}];
  })) as Scores;
}

/** Points scored out of the points that could be judged (60 when every part has a score). */
export function scoreTotal(scores: Scores): {got: number; max: number} {
  const judged = SCORE_DIMS.map(dim => scores[dim].score).filter((value): value is number => value !== null);
  return {got: judged.reduce((sum, value) => sum + value, 0), max: judged.length * 10};
}

/** Where the other ad beats ours by the most (ties: the first part in rubric order); null when it does not. */
export function biggestGap(ours: Scores, theirs: Scores): {dim: ScoreDim; ours: number; theirs: number} | null {
  let best: {dim: ScoreDim; ours: number; theirs: number} | null = null;
  for (const dim of SCORE_DIMS) {
    const a = ours[dim].score, b = theirs[dim].score;
    if (a === null || b === null || b <= a) continue;
    if (!best || b - a > best.theirs - best.ours) best = {dim, ours: a, theirs: b};
  }
  return best;
}

/**
 * Words that often break Thai FDA rules for supplement ads. A plain word match
 * (not AI), shown next to what AI suggests so the team checks before using it;
 * the model is told to avoid these but does not always manage.
 */
const FDA_WATCH = ['รักษา', 'หายขาด', 'ถาวร', 'แน่นอน', '100%', 'การันตี', 'รับประกัน', 'ป้องกัน', 'บรรเทา', 'ลดน้ำหนัก',
  'ไขมัน', 'คอเลสเตอรอล', 'หลอดเลือด', 'เส้นเลือด', 'ไหลเวียน', 'หัวใจ', 'ความดัน', 'เบาหวาน', 'น้ำตาลในเลือด', 'มะเร็ง',
  'โรค', 'สโตรก', 'อัมพาต', 'หมอ', 'แพทย์', 'ล้างพิษ', 'ดีท็อกซ์', 'เห็นผล'];
export function fdaWatch(text: string): string[] {
  const found = FDA_WATCH.filter(word => text.includes(word));
  const days = text.match(/(ภายใน|ใน)\s*\d+\s*วัน/);
  return days ? [...found, days[0]] : found;
}

/** Client input → validated refs; 2–5 ads, at least one of ours, no duplicates. */
export function parseAdRefs(raw: unknown): AdRef[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5) return null;
  const refs: AdRef[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object' || typeof item.ad !== 'string' || !isAdArchiveId(item.ad)) return null;
    if (item.kind === 'own' && typeof item.account === 'string' && /^(act_)?\d{1,32}$/.test(item.account)) refs.push({kind: 'own', account: item.account, ad: item.ad});
    else if (item.kind === 'rival' && typeof item.dataset === 'string' && isUuid(item.dataset)) refs.push({kind: 'rival', dataset: item.dataset, ad: item.ad});
    else return null;
  }
  if (!refs.some(ref => ref.kind === 'own') || new Set(refs.map(adRefId)).size !== refs.length) return null;
  return refs;
}
