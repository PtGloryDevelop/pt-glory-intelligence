// Shapes shared by the AI compare route and the compare page (no server imports).
import {isAdArchiveId, isUuid} from '../read/request.ts';

export const AI_DIMS = ['pain', 'angle', 'hook', 'offer', 'proof', 'format'] as const;
export type AiDim = (typeof AI_DIMS)[number];
export const AI_DIM_LABEL: Record<AiDim | 'claims' | 'age', string> = {
  pain: 'ปัญหาลูกค้าที่พูดถึง', angle: 'มุมขาย', hook: 'คำเปิด', offer: 'ข้อเสนอ',
  proof: 'หลักฐานความน่าเชื่อ', format: 'รูปแบบครีเอทีฟ', claims: 'คำอ้างที่เสี่ยง', age: 'ยิงมานานแค่ไหน',
};

export type AiCell = {value: string; source: 'ข้อความ' | 'ภาพ' | 'ภาพ + ข้อความ' | 'ไม่พบ'; quote: string};
export type AdReading = Record<AiDim, AiCell> & {claims: {items: {text: string; risky: boolean}[]; quote: string}};
export type SetReading = {diffs: {text: string; ads: number[]}[]; ideas: {text: string; ads: number[]}[]};
export type AdRef = {kind: 'own'; account: string; ad: string} | {kind: 'rival'; dataset: string; ad: string};
export type AiSpent = {today: number; total: number; dailyCap: number; totalCap: number};
export type AiEstimate = {model: string; cached: number; missing: number; setCached: boolean; estimate: number; spent: AiSpent};
export type AiRun = {model: string; cost: number; spent: AiSpent; ads: Record<string, AdReading>; summary: SetReading};

export const adRefId = (ref: AdRef) => ref.kind === 'own' ? `own:${ref.account}:${ref.ad}` : `rival:${ref.dataset}:${ref.ad}`;

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
