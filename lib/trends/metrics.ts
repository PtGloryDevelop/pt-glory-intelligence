/**
 * What may be trended, and which kind of thing it is.
 *
 * This is the P2.5 decision made explicit and testable: an EVENT happened at a
 * moment and belongs to a window; a STATE is only ever true as of an instant
 * and needs a reference point. Reading a state as if it were an event would
 * count collections rather than advertising, and reading either from today's
 * data for both periods would make every past period look like the present.
 */

export const TREND_METRICS = [
  "first_seen", "started",
  "observed", "active", "inactive", "unknown", "evergreen", "reused",
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number];
export type MetricKind = "event" | "state";

export function trendMetric(raw: string | null | undefined): TrendMetric | null {
  return (TREND_METRICS as readonly string[]).includes(raw ?? "")
    ? (raw as TrendMetric)
    : null;
}

export const TREND_ROWS: {
  metric: TrendMetric;
  kind: MetricKind;
  label: string;
  helper: string;
}[] = [
  {
    metric: "first_seen", kind: "event",
    label: "Ads ที่ PT Glory พบครั้งแรก",
    helper: "นับโฆษณาที่วันพบครั้งแรกตกอยู่ในช่วงนี้ — เป็นเหตุการณ์ ไม่ใช่สถานะ",
  },
  {
    metric: "started", kind: "event",
    label: "Ads ที่ Meta ระบุว่าเริ่มแสดง",
    helper: "นับโฆษณาที่วันเริ่มแสดงตกอยู่ในช่วงนี้ — คนละค่ากับวันที่เราพบ",
  },
  {
    metric: "observed", kind: "state",
    label: "Ads ที่รู้จัก ณ ปลายช่วง",
    helper: "สถานะ ณ วินาทีสุดท้ายของแต่ละช่วง จากการสังเกตล่าสุดที่มีอยู่ตอนนั้น",
  },
  {
    metric: "active", kind: "state",
    label: "Active ณ ปลายช่วง", helper: "สถานะที่อ่านได้ ณ เวลานั้น",
  },
  {
    metric: "inactive", kind: "state",
    label: "Inactive ณ ปลายช่วง", helper: "สถานะที่อ่านได้ ณ เวลานั้น",
  },
  {
    metric: "unknown", kind: "state",
    label: "ไม่ทราบสถานะ ณ ปลายช่วง",
    helper: "รอบเก็บ ณ ตอนนั้นอ่านสถานะไม่ได้ — ไม่ใช่หยุดแสดง",
  },
  {
    metric: "evergreen", kind: "state",
    label: "Evergreen ณ ปลายช่วง",
    helper: "ยังแสดงอยู่ ณ ตอนนั้น และอายุถึงเกณฑ์ ณ ตอนนั้น",
  },
  {
    metric: "reused", kind: "state",
    label: "ใช้ซ้ำ ณ ปลายช่วง",
    helper: "collation > 1 ตามการสังเกตที่มีอยู่ตอนนั้น — ไม่ได้แปลว่าไฟล์เหมือนกัน",
  },
];

export function metricRow(metric: TrendMetric) {
  return TREND_ROWS.find((row) => row.metric === metric)!;
}

/** The two clocks an event metric can belong to. */
export const EVENT_METRICS = TREND_ROWS
  .filter((row) => row.kind === "event")
  .map((row) => row.metric);

export const STATE_METRICS = TREND_ROWS
  .filter((row) => row.kind === "state")
  .map((row) => row.metric);

/** Directions the page ranking can be read in. Arithmetic, not judgement. */
export const RANK_DIRECTIONS = ["increase", "decrease"] as const;
export type RankDirection = (typeof RANK_DIRECTIONS)[number];

export function rankDirection(raw: string | null | undefined): RankDirection {
  return (RANK_DIRECTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as RankDirection)
    : "increase";
}

export const RANK_LABEL: Record<RankDirection, string> = {
  increase: "เพิ่มขึ้นมากสุดตามจำนวนที่เราพบ",
  decrease: "ลดลงมากสุดตามจำนวนที่เราพบ",
};
