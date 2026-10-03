import {
  OWNED_CSV_HEADERS, OWNED_METRIC_FIELDS, OWNED_REPORT_SOURCE_LABEL,
  type OwnedAdRow, type OwnedMetricField,
} from "./model.ts";

export const MAX_OWNED_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_OWNED_IMPORT_ROWS = 5000;
export class OwnedImportError extends Error {
  status: 400 | 413;
  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "OwnedImportError";
    this.status = status;
  }
}

export type OwnedAdImport = {
  name: string;
  account_name: string;
  currency: "THB";
  date_start: string;
  date_end: string;
  source_label: string;
  rows: OwnedAdRow[];
};

type CsvColumn = (typeof OWNED_CSV_HEADERS)[number] | "currency" | "date_start" | "date_end";
const ALIASES: Record<CsvColumn, readonly string[]> = {
  ad_id: ["Ad ID", "รหัสโฆษณา"],
  ad_name: ["Ad name", "ชื่อโฆษณา"],
  campaign_name: ["Campaign name", "ชื่อแคมเปญ"],
  adset_name: ["Ad set name", "ชื่อชุดโฆษณา"],
  status: ["Ad delivery", "Delivery status", "สถานะการแสดงโฆษณา", "การแสดงโฆษณา"],
  spend: ["Amount spent", "Amount spent (THB)", "จำนวนเงินที่ใช้จ่าย", "จำนวนเงินที่ใช้จ่าย (THB)", "จำนวนเงินที่ใช้จ่าย (บาท)"],
  impressions: ["Impressions", "อิมเพรสชั่น", "อิมเพรสชัน", "การแสดงผล"],
  // Results and all-click counts have different meanings; they are not link-click aliases.
  clicks: ["Link clicks", "การคลิกลิงก์"],
  conversations: ["Messaging conversations started", "การสนทนาผ่านข้อความที่เริ่มต้น", "การเริ่มการสนทนาผ่านข้อความ"],
  purchases: ["Purchases", "Website purchases", "การซื้อ", "การซื้อบนเว็บไซต์"],
  purchase_value: ["Purchases conversion value", "Purchase conversion value", "Website purchases conversion value", "มูลค่าคอนเวอร์ชั่นของการซื้อ", "มูลค่าคอนเวอร์ชันของการซื้อ", "มูลค่าคอนเวอร์ชั่นของการซื้อบนเว็บไซต์"],
  video_3s: ["3-second video plays", "Video plays at 3 seconds", "การเล่นวิดีโอ 3 วินาที", "จำนวนการเล่นวิดีโอ 3 วินาที"],
  thruplays: ["ThruPlays", "ThruPlay", "จำนวน ThruPlay"],
  creative_url: ["Creative URL", "URL ครีเอทีฟ"],
  destination_url: ["Destination URL", "URL ปลายทาง"],
  currency: ["Currency", "Account currency", "สกุลเงิน", "สกุลเงินของบัญชี"],
  date_start: ["Reporting starts", "Report start", "การรายงานเริ่มต้น"],
  date_end: ["Reporting ends", "Report end", "การรายงานสิ้นสุด"],
};
const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
const HEADER_MAP = new Map<string, CsvColumn>();
for (const [key, aliases] of Object.entries(ALIASES)) {
  HEADER_MAP.set(normalizeHeader(key), key as CsvColumn);
  for (const alias of aliases) HEADER_MAP.set(normalizeHeader(alias), key as CsvColumn);
}

/** RFC-style quoting, including escaped quotes and newlines inside one field. */
export function parseOwnedCsv(csv: string): string[][] {
  if (new TextEncoder().encode(csv).byteLength > MAX_OWNED_IMPORT_BYTES) {
    throw new OwnedImportError("ไฟล์ CSV ต้องมีขนาดไม่เกิน 5 MiB", 413);
  }
  const input = csv.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const pushField = () => { row.push(field); field = ""; state = "plain"; };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_OWNED_IMPORT_ROWS + 1) {
      throw new OwnedImportError("รายงานต้องมีโฆษณาไม่เกิน 5,000 รายการ", 413);
    }
  };
  for (let i = 0; i < input.length; i += 1) {
    const character = input[i];
    if (state === "quoted") {
      if (character === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else state = "closed";
      } else field += character;
      continue;
    }
    if (character === ",") { pushField(); continue; }
    if (character === "\r" || character === "\n") {
      pushRow();
      if (character === "\r" && input[i + 1] === "\n") i += 1;
      continue;
    }
    if (state === "closed") throw new OwnedImportError("CSV มีข้อความหลังเครื่องหมายปิดคำพูด");
    if (character === '"') {
      if (field !== "") throw new OwnedImportError("CSV มีเครื่องหมายคำพูดในช่องที่ไม่ได้ครอบคำพูด");
      state = "quoted";
    } else field += character;
  }
  if (state === "quoted") throw new OwnedImportError("CSV มีช่องที่ยังไม่ปิดเครื่องหมายคำพูด");
  if (row.length > 0 || field !== "" || state === "closed") pushRow();
  return rows;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > max) {
    throw new OwnedImportError(`${label} ต้องมีข้อความไม่เกิน ${max} ตัวอักษร`);
  }
  return value.trim();
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OwnedImportError(`${label} ต้องเป็นวันที่ YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new OwnedImportError(`${label} เป็นวันที่ไม่ถูกต้อง`);
  }
  return value;
}

function optionalText(value: string | undefined, label: string, max: number): string | null {
  if (value === undefined || value.trim() === "") return null;
  return requiredText(value, label, max);
}

const COUNT_FIELDS = new Set<OwnedMetricField>(["impressions", "clicks", "conversations", "video_3s", "thruplays"]);
function metric(value: string | undefined, key: OwnedMetricField, line: number): number | null {
  const text = value?.trim() ?? "";
  if (text === "" || ["-", "—", "n/a", "null"].includes(text.toLowerCase())) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
    throw new OwnedImportError(`แถว ${line}: ${key} ต้องเป็นตัวเลขที่ไม่ติดลบ หรือเว้นว่างเมื่อไม่มีข้อมูล`);
  }
  const number = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(number) || number > Number.MAX_SAFE_INTEGER || (COUNT_FIELDS.has(key) && !Number.isSafeInteger(number))) {
    throw new OwnedImportError(`แถว ${line}: ${key} เป็นตัวเลขที่ไม่ถูกต้อง`);
  }
  return number;
}

function link(value: string | undefined, key: string, line: number): string | null {
  const text = optionalText(value, key, 2048);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid protocol");
  } catch {
    throw new OwnedImportError(`แถว ${line}: ${key} ต้องเป็น URL แบบ http หรือ https`);
  }
  return text;
}

export function parseOwnedAdImport(input: unknown): OwnedAdImport {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OwnedImportError("ข้อมูลรายงานไม่ถูกต้อง");
  const body = input as Record<string, unknown>;
  const name = requiredText(body.name, "ชื่อรายงาน", 200);
  const account_name = requiredText(body.account_name, "ชื่อบัญชีโฆษณา", 200);
  if (body.currency !== "THB") throw new OwnedImportError("รองรับเฉพาะรายงานสกุลเงิน THB");
  const date_start = isoDate(body.date_start, "วันเริ่มต้น");
  const date_end = isoDate(body.date_end, "วันสิ้นสุด");
  if (date_start > date_end) throw new OwnedImportError("วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น");
  if (typeof body.csv !== "string") throw new OwnedImportError("กรุณาระบุ CSV ของรายงาน");
  const [headers, ...records] = parseOwnedCsv(body.csv);
  if (!headers || records.length === 0) throw new OwnedImportError("CSV ต้องมีหัวตารางและโฆษณาอย่างน้อยหนึ่งรายการ");
  const columns = new Map<CsvColumn, number>();
  const seenHeaders = new Set<string>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized || seenHeaders.has(normalized)) throw new OwnedImportError("CSV มีหัวตารางว่างหรือซ้ำ");
    seenHeaders.add(normalized);
    const key = HEADER_MAP.get(normalized);
    if (key) {
      if (columns.has(key)) throw new OwnedImportError(`CSV มีหลายคอลัมน์ที่หมายถึง ${key} กรุณาเลือกคอลัมน์เดียว`);
      columns.set(key, index);
    } else if (/^(amount spent|จำนวนเงินที่ใช้จ่าย)\s*\(/i.test(normalized)) {
      throw new OwnedImportError("คอลัมน์จำนวนเงินระบุสกุลเงินที่ยังไม่รองรับ กรุณาใช้ THB");
    }
  });
  for (const field of ["ad_id", "ad_name", "campaign_name"] as const) {
    if (!columns.has(field)) throw new OwnedImportError(`CSV ต้องมีคอลัมน์ ${field}`);
  }
  const seenIds = new Set<string>();
  const rows = records.map((record, index): OwnedAdRow => {
    const line = index + 2;
    if (record.length !== headers.length) throw new OwnedImportError(`แถว ${line}: จำนวนช่องไม่ตรงกับหัวตาราง`);
    const get = (key: CsvColumn) => {
      const position = columns.get(key);
      return position === undefined ? undefined : record[position];
    };
    const ad_id = requiredText(get("ad_id"), `แถว ${line}: ad_id`, 32);
    if (!/^\d{1,32}$/.test(ad_id)) throw new OwnedImportError(`แถว ${line}: ad_id ต้องเป็นรหัสตัวเลขของโฆษณา`);
    if (seenIds.has(ad_id)) throw new OwnedImportError(`แถว ${line}: ad_id ซ้ำ รายงานต้องรวมแต่ละโฆษณาเป็นหนึ่งแถวก่อนนำเข้า`);
    seenIds.add(ad_id);
    const rowCurrency = get("currency")?.trim();
    if (rowCurrency && rowCurrency !== "THB") throw new OwnedImportError(`แถว ${line}: สกุลเงินต้องเป็น THB`);
    for (const [key, expected] of [["date_start", date_start], ["date_end", date_end]] as const) {
      const value = get(key)?.trim();
      if (value && isoDate(value, `แถว ${line}: ${key}`) !== expected) {
        throw new OwnedImportError(`แถว ${line}: ช่วงวันที่ใน CSV ไม่ตรงกับช่วงวันที่รายงาน`);
      }
    }
    const amounts = Object.fromEntries(OWNED_METRIC_FIELDS.map((key) => [key, metric(get(key), key, line)])) as Record<OwnedMetricField, number | null>;
    return {
      ad_id,
      ad_name: requiredText(get("ad_name"), `แถว ${line}: ad_name`, 500),
      campaign_name: requiredText(get("campaign_name"), `แถว ${line}: campaign_name`, 500),
      adset_name: optionalText(get("adset_name"), "adset_name", 500),
      status: optionalText(get("status"), "status", 100),
      ...amounts,
      creative_url: link(get("creative_url"), "creative_url", line),
      destination_url: link(get("destination_url"), "destination_url", line),
    };
  });
  return { name, account_name, currency: "THB", date_start, date_end, source_label: OWNED_REPORT_SOURCE_LABEL, rows };
}

/** Enforces the byte ceiling even when Content-Length is absent or misleading. */
export async function readOwnedImportRequest(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_OWNED_IMPORT_BYTES) {
    throw new OwnedImportError("รายงานต้องมีขนาดไม่เกิน 5 MiB", 413);
  }
  if (!request.body) throw new OwnedImportError("กรุณาระบุข้อมูลรายงาน");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_OWNED_IMPORT_BYTES) {
        await reader.cancel();
        throw new OwnedImportError("รายงานต้องมีขนาดไม่เกิน 5 MiB", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof OwnedImportError) throw error;
    throw new OwnedImportError("ข้อมูลรายงานต้องเป็น JSON ที่ถูกต้อง");
  } finally {
    reader.releaseLock();
  }
}
