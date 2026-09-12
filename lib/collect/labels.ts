/**
 * Provenance as normal product surfaces state it (C03).
 *
 * Ordinary pages describe what a collection is — an automated search, or a file
 * somebody imported — and never which collector or provider produced it. That
 * holds for every role: an admin reading the dataset list is reading the same
 * product screen as an analyst, and the screen has no reason to name a
 * provider. Raw collector and provider values belong to the explicit admin
 * diagnostic and recovery surfaces the Phase 15 design defines, which read the
 * columns directly rather than coming through here.
 *
 * The labels are applied on the server, before the value is serialized: hiding
 * a field in the UI would still ship it in the page payload or the JSON body.
 *
 * Deliberately role-free. A role check here would be an exemption that quietly
 * puts provider names back on ordinary screens for whoever holds the role.
 */

const METHOD_LABELS: Record<string, string> = {
  // Collected automatically by the server, whichever provider performs it.
  apify_actor_run: "เก็บข้อมูลอัตโนมัติ",
  socialapis_api: "เก็บข้อมูลอัตโนมัติ",
  // Collected by a person, then imported as a file.
  network_response_observation: "นำเข้าจากไฟล์",
  user_initiated_dom_observation: "นำเข้าจากไฟล์",
};

/** A method with no wording yet says so, rather than leaking its name. */
export const UNKNOWN_METHOD_LABEL = "ไม่ระบุวิธีเก็บ";
export const NEUTRAL_SOURCE_PRODUCT = "PT Glory";

export function collectionMethodLabel(method: string | null | undefined): string {
  return (method ? METHOD_LABELS[method] : null) ?? UNKNOWN_METHOD_LABEL;
}

type SnakeProvenance = { collection_method?: string; source_product?: string };
type CamelProvenance = { collectionMethod?: string; sourceProduct?: string };

export function labelProvenance<T extends SnakeProvenance>(row: T): T {
  const labelled = { ...row } as T & SnakeProvenance;
  if (typeof labelled.collection_method === "string") {
    labelled.collection_method = collectionMethodLabel(labelled.collection_method);
  }
  if (typeof labelled.source_product === "string") {
    labelled.source_product = NEUTRAL_SOURCE_PRODUCT;
  }
  return labelled;
}

export function labelProvenanceRows<T extends SnakeProvenance>(rows: T[]): T[] {
  return rows.map((row) => labelProvenance(row));
}

/** The import preview speaks camelCase; same rule, same server boundary. */
export function labelScope<T extends CamelProvenance>(scope: T): T {
  const labelled = { ...scope } as T & CamelProvenance;
  if (typeof labelled.collectionMethod === "string") {
    labelled.collectionMethod = collectionMethodLabel(labelled.collectionMethod);
  }
  if (typeof labelled.sourceProduct === "string") {
    labelled.sourceProduct = NEUTRAL_SOURCE_PRODUCT;
  }
  return labelled;
}
