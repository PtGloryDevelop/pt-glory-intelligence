/**
 * The timeline's contract: which clock, which window, which grain.
 *
 * Three clocks run through this product and they are never merged. The type
 * below is what keeps them apart in the URL, in the SQL arguments and in the
 * words on screen — a bucket is meaningless until you know which of the three
 * it belongs to.
 *
 *   started     Meta's start_date        — when the ad began running
 *   first_seen  PT Glory's first_seen_at — when we first observed it, globally
 *   run         collection_runs.collected_at — when a collection happened
 */

export const TIMELINE_METRICS = ["started", "first_seen", "run"] as const;
export type TimelineMetric = (typeof TIMELINE_METRICS)[number];

export function timelineMetric(raw: string | null | undefined): TimelineMetric | null {
  return (TIMELINE_METRICS as readonly string[]).includes(raw ?? "")
    ? (raw as TimelineMetric)
    : null;
}

/**
 * What each series is called, and what it is not.
 *
 * The "not" half matters as much: "PT Glory พบครั้งแรก" is a fact about our
 * collection, and calling it "เข้าตลาด" would turn a gap in our coverage into a
 * claim about the advertiser.
 */
export const METRIC_LABEL: Record<TimelineMetric, string> = {
  started: "เริ่มแสดง",
  first_seen: "PT Glory พบครั้งแรก",
  run: "พบในรอบเก็บ",
};

export const METRIC_SOURCE: Record<TimelineMetric, string> = {
  started: "วันที่ Meta ระบุว่าโฆษณาเริ่มแสดง · นับโฆษณาที่ไม่ซ้ำกัน",
  first_seen: "วันที่ PT Glory เห็นโฆษณานี้ครั้งแรก (ทุกรอบเก็บ ไม่จำกัดขอบเขต) · นับโฆษณาที่ไม่ซ้ำกัน",
  run: "สิ่งที่แต่ละรอบเก็บสังเกตเห็นจริง · นับโฆษณาที่ถูกสังเกตในรอบนั้น",
};

/* ------------------------------------------------------------------ range */

export const RANGES = ["30d", "90d", "180d", "all"] as const;
export type TimelineRange = (typeof RANGES)[number];
export const DEFAULT_RANGE: TimelineRange = "all";

export function timelineRange(raw: string | null | undefined): TimelineRange {
  return (RANGES as readonly string[]).includes(raw ?? "")
    ? (raw as TimelineRange)
    : DEFAULT_RANGE;
}

export const RANGE_LABEL: Record<TimelineRange, string> = {
  "30d": "30 วันล่าสุด",
  "90d": "90 วันล่าสุด",
  "180d": "180 วันล่าสุด",
  all: "ทั้งหมด",
};

const DAY = 86_400_000;
const RANGE_DAYS: Record<Exclude<TimelineRange, "all">, number> = {
  "30d": 30, "90d": 90, "180d": 180,
};

/**
 * The window, as an inclusive-start / exclusive-end pair.
 *
 * `all` is null on both ends: the default deliberately hides nothing. A preset
 * that quietly dropped everything older than six months would make a page's
 * history look like its recent history.
 */
export function rangeWindow(range: TimelineRange, now = new Date()): { from: string | null; to: string | null } {
  if (range === "all") return { from: null, to: null };
  return {
    from: new Date(now.getTime() - RANGE_DAYS[range] * DAY).toISOString(),
    // Exclusive end, one day ahead, so today's own bucket is included.
    to: new Date(now.getTime() + DAY).toISOString(),
  };
}

/* ------------------------------------------------------------------ grain */

export const GRAINS = ["day", "week"] as const;
export type Grain = (typeof GRAINS)[number];

/**
 * The default grain follows the span, not the screen.
 *
 * A viewport-dependent grain would mean two people looking at the same URL see
 * different numbers in different buckets, which makes a shared research link
 * worthless. Ninety days is the boundary: below it a daily bar is readable,
 * above it a year of daily bars is a smear.
 */
export function defaultGrain(range: TimelineRange): Grain {
  return range === "30d" || range === "90d" ? "day" : "week";
}

export function timelineGrain(raw: string | null | undefined, range: TimelineRange): Grain {
  return (GRAINS as readonly string[]).includes(raw ?? "")
    ? (raw as Grain)
    : defaultGrain(range);
}

export const GRAIN_LABEL: Record<Grain, string> = { day: "รายวัน", week: "รายสัปดาห์" };

/** The end of a bucket, so a click can ask for exactly the rows it counted. */
export function bucketEnd(start: string, grain: Grain): string {
  const from = new Date(start);
  const days = grain === "day" ? 1 : 7;
  return new Date(from.getTime() + days * DAY).toISOString();
}

/* ----------------------------------------------------------------- status */

export const RUN_STATUSES = ["active", "inactive", "unknown"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function runStatus(raw: string | null | undefined): RunStatus | null {
  return (RUN_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as RunStatus) : null;
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  active: "Active", inactive: "Inactive", unknown: "ไม่ทราบ",
};

/* ---------------------------------------------------------- comparability */

export type RunContext = { scope_query: string | null; scope_country: string | null };

/**
 * Whether the runs on a timeline were collected the same way.
 *
 * Two runs are only comparable if they asked the same question of the same
 * market. When they did not, a rise or fall between them is a difference in
 * what was collected, not a difference in what the advertiser did — and the
 * chart must say so rather than let the shape of the bars imply a trend.
 *
 * No correction is attempted. The reader is told, and decides.
 */
export function comparability(runs: RunContext[]): {
  comparable: boolean;
  queries: string[];
  countries: string[];
  note: string | null;
} {
  const queries = [...new Set(runs.map((run) => run.scope_query ?? "—"))];
  const countries = [...new Set(runs.map((run) => run.scope_country ?? "—"))];
  const comparable = queries.length <= 1 && countries.length <= 1;

  return {
    comparable,
    queries,
    countries,
    note: comparable ? null
      : `รอบเก็บในช่วงนี้ใช้เงื่อนไขต่างกัน (${
          queries.length > 1 ? `คำค้น ${queries.join(" / ")}` : ""
        }${queries.length > 1 && countries.length > 1 ? " · " : ""}${
          countries.length > 1 ? `ประเทศ ${countries.join(" / ")}` : ""
        }) — จำนวนที่ต่างกันระหว่างรอบจึงอาจมาจากขอบเขตการเก็บ ไม่ใช่การเปลี่ยนแปลงของเพจ`,
  };
}
