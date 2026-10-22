import { isAdArchiveId, isUuid } from '../../../../lib/read/request.ts';
import type { AdDetail, ExplorerRow } from '../../../../lib/read/queries.ts';

export type ComparisonSelection = { account: string; owned: string; dataset: string; rival: string };
export type Rival = Omit<ExplorerRow, 'total_count'> & {
  archive_url?: string | null;
  dataset_id?: string;
  dataset_name?: string;
  collected_at?: string;
};

/** Return only to evidence screens; a pasted link cannot become an external redirect. */
export function comparisonReturnHref(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://pt-glory.invalid');
    return url.origin === 'https://pt-glory.invalid' && ['/', '/market-overview', '/command-center', '/owned-ads', '/owned-ads/performance', '/competitors'].includes(url.pathname)
      ? url.pathname + url.search : '/';
  } catch { return '/'; }
}
export function comparisonSelectionKey(userNamespace: string): string | null {
  return isUuid(userNamespace) ? 'pt-glory-comparison-selection:' + userNamespace : null;
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

/**
 * One name for our ad everywhere on the compare screen. Ad names are often a
 * unit code ("U11"); then the title or campaign says more. Card and AI chip
 * used to disagree on this.
 */
export function ownedName(ad: { ad_name: string; title?: string | null; campaign_name?: string | null }): string {
  return ad.ad_name.trim().length <= 5 ? ad.title || ad.campaign_name || ad.ad_name : ad.ad_name;
}

/** Catalog ads ship a template ("{{product.brand}}") instead of copy; say so rather than print it. */
export function rivalCopy(text: string | null | undefined): { text: string; template: boolean } {
  if (!text?.trim()) return { text: 'ไม่มีข้อความที่บันทึกไว้', template: false };
  if (/\{\{[^}]+\}\}/.test(text) && text.replace(/\{\{[^}]+\}\}/g, '').trim().length < 12) {
    return { text: 'ข้อความเปลี่ยนตามสินค้าที่คนเห็น (แอดแคตตาล็อก) · Meta ไม่ได้ส่งข้อความจริงมา', template: true };
  }
  return { text, template: false };
}

export function rivalFromDetail(detail: AdDetail & { archive_url?: string | null }): Rival {
  return { ...detail, publisher_platform: detail.publisher_platform ?? [] };
}
