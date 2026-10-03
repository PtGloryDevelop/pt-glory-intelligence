import { isAdArchiveId, isUuid } from '../../../../lib/read/request.ts';
import type { AdDetail, ExplorerRow } from '../../../../lib/read/queries.ts';

export type ComparisonSelection = { account: string; owned: string; dataset: string; rival: string };
export type Rival = Omit<ExplorerRow, 'total_count'> & {
  archive_url?: string | null;
  dataset_id?: string;
  dataset_name?: string;
  collected_at?: string;
};

export const COMPARISON_DECISIONS = ['คงแอดเดิมและติดตาม', 'ทดลองครีเอทีฟใหม่', 'ทดลองข้อเสนอใหม่', 'ตรวจผลลัพธ์เพิ่มเติมก่อนตัดสินใจ'] as const;

/** Return only to evidence screens; a pasted link cannot become an external redirect. */
export function comparisonReturnHref(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://pt-glory.invalid');
    return url.origin === 'https://pt-glory.invalid' && ['/', '/market-overview', '/command-center', '/owned-ads', '/owned-ads/performance', '/competitors'].includes(url.pathname)
      ? url.pathname + url.search : '/';
  } catch { return '/'; }
}
export type ComparisonDraft = { product: string; ourOffer: string; theirOffer: string; decision: string; hypothesis: string; success: string };

/** Browser drafts contain team-entered text only, never the ads' financial payload. */
export function parseComparisonDraft(raw: unknown): ComparisonDraft {
  const values = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const field = (name: string, max: number) => typeof values[name] === 'string' ? values[name].slice(0, max) : '';
  const decision = field('decision', 100);
  return {
    product: field('product', 200), ourOffer: field('ourOffer', 2000), theirOffer: field('theirOffer', 2000),
    decision: COMPARISON_DECISIONS.some(value => value === decision) ? decision : '',
    hypothesis: field('hypothesis', 4000), success: field('success', 1000),
  };
}

export function comparisonSelectionKey(userNamespace: string): string | null {
  return isUuid(userNamespace) ? 'pt-glory-comparison-selection:' + userNamespace : null;
}

export function comparisonDraftKey(userNamespace: string, selection: ComparisonSelection): string | null {
  const valid = parseComparisonSelection(selection);
  if (!comparisonSelectionKey(userNamespace) || !valid.account || !valid.owned || !valid.dataset || !valid.rival) return null;
  return ['pt-glory-comparison-draft', userNamespace, valid.account, valid.owned, valid.dataset, valid.rival].join(':');
}

export function parseComparisonSelection(raw: Record<string, unknown>): ComparisonSelection {
  const account = typeof raw.account === 'string' && /^(act_)?\d{1,32}$/.test(raw.account) ? raw.account : '';
  const dataset = typeof raw.dataset === 'string' && isUuid(raw.dataset) ? raw.dataset : '';
  return {
    account,
    owned: account && typeof raw.owned === 'string' && isAdArchiveId(raw.owned) ? raw.owned : '',
    dataset,
    rival: dataset && typeof raw.rival === 'string' && isAdArchiveId(raw.rival) ? raw.rival : '',
  };
}

/** A link replaces its own side; the other selected ad survives a browsing trip. */
export function mergeComparisonSelection(saved: ComparisonSelection, linked: ComparisonSelection): ComparisonSelection {
  return {
    account: linked.account || saved.account,
    owned: linked.account ? linked.owned : saved.owned,
    dataset: linked.dataset || saved.dataset,
    rival: linked.dataset ? linked.rival : saved.rival,
  };
}

export function rivalFromDetail(detail: AdDetail & { archive_url?: string | null }): Rival {
  return { ...detail, publisher_platform: detail.publisher_platform ?? [] };
}
