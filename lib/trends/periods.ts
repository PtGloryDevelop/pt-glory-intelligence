/**
 * The two windows a trend compares, and the arithmetic between them.
 *
 * Everything here is deliberately small and deterministic. A trend in this
 * product is the difference between two counts over two equal windows — not a
 * forecast, not a significance test, and not an explanation of why the numbers
 * differ. The wording is built here so no surface has to invent it.
 *
 * WINDOWS ARE ABSOLUTE INSTANTS. `first_seen_at`, `start_date` and
 * `collected_at` are all `timestamptz`, so a window is N×24h measured back from
 * one reference instant, half-open on both ends: [from, to). No calendar
 * arithmetic, no local midnight, and therefore nothing that shifts when the
 * server's timezone does — the display formatter turns the instants into Thai
 * dates, and only the display is localised.
 */

const DAY = 86_400_000;

export const PERIOD_LENGTHS = [7, 14, 30] as const;
export type PeriodLength = (typeof PERIOD_LENGTHS)[number];
export const DEFAULT_PERIOD: PeriodLength = 30;

export function periodLength(raw: string | null | undefined): PeriodLength {
  const parsed = Number(raw);
  return (PERIOD_LENGTHS as readonly number[]).includes(parsed)
    ? (parsed as PeriodLength)
    : DEFAULT_PERIOD;
}

export type Window = { from: string; to: string };
export type TrendPeriods = { days: PeriodLength; current: Window; previous: Window };

/**
 * Two equal, adjacent, half-open windows ending at the reference instant.
 *
 *   previous            current
 *   [ref-2N, ref-N) → [ref-N, ref)
 *
 * Equal length is not a nicety: comparing 30 days against 14 would produce a
 * "fall" that is only a shorter window, which is the most plausible-looking way
 * this screen could lie.
 */
export function trendPeriods(days: PeriodLength, reference = new Date()): TrendPeriods {
  const to = reference.getTime();
  const currentFrom = to - days * DAY;
  const previousFrom = currentFrom - days * DAY;
  return {
    days,
    current: { from: new Date(currentFrom).toISOString(), to: new Date(to).toISOString() },
    previous: {
      from: new Date(previousFrom).toISOString(),
      to: new Date(currentFrom).toISOString(),
    },
  };
}

/* ------------------------------------------------------------- arithmetic */

export type Change = {
  current: number;
  previous: number;
  delta: number;
  direction: "up" | "down" | "flat";
  /** Null when there is no previous base to divide by. */
  percent: number | null;
  /** True when the previous window is too small for a percentage to mean much. */
  lowBase: boolean;
  label: string;
};

/** Below this, a percentage swings wildly on one or two ads. */
export const LOW_BASE = 5;

/**
 * The difference between two counts, in words that stay arithmetic.
 *
 * A percentage from a base of zero is not "+∞%", it is not a percentage at all,
 * and the honest sentence is the raw one: "จาก 0 เป็น 5". The same goes for a
 * base of two — technically +150%, practically noise — so the raw delta leads
 * and the percentage is marked as resting on a small base.
 */
export function changeOf(current: number, previous: number): Change {
  const delta = current - previous;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const lowBase = previous < LOW_BASE;
  const percent = previous === 0 ? null : (delta / previous) * 100;

  const label =
    delta === 0 ? "ไม่เปลี่ยนจากช่วงก่อน"
    : previous === 0 ? `จาก 0 เป็น ${current.toLocaleString("th-TH")} ในข้อมูลที่เราพบ`
    : delta > 0 ? `มากกว่าช่วงก่อน ${delta.toLocaleString("th-TH")} รายการ ในข้อมูลที่เราพบ`
    : `น้อยกว่าช่วงก่อน ${Math.abs(delta).toLocaleString("th-TH")} รายการ ในข้อมูลที่เราพบ`;

  return { current, previous, delta, direction, percent, lowBase, label };
}

/**
 * What a period with no collection is called, everywhere.
 *
 * A share of 0.0% and a delta of +42.0 pp both LOOK measured. Neither is, when
 * the period behind them was never collected: there is no denominator, so there
 * is no share, so there is no movement between shares. Screens print this
 * instead, and the word is defined once so two of them cannot disagree.
 */
export const NOT_COLLECTED = "ไม่ได้เก็บ";

/** An arrow, so direction is never carried by colour alone. */
export const DIRECTION_MARK: Record<Change["direction"], string> = {
  up: "▲", down: "▼", flat: "—",
};

/**
 * The difference between two shares, in percentage points.
 *
 * A share that moves from 40% to 55% has risen 15 points, not 37.5%. Both are
 * arithmetically true and only one is what a reader means, so the unit is in
 * the returned string rather than left to the caller.
 */
export function pointChange(currentShare: number, previousShare: number): {
  points: number;
  label: string;
} {
  const points = currentShare - previousShare;
  if (Math.abs(points) < 0.05) return { points: 0, label: "ไม่เปลี่ยน" };
  return {
    points,
    label: `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pp`,
  };
}

export function share(n: number, denominator: number): number {
  return denominator <= 0 ? 0 : (n / denominator) * 100;
}

/* ---------------------------------------------------------- comparability */

export type PeriodContext = {
  scope_query: string | null;
  scope_country: string | null;
};

export type Comparability = {
  verdict: "comparable" | "mixed" | "insufficient";
  label: string;
  note: string | null;
};

/**
 * Whether two periods were collected comparably enough to be put side by side.
 *
 * Three deterministic verdicts, no score. A period with no collection at all
 * cannot be compared with anything — and "we did not look" must never render as
 * "there was nothing", which is the single most misleading thing a trend screen
 * can do.
 */
export function comparabilityOf(
  current: PeriodContext[],
  previous: PeriodContext[],
): Comparability {
  if (current.length === 0 || previous.length === 0) {
    return {
      verdict: "insufficient",
      label: "ข้อมูลไม่พอเปรียบเทียบ",
      note: current.length === 0
        ? "ช่วงล่าสุดยังไม่มีรอบเก็บข้อมูลในขอบเขตนี้ — ตัวเลขที่เห็นไม่ได้แปลว่าไม่มีโฆษณา แต่แปลว่าเรายังไม่ได้เก็บ"
        : "ช่วงก่อนหน้าไม่มีรอบเก็บข้อมูลในขอบเขตนี้ — เทียบกับศูนย์ในที่นี้คือ “ยังไม่ได้เก็บ” ไม่ใช่ “ไม่มีโฆษณา”",
    };
  }

  const values = (rows: PeriodContext[], key: keyof PeriodContext) =>
    [...new Set(rows.map((row) => row[key] ?? "—"))];
  const queries = new Set([...values(current, "scope_query"), ...values(previous, "scope_query")]);
  const countries = new Set([
    ...values(current, "scope_country"), ...values(previous, "scope_country"),
  ]);

  if (queries.size <= 1 && countries.size <= 1) {
    return { verdict: "comparable", label: "บริบทการเก็บใกล้เคียงกัน", note: null };
  }

  const parts = [
    queries.size > 1 ? `คำค้น ${[...queries].join(" / ")}` : "",
    countries.size > 1 ? `ประเทศ ${[...countries].join(" / ")}` : "",
  ].filter(Boolean);

  return {
    verdict: "mixed",
    label: "บริบทการเก็บต่างกัน",
    note: `สองช่วงนี้มาจากบริบทการเก็บข้อมูลต่างกัน (${parts.join(" · ")}) — ` +
      "การเปลี่ยนแปลงอาจสะท้อนวิธีเก็บ ไม่ใช่พฤติกรรมของเพจหรือของตลาด",
  };
}
