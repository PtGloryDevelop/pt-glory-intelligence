import type { OwnedAdRow } from "./model.ts";

export type CompanyAd = OwnedAdRow & {
  account_id: string; account_name: string; currency: string;
  page_id: string | null; page_name: string | null;
  title: string | null; body_text: string | null;
  video_id?: string | null;
};
type Entity = { meta_entity_id: string; name?: string | null; parent_meta_id?: string | null; status?: string | null; effective_status?: string | null; page_id?: string | null; page_name?: string | null; creative_title?: string | null; creative_body?: string | null; creative_thumbnail_url?: string | null };
type Day = { meta_entity_id: string; entity_name?: string | null; campaignId?: string | null; adSetId?: string | null; pageId?: string | null; pageName?: string | null; [key: string]: unknown };

/** Inventory plus orphan delivery ads. Never fabricate zero for absent delivery. */
export function companyRows(account: { metaAccountId: string; name: string; currency: string }, ads: Entity[], parents: Entity[], days: Day[], pageNames: ReadonlyMap<string, string> = new Map()): CompanyAd[] {
  const metadata = new Map(ads.map(ad => [ad.meta_entity_id, ad]));
  const ancestry = new Map(parents.map(row => [row.meta_entity_id,row]));
  const byAd = new Map<string, Day[]>();
  for (const day of days) {
    const list = byAd.get(day.meta_entity_id) ?? [];
    list.push(day); byAd.set(day.meta_entity_id,list);
  }
  const sum = (rows: Day[], field: string): number | null => {
    if (!rows.length || !rows.every(row => row[field] !== null && row[field] !== undefined && Number.isFinite(Number(row[field])) && Number(row[field]) >= 0)) return null;
    return rows.reduce((total,row) => total + Number(row[field]),0);
  };
  return [...new Set([...metadata.keys(), ...byAd.keys()])].sort().map(id => {
    const ad = metadata.get(id); const rows = byAd.get(id) ?? []; const day = rows.at(-1);
    const adsetId = ad?.parent_meta_id ?? day?.adSetId;
    const adset = adsetId ? ancestry.get(adsetId) : undefined;
    const campaignId = adset?.parent_meta_id ?? day?.campaignId;
    const pageId = ad?.page_id ?? day?.pageId ?? null;
    return {
      account_id: account.metaAccountId, account_name: account.name, currency: account.currency,
      ad_id: id, ad_name: ad?.name ?? day?.entity_name ?? id,
      campaign_name: (campaignId ? ancestry.get(campaignId)?.name : null) ?? campaignId ?? "ไม่ทราบแคมเปญ",
      adset_name: adset?.name ?? adsetId ?? null, status: ad?.effective_status ?? ad?.status ?? null,
      page_id: pageId, page_name: (pageId ? pageNames.get(pageId) : null) ?? ad?.page_name ?? (pageId === day?.pageId ? day?.pageName : null) ?? null,
      title: ad?.creative_title ?? null, body_text: ad?.creative_body ?? null,
      creative_url: ad?.creative_thumbnail_url ?? null, destination_url: null,
      spend: sum(rows,"spend"), impressions: sum(rows,"impressions"), clicks: sum(rows,"link_clicks"),
      conversations: sum(rows,"action_conv_started"), purchases: sum(rows,"action_purchases"), purchase_value: sum(rows,"action_purchase_value"),
      video_3s: sum(rows,"video_3s"), thruplays: sum(rows,"video_thruplay"),
    };
  });
}
