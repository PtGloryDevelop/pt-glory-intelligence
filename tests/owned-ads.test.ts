import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_OWNED_IMPORT_BYTES, MAX_OWNED_IMPORT_ROWS, OwnedImportError,
  parseOwnedAdImport, parseOwnedCsv, readOwnedImportRequest,
} from "../lib/owned-ads/import.ts";
import {
  OWNED_CSV_HEADERS, OWNED_CSV_TEMPLATE, OWNED_REPORT_SOURCE_LABEL,
  summarizeOwnedReport, type OwnedAdRow,
} from "../lib/owned-ads/model.ts";

const metadata = {
  name: "September report", account_name: "Company account", currency: "THB",
  date_start: "2026-09-01", date_end: "2026-09-28",
};
const minimalCsv = "ad_id,ad_name,campaign_name\n123,Serum video,September";
const imported = (csv: string) => parseOwnedAdImport({ ...metadata, csv });

function row(values: Partial<OwnedAdRow> = {}): OwnedAdRow {
  return {
    ad_id: "123", ad_name: "Serum video", campaign_name: "September", adset_name: null,
    status: null, spend: null, impressions: null, clicks: null, conversations: null,
    purchases: null, purchase_value: null, video_3s: null, thruplays: null,
    creative_url: null, destination_url: null, ...values,
  };
}

test("CSV template contains the canonical headers and no fabricated ad row", () => {
  assert.deepEqual(parseOwnedCsv(OWNED_CSV_TEMPLATE), [[...OWNED_CSV_HEADERS]]);
});

test("CSV handles BOM, Thai text, quoted commas, escaped quotes, newlines, CRLF and trailing blank lines", () => {
  const csv = '\uFEFFAd ID,Ad name,Campaign name,Amount spent (THB)\r\n123,"เซรั่ม, \"\"ดี\"\"\nสองบรรทัด",กันยายน,"1,234.50"\r\n\r\n';
  const report = imported(csv);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].ad_name, 'เซรั่ม, "ดี"\nสองบรรทัด');
  assert.equal(report.rows[0].spend, 1234.5);
  assert.equal(report.source_label, OWNED_REPORT_SOURCE_LABEL);
});

test("missing fields and explicit unavailable values remain null, while a reported zero stays zero", () => {
  const report = imported("ad_id,ad_name,campaign_name,spend,conversations,purchases,purchase_value\n123,Video,September,0,—,-,N/A");
  assert.equal(report.rows[0].spend, 0);
  assert.equal(report.rows[0].clicks, null);
  assert.equal(report.rows[0].impressions, null);
  assert.equal(report.rows[0].conversations, null);
  assert.equal(report.rows[0].purchases, null);
  assert.equal(report.rows[0].purchase_value, null);
  assert.equal(summarizeOwnedReport(report.rows).spend.value, 0);
  assert.equal(summarizeOwnedReport(report.rows).purchase_value.value, null);
});

test("practical Thai export columns map without treating generic Results or all clicks as link clicks", () => {
  const report = imported("รหัสโฆษณา,ชื่อโฆษณา,ชื่อแคมเปญ,จำนวนเงินที่ใช้จ่าย (THB),การคลิกลิงก์,การสนทนาผ่านข้อความที่เริ่มต้น,มูลค่าคอนเวอร์ชั่นของการซื้อ,การเล่นวิดีโอ 3 วินาที,ThruPlays,Results,Clicks (all)\n123,วิดีโอ,กันยายน,100,10,2,300,90,30,999,999");
  assert.equal(report.rows[0].clicks, 10);
  assert.equal(report.rows[0].conversations, 2);
  assert.equal(report.rows[0].purchase_value, 300);
  assert.equal(report.rows[0].video_3s, 90);
  assert.equal(report.rows[0].thruplays, 30);
  const ambiguous = imported("ad_id,ad_name,campaign_name,Results,Clicks (all)\n123,Video,September,20,100");
  assert.equal(ambiguous.rows[0].conversations, null);
  assert.equal(ambiguous.rows[0].clicks, null);
});

test("duplicate ad IDs and overlapping alias columns are rejected before any insert", () => {
  assert.throws(() => imported(`${minimalCsv}\n123,Another video,September`), /ad_id ซ้ำ/);
  assert.throws(() => imported("ad_id,ad_name,campaign_name,spend,Amount spent (THB)\n123,Video,September,10,10"), /หลายคอลัมน์/);
  assert.throws(() => imported("ad_id,Ad ID,ad_name,campaign_name\n123,123,Video,September"), /หลายคอลัมน์/);
});

test("malformed quoting, extra cells and missing required fields are rejected", () => {
  for (const csv of [
    'ad_id,ad_name,campaign_name\n123,"unclosed,September',
    'ad_id,ad_name,campaign_name\n123,un"quoted,September',
    'ad_id,ad_name,campaign_name\n123,"closed"extra,September',
    "ad_id,ad_name,campaign_name\n123,Video,September,extra",
    "ad_id,ad_name,campaign_name\n123,Video",
    "ad_name,campaign_name\nVideo,September",
    "ad_id,ad_name,campaign_name\n123,,September",
    "ad_id,ad_name,campaign_name\nnot-a-meta-id,Video,September",
    "ad_id,ad_name,campaign_name",
    "",
  ]) assert.throws(() => imported(csv), OwnedImportError);
});

test("invalid amounts cannot be silently converted into zero or accepted as precision-losing numbers", () => {
  for (const value of ["-1", "NaN", "Infinity", "1e309", "1e3", "abc", "1,2", "9007199254740992"]) {
    assert.throws(() => imported(`ad_id,ad_name,campaign_name,spend\n123,Video,September,"${value}"`), OwnedImportError);
  }
  assert.throws(() => imported("ad_id,ad_name,campaign_name,impressions\n123,Video,September,1.5"), OwnedImportError);
  assert.equal(imported("ad_id,ad_name,campaign_name,purchases\n123,Video,September,1.5").rows[0].purchases, 1.5);
});

test("dates are calendar-valid and chronological, with the CSV range matching the selected snapshot", () => {
  assert.throws(() => parseOwnedAdImport({ ...metadata, csv: minimalCsv, date_start: "2026-02-30" }), OwnedImportError);
  assert.throws(() => parseOwnedAdImport({ ...metadata, csv: minimalCsv, date_start: "2026-09-29" }), /วันสิ้นสุด/);
  assert.throws(() => parseOwnedAdImport({ ...metadata, csv: minimalCsv, date_start: "01/09/2026" }), /YYYY-MM-DD/);
  const matching = `${minimalCsv},2026-09-01,2026-09-28`.replace("campaign_name\n", "campaign_name,Reporting starts,Reporting ends\n");
  assert.equal(imported(matching).rows.length, 1);
  assert.throws(() => imported(matching.replace("2026-09-28", "2026-09-27")), /ช่วงวันที่/);
});

test("unsupported currency is rejected in metadata, export labels and per-row currency", () => {
  assert.throws(() => parseOwnedAdImport({ ...metadata, csv: minimalCsv, currency: "USD" }), /THB/);
  assert.throws(() => imported("ad_id,ad_name,campaign_name,Amount spent (USD)\n123,Video,September,100"), /THB/);
  assert.throws(() => imported("ad_id,ad_name,campaign_name,Account currency\n123,Video,September,USD"), /THB/);
});

test("links may only be ordinary HTTP(S) URLs and cannot contain credentials", () => {
  const valid = imported("ad_id,ad_name,campaign_name,creative_url,destination_url\n123,Video,September,https://example.com/image.jpg,https://example.com/product");
  assert.equal(valid.rows[0].creative_url, "https://example.com/image.jpg");
  for (const url of ["javascript:alert(1)", "data:image/png;base64,x", "https://user:password@example.com/image.jpg"]) {
    assert.throws(() => imported(`ad_id,ad_name,campaign_name,creative_url\n123,Video,September,"${url}"`), /URL/);
  }
});

test("a single snapshot uses summed inputs for weighted ratios rather than averaging each ad", () => {
  const summary = summarizeOwnedReport([
    row({ spend: 100, impressions: 1000, clicks: 10, conversations: 2, purchases: 1, purchase_value: 100 }),
    row({ ad_id: "456", spend: 900, impressions: 9000, clicks: 90, conversations: 18, purchases: 9, purchase_value: 4500 }),
  ]);
  assert.deepEqual(summary.spend, { value: 1000, present: 2, total: 2 });
  assert.equal(summary.purchase_value.value, 4600);
  assert.equal(summary.roas.value, 4.6);
  assert.equal(summary.ctr.value, 1);
  assert.equal(summary.cpc.value, 10);
  assert.equal(summary.cost_per_conversation.value, 50);
  assert.equal(summary.cpa.value, 100);
});

test("partial coverage, no rows and zero denominator never manufacture a complete KPI", () => {
  const summary = summarizeOwnedReport([
    row({ spend: 100, purchase_value: 300, conversations: 0 }),
    row({ ad_id: "456", spend: 200, purchase_value: null, conversations: 0 }),
  ]);
  assert.deepEqual(summary.purchase_value, { value: null, present: 1, total: 2 });
  assert.deepEqual(summary.roas, { value: null, present: 1, total: 2 });
  assert.deepEqual(summary.cost_per_conversation, { value: null, present: 2, total: 2 });
  assert.deepEqual(summarizeOwnedReport([]).spend, { value: null, present: 0, total: 0 });
  assert.equal(summarizeOwnedReport([row({ spend: 10, purchase_value: 0 })]).roas.value, 0);
});

test("CSV limits bound both row count and byte size", () => {
  const maximum = "ad_id,ad_name,campaign_name\n" + Array.from({ length: MAX_OWNED_IMPORT_ROWS }, (_, i) => `${i + 1},Video,September`).join("\n");
  assert.equal(imported(maximum).rows.length, MAX_OWNED_IMPORT_ROWS);
  assert.throws(() => imported(`${maximum}\n999999,Video,September`), (error: unknown) => error instanceof OwnedImportError && error.status === 413);
  assert.throws(() => parseOwnedCsv("x".repeat(MAX_OWNED_IMPORT_BYTES + 1)), (error: unknown) => error instanceof OwnedImportError && error.status === 413);
});

test("bounded JSON request reading rejects oversized streamed bodies even without Content-Length", async () => {
  const request = new Request("http://localhost/api/owned-ads/reports", { method: "POST", body: JSON.stringify({ ...metadata, csv: minimalCsv }) });
  assert.equal(parseOwnedAdImport(await readOwnedImportRequest(request)).rows.length, 1);
  const tooLarge = new Request("http://localhost/api/owned-ads/reports", { method: "POST", body: "x".repeat(MAX_OWNED_IMPORT_BYTES + 1) });
  await assert.rejects(readOwnedImportRequest(tooLarge), (error: unknown) => error instanceof OwnedImportError && error.status === 413);
  await assert.rejects(readOwnedImportRequest(new Request("http://localhost", { method: "POST", body: "not JSON" })), /JSON/);
});
