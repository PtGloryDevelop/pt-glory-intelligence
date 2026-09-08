import { tierFor, type QualityTier } from "../collector/coverage.ts";

export type CoverageTier = QualityTier | "unknown";

/**
 * How a distribution is allowed to be described, given how much of the field
 * was readable.
 *
 * The rule this encodes is the whole reason the module exists: a share computed
 * over 60% of a page's ads is a fact about those ads, not about the page. Both
 * sentences are true; only one of them is defensible. Rather than leave the
 * wording to whoever builds the next surface, the sentence is derived from the
 * denominator here and used everywhere.
 */
export type Coverage = {
  covered: number;
  observed: number;
  ratio: number;
  tier: CoverageTier;
  /** True only when the readable subset is large enough to speak for the whole. */
  representative: boolean;
  /** "อ่านค่าได้ 57 / 61" — the pair, never a bare percentage. */
  pair: string;
  /** The clause a heading may use in front of a distribution. */
  qualifier: string;
};

export function coverageOf(covered: number, observed: number): Coverage {
  if (observed <= 0) {
    return {
      covered: 0, observed: 0, ratio: 0, tier: "unknown", representative: false,
      pair: "ไม่มีข้อมูล",
      qualifier: "ยังไม่มีโฆษณาในขอบเขตนี้",
    };
  }

  const ratio = covered / observed;
  const tier = tierFor(ratio);
  // 80% is the same threshold the dataset quality strip uses. Below it, the
  // subset speaks for itself and nothing more.
  const representative = tier === "normal";

  return {
    covered, observed, ratio, tier, representative,
    pair: `อ่านค่าได้ ${covered.toLocaleString("th-TH")} / ${observed.toLocaleString("th-TH")}`,
    qualifier: representative
      ? `จากโฆษณา ${observed.toLocaleString("th-TH")} รายการ`
      : `เฉพาะในโฆษณาที่อ่านค่าได้ ${covered.toLocaleString("th-TH")} รายการ ไม่ใช่ทั้งเพจ`,
  };
}

/**
 * The percentage of a distribution row, against the denominator that row was
 * actually computed over.
 *
 * A multi-value dimension is divided by the ads observed, because an ad may
 * appear under several platforms; the shares then legitimately exceed 100% and
 * the caller must not present them as slices of a whole.
 */
export function share(n: number, denominator: number): number {
  return denominator <= 0 ? 0 : (n / denominator) * 100;
}

export function formatShare(n: number, denominator: number): string {
  return `${share(n, denominator).toFixed(1)}%`;
}
