/**
 * Coverage-tier rules shared by the dataset chip and the quality strip.
 *
 * Plain TypeScript rather than part of the component, so the rules can be tested
 * without a DOM — and so there is one definition of "unknown" instead of one per
 * surface that renders it.
 */

export type Tier = "normal" | "partial" | "low" | "unknown";

/**
 * Reading order from the handoff: Copy, CTA, Title, Destination, Platform,
 * Page Data. Anything not listed keeps its alphabetical place after these.
 */
export const PRIORITY_FIELDS = [
  "body_text", "caption",
  "cta_type", "cta_text",
  "title",
  "link_url", "link_description",
  "publisher_platform",
  "page_name", "page_categories", "page_like_count",
];

export function fieldRank(field: string): number {
  const index = PRIORITY_FIELDS.indexOf(field);
  return index === -1 ? PRIORITY_FIELDS.length : index;
}

/**
 * The single quality chip for a dataset: the worst tier present, never an
 * average. Averaging coverage across fields would invent a number that
 * describes no field.
 *
 * No rows at all means nobody measured this dataset — 'unknown'. It is not a
 * clean bill of health and it is not a bad one.
 */
export function worstTier(rows: { tier: string }[]): Tier {
  if (rows.length === 0) return "unknown";
  if (rows.some((row) => row.tier === "low")) return "low";
  if (rows.some((row) => row.tier === "partial")) return "partial";
  if (rows.every((row) => row.tier === "normal")) return "normal";
  // A tier the database does not define is not silently treated as clean.
  return "unknown";
}
