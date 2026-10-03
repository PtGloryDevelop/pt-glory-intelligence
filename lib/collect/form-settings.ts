import { withTransaction } from "../db/privileged.ts";
import { FORM_MAX_RECORDS, type CollectorFormSettings } from "./form.ts";

/**
 * The settings the collection form is allowed to offer.
 *
 * Server-side: this reads the database, and the form that renders it is a
 * client component. Admission checks all of it again under its lock — what is
 * here is what a person sees, never what is enforced.
 */
export async function collectorFormSettings(): Promise<CollectorFormSettings> {
  const { rows } = await withTransaction((client) => client.query<{ key: string; value: unknown }>(
    `select key, value from public.app_settings
      where key in ('collector.enabled', 'collector.countries', 'collector.max_records_per_run')`,
  ));
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const countries = settings.get("collector.countries");
  const cap = settings.get("collector.max_records_per_run");

  return {
    enabled: settings.get("collector.enabled") === true,
    countries: Array.isArray(countries)
      ? countries.filter((entry): entry is string => typeof entry === "string")
      : [],
    maxRecordsPerRun: typeof cap === "number" && Number.isInteger(cap) && cap > 0
      ? Math.min(cap, FORM_MAX_RECORDS)
      : null,
  };
}
