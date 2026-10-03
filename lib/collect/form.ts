import { ABSOLUTE_MAX_RECORDS } from "./limits.ts";

/**
 * What the collection form offers, and how it words it (C15).
 *
 * Pure on purpose: the form is a client component, so everything it imports
 * ends up in the browser. The settings behind it are read on the server, in
 * `form-settings.ts`, which is where the database belongs.
 */

export type CollectorFormSettings = {
  enabled: boolean;
  countries: string[];
  maxRecordsPerRun: number | null;
};

/** The cap the request path itself refuses above, so the form cannot offer more. */
export const FORM_MAX_RECORDS = ABSOLUTE_MAX_RECORDS;

/** The country names a person reads. A code nobody has named stays the code. */
const COUNTRY_NAMES: Record<string, string> = {
  TH: "ไทย",
  SG: "สิงคโปร์",
  MY: "มาเลเซีย",
  VN: "เวียดนาม",
  ID: "อินโดนีเซีย",
  PH: "ฟิลิปปินส์",
};

export const countryLabel = (code: string): string => COUNTRY_NAMES[code] ?? code;

/**
 * The dataset name the form starts with: `{keyword} · {country} · {Thai date}`.
 *
 * A suggestion, not a decision — the person may rewrite it, and admission owns
 * what is finally stored. The shapes match so an untouched suggestion and the
 * name admission would have generated say the same thing.
 */
export function suggestedDatasetName(keyword: string, country: string, now = new Date()): string {
  const day = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" })
    .format(now);
  const trimmed = keyword.trim().replace(/\s+/gu, " ");
  return `${trimmed} · ${countryLabel(country)} · ${day}`.slice(0, 200);
}
