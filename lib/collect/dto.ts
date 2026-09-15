/**
 * The collection DTO (C13): everything a normal user is allowed to know.
 *
 * Built as an allowlist, in one place, from the columns of the user-safe view —
 * never by taking a `collection_requests` row and deleting the dangerous parts.
 * A field that is forgotten in a deletion list leaks; a field that is forgotten
 * here simply does not appear.
 *
 * Provider identity, provider errors, cost, reservations, leases and settlement
 * internals are absent by construction: the names below are the whole surface,
 * and the read layer selects exactly these columns.
 *
 * Pure: no database, no clock, no environment.
 */

/** The view's columns, and the only ones a normal read path may select. */
export const COLLECTION_VIEW_COLUMNS = [
  "id", "requested_by", "status", "requires_admin", "params", "category_id",
  "dataset_name", "source_url", "provider_item_count", "result", "stop_reason",
  "collection_run_id", "dataset_id", "created_at", "started_at", "finished_at", "updated_at",
] as const;

export type CollectionRequestRow = {
  id: string;
  requested_by: string;
  status: string;
  requires_admin: boolean;
  params: Record<string, unknown> | null;
  category_id: string;
  dataset_name: string | null;
  source_url: string | null;
  provider_item_count: number | null;
  result: Record<string, number> | null;
  stop_reason: string | null;
  collection_run_id: string | null;
  dataset_id: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  updated_at: string | Date;
};

/**
 * What a collection is doing, in the product's own words.
 *
 * These are PT Glory concepts, not the state machine's. `queued`, `starting`,
 * `running`, `provider_start_uncertain`, `settling` and `importing` are
 * implementation states; a person is told that data is being collected, or
 * checked, or processed. Nothing here can grow a provider's name.
 */
export const PRODUCT_STATUSES = [
  "queued", "collecting", "checking", "processing", "needs_admin", "succeeded", "failed",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const LABELS: Record<ProductStatus, string> = {
  queued: "รอคิวเก็บข้อมูล",
  collecting: "กำลังเก็บข้อมูล",
  // The run is identified but its result is still being verified, or the start
  // itself is still being confirmed. Both are "we are checking", never a
  // provider's uncertainty.
  checking: "กำลังตรวจสอบรอบเก็บข้อมูล",
  processing: "กำลังประมวลผล",
  needs_admin: "รอผู้ดูแลระบบตรวจสอบ",
  succeeded: "เสร็จสิ้น",
  failed: "ไม่สามารถเก็บข้อมูลรอบนี้ได้",
};

const STATUS_MAP: Record<string, ProductStatus> = {
  queued: "queued",
  starting: "collecting",
  running: "collecting",
  // Never surfaced as a provider concept: to a person this is a collection
  // being checked, and if it cannot be resolved it becomes an admin review.
  provider_start_uncertain: "checking",
  settling: "checking",
  importing: "processing",
  succeeded: "succeeded",
  failed: "failed",
};

/**
 * A request waiting for a person says so, whatever it was doing. The reason it
 * is waiting is a provider detail and stays server-side.
 */
export function productStatus(status: string, requiresAdmin: boolean): ProductStatus {
  if (requiresAdmin) return "needs_admin";
  return STATUS_MAP[status] ?? "checking";
}

export const statusLabel = (status: ProductStatus): string => LABELS[status];

/** The exact key set of a user-facing collection, in every state. */
export const COLLECTION_DTO_KEYS = [
  "id", "requestedBy", "status", "statusLabel", "requiresAdmin",
  "keyword", "country", "activeStatus", "maxRecords",
  "categoryId", "datasetName", "sourceUrl",
  "itemCount", "result", "stopReason", "datasetId", "collectionRunId",
  "createdAt", "startedAt", "finishedAt", "updatedAt",
] as const;

export type CollectionDto = {
  id: string;
  requestedBy: string;
  status: ProductStatus;
  statusLabel: string;
  requiresAdmin: boolean;
  keyword: string | null;
  country: string | null;
  activeStatus: string | null;
  maxRecords: number | null;
  categoryId: string;
  datasetName: string | null;
  /** PT Glory's own Ad Library search URL. Never a provider's URL. */
  sourceUrl: string | null;
  /** How many ads the collection returned. A count, with no provider in it. */
  itemCount: number | null;
  result: Record<string, number> | null;
  stopReason: string | null;
  datasetId: string | null;
  collectionRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export function toCollectionDto(row: CollectionRequestRow): CollectionDto {
  const params = row.params ?? {};
  const status = productStatus(row.status, row.requires_admin);
  return {
    id: row.id,
    requestedBy: row.requested_by,
    status,
    statusLabel: statusLabel(status),
    requiresAdmin: row.requires_admin,
    keyword: text(params.keyword),
    country: text(params.country),
    activeStatus: text(params.active_status),
    maxRecords: typeof params.max_records === "number" ? params.max_records : null,
    categoryId: row.category_id,
    datasetName: row.dataset_name,
    sourceUrl: row.source_url,
    itemCount: row.provider_item_count,
    result: row.result,
    stopReason: row.stop_reason,
    datasetId: row.dataset_id,
    collectionRunId: row.collection_run_id,
    createdAt: iso(row.created_at) ?? "",
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    updatedAt: iso(row.updated_at) ?? "",
  };
}

// --- what a person may ask for ---------------------------------------------------

export type StartInput = {
  keyword: string;
  country: string;
  activeStatus: "active" | "all";
  maxRecords: number;
  categoryId: string;
  datasetName: string | null;
  requestKey: string;
};

export type ParsedStart =
  | { ok: true; value: StartInput }
  | { ok: false; message: string };

/**
 * The whole input surface, as an allowlist.
 *
 * An actor id, a build, a dataset id, a token, a proxy, a memory size or a
 * price are not collection concepts — they are the server's business, and a
 * body carrying them is simply read for the fields below. Nothing else is
 * looked at, so nothing else can be smuggled through.
 *
 * Every limit that costs money (the record cap against the configured one, the
 * country against the configured list, the category's existence) is decided by
 * admission under its lock. This only rejects what is not a request at all.
 */
export function parseStartInput(body: unknown): ParsedStart {
  if (!body || typeof body !== "object") return { ok: false, message: "body must be JSON" };
  const input = body as Record<string, unknown>;

  const keyword = text(input.keyword);
  if (keyword === null) return { ok: false, message: "keyword is required" };
  const country = text(input.country);
  if (country === null) return { ok: false, message: "country is required" };
  const categoryId = text(input.categoryId);
  if (categoryId === null) return { ok: false, message: "category is required" };
  const requestKey = text(input.requestKey);
  if (requestKey === null) return { ok: false, message: "requestKey is required" };

  const activeStatus = input.activeStatus === "all" ? "all" : "active";
  const maxRecords = input.maxRecords;
  if (typeof maxRecords !== "number" || !Number.isInteger(maxRecords) || maxRecords < 1) {
    return { ok: false, message: "maxRecords must be a positive whole number" };
  }
  const datasetName = text(input.datasetName);

  return {
    ok: true,
    value: { keyword, country, activeStatus, maxRecords, categoryId, datasetName, requestKey },
  };
}

// --- what a person is told when it cannot happen ---------------------------------

export type StartRefusal = "not_configured" | "budget_reached" | "busy" | "invalid_request";

/**
 * Refusals, in product terms.
 *
 * The server's own detail — which setting is unset, how much budget is left,
 * which request is holding the slot — never travels. A person is told what
 * happened and what to do, and nothing about the machinery.
 */
const REFUSALS: Record<StartRefusal, { status: number; code: string; message: string }> = {
  not_configured: {
    status: 409, code: "not_configured",
    message: "ยังไม่ได้เปิดใช้งานการเก็บข้อมูลอัตโนมัติ กรุณาติดต่อผู้ดูแลระบบ",
  },
  budget_reached: {
    status: 409, code: "budget_reached",
    message: "รอบนี้เก็บข้อมูลได้ครบตามที่กำหนดไว้แล้ว กรุณาลองใหม่ในรอบถัดไป",
  },
  busy: {
    status: 409, code: "busy",
    message: "มีการเก็บข้อมูลกำลังทำงานอยู่ กรุณารอให้เสร็จก่อน",
  },
  invalid_request: {
    status: 409, code: "invalid_request",
    message: "คำขอเก็บข้อมูลไม่ถูกต้อง กรุณาตรวจสอบคำค้น ประเทศ และหมวดหมู่",
  },
};

export const refusalResponse = (refusal: StartRefusal) => REFUSALS[refusal];

/**
 * A body that is not a collection request at all.
 *
 * The only 400 on this path, and it happens before admission: nothing has been
 * judged, nothing has been locked, and no request exists to conflict with. Every
 * decision admission itself makes — including the ones about a request that is
 * well-formed but not allowed — is a 409 by reason.
 */
export const malformedBody = (detail: string) => ({
  status: 400,
  code: "invalid_body",
  message: "รูปแบบคำขอไม่ถูกต้อง",
  detail,
});

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
