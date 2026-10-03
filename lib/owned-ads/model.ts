/** Performance belongs to an uploaded company report, never a public competitor ad. */
export type OwnedAdRow = {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  adset_name: string | null;
  status: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversations: number | null;
  purchases: number | null;
  purchase_value: number | null;
  video_3s: number | null;
  thruplays: number | null;
  creative_url: string | null;
  destination_url: string | null;
};

export type OwnedAdReport = {
  id: string;
  name: string;
  account_name: string;
  currency: string;
  date_start: string;
  date_end: string;
  source_label: string;
  imported_at: string;
  rows: OwnedAdRow[];
};

export type OwnedAdReportSummary = Omit<OwnedAdReport, "rows"> & { row_count: number };

export const OWNED_REPORT_SOURCE_LABEL = "รายงานที่อัปโหลดโดยทีมบริษัท";
export const OWNED_CSV_HEADERS = [
  "ad_id", "ad_name", "campaign_name", "adset_name", "status", "spend",
  "impressions", "clicks", "conversations", "purchases", "purchase_value",
  "video_3s", "thruplays", "creative_url", "destination_url",
] as const;
export const OWNED_CSV_TEMPLATE = `${OWNED_CSV_HEADERS.join(",")}\r\n`;

export type OwnedMetric = { value: number | null; present: number; total: number };
export const OWNED_METRIC_FIELDS = [
  "spend", "impressions", "clicks", "conversations", "purchases", "purchase_value",
  "video_3s", "thruplays",
] as const;
export type OwnedMetricField = (typeof OWNED_METRIC_FIELDS)[number];
export type OwnedReportMetrics = Record<OwnedMetricField, OwnedMetric> & {
  row_count: number;
  roas: OwnedMetric;
  ctr: OwnedMetric;
  cpc: OwnedMetric;
  cost_per_conversation: OwnedMetric;
  cpa: OwnedMetric;
};

function validMetric(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A partial report must not turn unknown amounts into zero or partial totals. */
export function summarizeOwnedReport(rows: readonly OwnedAdRow[]): OwnedReportMetrics {
  const total = rows.length;
  const sum = (field: OwnedMetricField): OwnedMetric => {
    let present = 0;
    let amount = 0;
    for (const row of rows) {
      const value = row[field];
      if (validMetric(value)) {
        present += 1;
        amount += value;
      }
    }
    return { value: total > 0 && present === total && Number.isFinite(amount) ? amount : null, present, total };
  };
  const ratio = (numerator: OwnedMetricField, denominator: OwnedMetricField, scale = 1): OwnedMetric => {
    let present = 0;
    let top = 0;
    let bottom = 0;
    for (const row of rows) {
      const a = row[numerator];
      const b = row[denominator];
      if (validMetric(a) && validMetric(b)) {
        present += 1;
        top += a;
        bottom += b;
      }
    }
    const value = top / bottom * scale;
    return { value: total > 0 && present === total && bottom > 0 && Number.isFinite(value) ? value : null, present, total };
  };
  return {
    row_count: total,
    spend: sum("spend"), impressions: sum("impressions"), clicks: sum("clicks"),
    conversations: sum("conversations"), purchases: sum("purchases"),
    purchase_value: sum("purchase_value"), video_3s: sum("video_3s"), thruplays: sum("thruplays"),
    roas: ratio("purchase_value", "spend"), ctr: ratio("clicks", "impressions", 100),
    cpc: ratio("spend", "clicks"), cost_per_conversation: ratio("spend", "conversations"),
    cpa: ratio("spend", "purchases"),
  };
}
