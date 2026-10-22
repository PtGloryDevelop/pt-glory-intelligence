/**
 * The summary at the top of a rival page: what it runs now, the offers written in its copy, how often
 * it starts new ads, and which of our units the team matched it to.
 *
 * Every figure is a count of stored ads or of fixed text patterns found in their stored copy. Nothing
 * here says how well an ad sells: Ad Library carries no spend, reach or sales.
 */

type Copy = { title: string | null; body_text: string | null };

export type OfferHit = { label: string; ads: number };
export type PriceHit = { baht: number; ads: number };
/** `readable` is the denominator: ads that had any copy to read. */
export type OfferSummary = { readable: number; offers: OfferHit[]; prices: PriceHit[] };

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d{2,6})`;
// Each rule names what it found; a buy-X-get-Y keeps its own numbers, so "1 แถม 1" and "2 แถม 1" stay apart.
const RULES: [RegExp, (match: RegExpExecArray) => string][] = [
  [/(\d{1,2})\s*แถม\s*(\d{1,2})/g, (m) => `${m[1]} แถม ${m[2]}`],
  [/ลด(?:ราคา)?\s*(\d{1,2})\s*%/g, (m) => `ลด ${m[1]}%`],
  [/ส่งฟรี|ฟรีค่า(?:จัด)?ส่ง/g, () => "ส่งฟรี"],
  [/เก็บเงินปลายทาง|เก็บปลายทาง|(?:ชำระ|จ่าย)(?:เงิน)?ปลายทาง|\bCOD\b/gi, () => "เก็บเงินปลายทาง"],
  [/แถมฟรี|ของแถม/g, () => "มีของแถม"],
];
// Amounts in baht written in the copy: "390 บาท", "750.-", "฿390", "ราคา 390".
const PRICES = [
  new RegExp(`${NUMBER}\\s*(?:บาท|฿|\\.-)`, "g"),
  new RegExp(`฿\\s*${NUMBER}`, "g"),
  new RegExp(`ราคา\\s*(?:เพียง|แค่|พิเศษ|เหลือ)?\\s*${NUMBER}`, "g"),
];

const text = (ad: Copy) => [ad.title, ad.body_text].filter(Boolean).join("\n").trim();

/** What one ad's copy offers: the offer labels and baht amounts in it, or null when it has no copy. */
function readCopy(ad: Copy): { offers: Set<string>; amounts: Set<number> } | null {
  const copy = text(ad);
  if (!copy) return null;
  const offers = new Set<string>(), amounts = new Set<number>();
  for (const [pattern, label] of RULES) for (const match of copy.matchAll(pattern)) offers.add(label(match as RegExpExecArray));
  for (const pattern of PRICES) for (const match of copy.matchAll(pattern)) {
    const baht = Number(match[1].replaceAll(",", ""));
    if (baht >= 10 && baht <= 100_000) amounts.add(baht);
  }
  return { offers, amounts };
}

/** Offers and baht amounts found in the copy, each counted once per ad. */
export function offerSignals(ads: Copy[]): OfferSummary {
  const offers = new Map<string, number>(), prices = new Map<number, number>();
  let readable = 0;
  for (const ad of ads) {
    const found = readCopy(ad);
    if (!found) continue;
    readable++;
    for (const label of found.offers) offers.set(label, (offers.get(label) ?? 0) + 1);
    for (const baht of found.amounts) prices.set(baht, (prices.get(baht) ?? 0) + 1);
  }
  const ranked = <K,>(map: Map<K, number>) => [...map].sort((a, b) => b[1] - a[1]);
  return {
    readable,
    offers: ranked(offers).slice(0, 5).map(([label, n]) => ({ label, ads: n })),
    prices: ranked(prices).slice(0, 3).map(([baht, n]) => ({ baht, ads: n })),
  };
}

export type OfferChange = { previousAt: string; previousAds: number; latestAt: string; latestAds: number; added: string[]; gone: string[] };

/**
 * Offers and amounts written in the running ads of the latest round, against the round before it.
 * "gone" means the latest round's ads did not carry it, not that the page stopped offering it: a round
 * sees only what its search returned. Null until two rounds have seen the page.
 */
export function offerChange(rows: (Copy & { collection_run_id: string; collected_at: string })[]): OfferChange | null {
  const rounds = new Map<string, { at: string; ads: number; labels: Set<string> }>();
  for (const row of rows) {
    const round = rounds.get(row.collection_run_id) ?? { at: row.collected_at, ads: 0, labels: new Set<string>() };
    rounds.set(row.collection_run_id, round);
    const found = readCopy(row);
    if (!found) continue;
    round.ads++;
    for (const label of found.offers) round.labels.add(label);
    for (const baht of found.amounts) round.labels.add(`${baht.toLocaleString("th-TH")} บาท`);
  }
  const [latest, previous] = [...rounds.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!latest || !previous) return null;
  // Offers first in the order found, then amounts cheapest first, as the offers table reads.
  const baht = (label: string) => label.endsWith(" บาท") ? Number(label.slice(0, -4).replaceAll(",", "")) : -1;
  const order = (labels: string[]) => labels.sort((a, b) => (baht(a) < 0 && baht(b) < 0 ? 0 : baht(a) - baht(b)));
  return {
    previousAt: previous.at, previousAds: previous.ads, latestAt: latest.at, latestAds: latest.ads,
    added: order([...latest.labels].filter((label) => !previous.labels.has(label))),
    gone: order([...previous.labels].filter((label) => !latest.labels.has(label))),
  };
}

export type WeekCount = { weekStart: string; started: number; current: boolean };
export type LaunchPace = { weeks: WeekCount[]; average: number | null };

const DAY = 86_400_000;
/** Monday of the week holding `time`, as the database's date_trunc('week') sees it (UTC). */
export function weekStartOf(time: number): string {
  const day = new Date(time);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - offset * DAY).toISOString().slice(0, 10);
}

/**
 * New ads per week by Meta's start date, for the last `weeks` weeks ending with this one.
 * The average covers the finished weeks only; this week is still counting.
 */
export function launchPace(points: { bucket_start: string; started_ads: number }[], now = Date.now(), weeks = 4): LaunchPace {
  const byWeek = new Map(points.map((point) => [point.bucket_start.slice(0, 10), Number(point.started_ads)]));
  const current = weekStartOf(now);
  const list = Array.from({ length: weeks }, (_, index) => {
    const weekStart = new Date(Date.parse(current) - (weeks - 1 - index) * 7 * DAY).toISOString().slice(0, 10);
    return { weekStart, started: byWeek.get(weekStart) ?? 0, current: weekStart === current };
  });
  const done = list.filter((week) => !week.current);
  return { weeks: list, average: done.length ? done.reduce((sum, week) => sum + week.started, 0) / done.length : null };
}

/** Where the timeline read for the pace starts: five weeks back covers the four weeks shown. */
export const paceWindowStart = (now = Date.now()) => new Date(now - 35 * DAY).toISOString();

/** The active ad Meta groups the most ads under (collation_count), when any creative is shared at all. */
export function mostReused<T extends { collation_count: number | null }>(ads: T[]): T | null {
  let best: T | null = null;
  for (const ad of ads) if ((ad.collation_count ?? 0) > 1 && (ad.collation_count ?? 0) > (best?.collation_count ?? 0)) best = ad;
  return best;
}
