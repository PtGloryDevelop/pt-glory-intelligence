"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  OWNED_CSV_TEMPLATE, summarizeOwnedReport,
  type OwnedAdReport, type OwnedAdReportSummary, type OwnedAdRow, type OwnedMetric,
} from "@/lib/owned-ads/model";
import { MAX_OWNED_IMPORT_BYTES, parseOwnedAdImport } from "@/lib/owned-ads/import";
import { PageHeader } from "@/components/shell/PageHeader";
import { Icon } from "@/components/shell/icons";
import { AdImage } from "@/components/AdImage";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { Panel, TableWrap } from "@/components/Surface";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { thaiDateTime } from "@/lib/format/date";
import styles from "./owned-ads.module.css";

const PAGE_SIZE = 24;
const count = (value: number | null) => value === null ? "—" : value.toLocaleString("th-TH");
const ratio = (value: number | null) => value === null ? "—" : value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const money = (value: number | null, currency = "THB") => value === null ? "—" : new Intl.NumberFormat("th-TH", {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(value);
const coverage = (metric: OwnedMetric) => `ข้อมูลครบ ${metric.present.toLocaleString("th-TH")} / ${metric.total.toLocaleString("th-TH")} Ads`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("th-TH", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value}T00:00:00Z`));

function webUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function OwnedAdsClient() {
  const [reports, setReports] = useState<OwnedAdReportSummary[]>([]);
  const [report, setReport] = useState<OwnedAdReport | null>(null);
  const [reportId, setReportId] = useState("");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<OwnedAdRow | null>(null);
  const [preview, setPreview] = useState(false);
  const importRef = useRef<HTMLElement>(null);
  const requestNumber = useRef(0);

  const loadReport = useCallback(async (id: string) => {
    const request = ++requestNumber.current;
    setReportId(id);
    setReport(null);
    setPreview(false);
    setLoading(true);
    setProblem(null);
    setSearch(""); setCampaign(""); setPage(0); setSelected(null);
    try {
      const response = await fetch(`/api/owned-ads/reports/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.report?.rows)) {
        throw new Error(payload?.message ?? payload?.error ?? "ไม่สามารถเปิดรายงานนี้ได้");
      }
      if (request === requestNumber.current) setReport(payload.report);
    } catch (error) {
      if (request === requestNumber.current) setProblem((error as Error).message);
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    const initialRequest = requestNumber.current;
    fetch("/api/owned-ads/reports", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.reports)) {
          throw new Error(payload?.message ?? payload?.error ?? "ยังไม่สามารถโหลดรายงานได้ กรุณาลองใหม่อีกครั้ง");
        }
        if (!live || initialRequest !== requestNumber.current) return;
        setReports(payload.reports);
        if (payload.reports[0]) await loadReport(payload.reports[0].id);
        else setLoading(false);
      })
      .catch((error: Error) => {
        if (live && initialRequest === requestNumber.current) { setProblem(error.message); setLoading(false); }
      });
    return () => { live = false; requestNumber.current += 1; };
  }, [loadReport]);

  function imported(next: OwnedAdReport) {
    requestNumber.current += 1;
    const { rows, ...metadata } = next;
    setReports((current) => [{ ...metadata, row_count: rows.length }, ...current.filter((item) => item.id !== next.id)]);
    setReport(next); setReportId(next.id); setLoading(false); setProblem(null);
    setSearch(""); setCampaign(""); setPage(0); setImportOpen(false); setPreview(false);
  }

  function previewed(next: OwnedAdReport) {
    requestNumber.current += 1;
    setReport(next); setReportId(""); setLoading(false); setProblem(null); setPreview(true);
    setSearch(""); setCampaign(""); setPage(0); setSelected(null); setImportOpen(true);
  }

  function openImport() {
    setImportOpen(true);
    requestAnimationFrame(() => importRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const query = search.trim().toLocaleLowerCase();
  const rows = (report?.rows ?? []).filter((row) =>
    (!campaign || row.campaign_name === campaign)
    && (!query || [row.ad_id, row.ad_name, row.campaign_name, row.adset_name ?? ""].join(" ").toLocaleLowerCase().includes(query)),
  );
  const summary = summarizeOwnedReport(rows);
  const campaigns = [...new Set(report?.rows.map((row) => row.campaign_name) ?? [])].sort();
  const shown = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className={styles.page} data-testid="owned-dashboard">
      <nav className={styles.tabs} aria-label="ขอบเขตโฆษณา">
        <Link href="/competitors"><Icon name="swords" />โฆษณาคู่แข่ง</Link>
        <Link href="/owned-ads" aria-current="page"><Icon name="chart" />โฆษณาของบริษัท</Link>
      </nav>

      <PageHeader
        eyebrow="Company Ads"
        title="คลังโฆษณาของบริษัท"
        description="ดูผลลัพธ์ระดับโฆษณาจากรายงานของทีม เพื่อวางแผนการทดลองครั้งต่อไป"
        actions={<div className={styles.actions}>
          <TemplateLink />
          <button type="button" data-variant="primary" onClick={openImport} data-testid="owned-open-import">
            <Icon name="upload" />นำเข้ารายงาน
          </button>
        </div>}
      />

      <div className={styles.connection}>แสดงข้อมูลตามรายงานที่เลือก · ยังไม่มีการซิงค์จาก Ads Management อัตโนมัติ</div>
      {problem ? <ErrorState title="เปิดข้อมูลไม่สำเร็จ" detail={problem} testId="owned-error" /> : null}

      {reports.length > 0 || report ? <Panel padded>
        <div className={styles.reportBar}>
          <label className={styles.label} htmlFor="owned-report">รายงานที่กำลังดู
            <select id="owned-report" data-testid="owned-report-select" value={reportId} onChange={(event) => void loadReport(event.target.value)}>
              {preview ? <option value="" disabled>ตัวอย่างจากไฟล์ · {report?.name} · ยังไม่บันทึก</option> : null}
              {reports.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account_name}</option>)}
            </select>
          </label>
          <div className={styles.period}>
            {report ? <><strong>{dateLabel(report.date_start)} — {dateLabel(report.date_end)}</strong>
              <span>{report.account_name} · {report.rows.length.toLocaleString("th-TH")} Ads · THB</span></> : <span>กำลังเปิดรายงาน…</span>}
          </div>
        </div>
        <p className={styles.basis}>แสดงครั้งละหนึ่งรายงาน เพื่อไม่รวมตัวเลขซ้ำจากช่วงวันที่ทับกัน</p>
        {preview ? <p className={styles.previewNotice} role="status" data-testid="owned-preview-status">ตัวอย่างจากไฟล์ · ยังไม่บันทึก · ข้อมูลนี้จะหายเมื่อรีเฟรชหน้า กดบันทึกด้านล่างเพื่อให้ทีมเปิดดูร่วมกัน</p> : null}
      </Panel> : null}

      {loading ? <div className={styles.loading} role="status">กำลังโหลดรายงานโฆษณา…</div> : null}

      {!loading && !report && !problem ? <Panel padded>
        <EmptyState testId="owned-empty" title="เริ่มจากรายงานโฆษณาของบริษัท"
          body="นำเข้าข้อมูลระดับ Ad พร้อมช่วงวันที่ แล้วค่าโฆษณา บทสนทนา และ ROAS จะปรากฏจากข้อมูลจริง"
          action={<button type="button" onClick={openImport}>นำเข้ารายงานแรก</button>} />
      </Panel> : null}

      {report && !loading ? <>
        <div>
          <KPIRow testId="owned-kpis">
            <KPIStat label="ค่าโฆษณา" value={money(summary.spend.value)} helper={coverage(summary.spend)} testId="owned-kpi-spend" />
            <KPIStat label="มูลค่าซื้อที่ Meta รายงาน" value={money(summary.purchase_value.value)} helper={coverage(summary.purchase_value)} testId="owned-kpi-value" />
            <KPIStat label="บทสนทนา" value={count(summary.conversations.value)} helper={coverage(summary.conversations)} testId="owned-kpi-conversations" />
            <KPIStat label="ROAS (Meta)" value={ratio(summary.roas.value)} helper={coverage(summary.roas)} testId="owned-kpi-roas" />
          </KPIRow>
          <p className={styles.basis}>จาก {rows.length.toLocaleString("th-TH")} Ads ที่ตรงตัวกรอง · ROAS = มูลค่าซื้อรวม ÷ ค่าโฆษณารวม · — หมายถึงข้อมูลไม่ครบหรือหารไม่ได้</p>
        </div>

        <div className={styles.workspace}>
          <section className={styles.results} aria-label="รายการโฆษณาของบริษัท">
            <div className={styles.toolbar}>
              <label className={`${styles.label} ${styles.search}`} htmlFor="owned-search">ค้นหาโฆษณา
                <Icon name="search" />
                <input id="owned-search" data-testid="owned-search" type="text" placeholder="ชื่อโฆษณา, Ad ID หรือแคมเปญ" value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
              </label>
              <label className={styles.label} htmlFor="owned-campaign">แคมเปญ
                <select id="owned-campaign" data-testid="owned-campaign" value={campaign} onChange={(event) => { setCampaign(event.target.value); setPage(0); }}>
                  <option value="">ทุกแคมเปญ</option>
                  {campaigns.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
            <div className={styles.resultHead}>
              <h2>สื่อโฆษณา <span className={styles.count}>{rows.length.toLocaleString("th-TH")} รายการ</span></h2>
              <div className={styles.view} role="group" aria-label="รูปแบบรายการโฆษณา">
                <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} data-testid="owned-view-grid"><Icon name="grid" />การ์ด</button>
                <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} data-testid="owned-view-table"><Icon name="layers" />ตาราง</button>
              </div>
            </div>
            {rows.length === 0 ? <EmptyState title="ไม่พบโฆษณาที่ตรงตัวกรอง" body="ลองค้นด้วยคำอื่นหรือเลือกทุกแคมเปญ" testId="owned-filter-empty" />
              : view === "grid" ? <div className={styles.grid} data-testid="owned-grid">
                {shown.map((ad) => <OwnedCard key={ad.ad_id} ad={ad} onOpen={() => setSelected(ad)} />)}
              </div> : <Panel><TableWrap><table data-testid="owned-table">
                <thead><tr><th>โฆษณา / แคมเปญ</th><th>ค่าโฆษณา</th><th>บทสนทนา</th><th>การซื้อ</th><th>มูลค่าซื้อ (Meta)</th><th>ROAS</th></tr></thead>
                <tbody>{shown.map((ad) => <tr key={ad.ad_id}>
                  <td className={styles.tableName}><button type="button" onClick={() => setSelected(ad)}>{ad.ad_name}</button><small>{ad.campaign_name} · {ad.ad_id}</small></td>
                  <td className={styles.number}>{money(ad.spend)}</td><td className={styles.number}>{count(ad.conversations)}</td>
                  <td className={styles.number}>{count(ad.purchases)}</td><td className={styles.number}>{money(ad.purchase_value)}</td>
                  <td className={styles.number}>{ratio(summarizeOwnedReport([ad]).roas.value)}</td>
                </tr>)}</tbody>
              </table></TableWrap></Panel>}
            {rows.length > 0 ? <div className={styles.pagination}>
              <span>{(page * PAGE_SIZE + 1).toLocaleString("th-TH")}–{Math.min((page + 1) * PAGE_SIZE, rows.length).toLocaleString("th-TH")} จาก {rows.length.toLocaleString("th-TH")} Ads</span>
              <div><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
                <button type="button" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(page + 1)}>ถัดไป</button></div>
            </div> : null}
          </section>

          <aside className={styles.aside} aria-label="แหล่งข้อมูลและความครบถ้วน">
            <Panel padded level="tint">
              <h3><Icon name="shield" />ความครบถ้วนของรายงาน</h3>
              <div className={styles.coverage}>
                {[['ค่าโฆษณา', summary.spend], ['มูลค่าซื้อ', summary.purchase_value], ['บทสนทนา', summary.conversations], ['ข้อมูลคำนวณ ROAS', summary.roas]].map(([label, metric]) => {
                  const item = metric as OwnedMetric;
                  return <div key={label as string}><span>{label as string}</span><strong>{item.present} / {item.total}</strong></div>;
                })}
              </div>
              <p className={styles.asideRule}>เว้นว่างเมื่อไม่มีข้อมูล · ใส่ 0 เฉพาะเมื่อรายงานระบุศูนย์จริง ระบบไม่เติมตัวเลขแทนช่องว่าง</p>
            </Panel>
            <Panel padded>
              <h3><Icon name="history" />แหล่งข้อมูลของมุมมองนี้</h3>
              <p>{report.source_label}</p>
              <p>{preview ? "ดูไฟล์เมื่อ" : "นำเข้า"} {thaiDateTime(report.imported_at)}</p>
              <p className={styles.asideRule}>มูลค่าซื้อเป็นค่าที่นำเข้าจากรายงาน Meta ไม่ใช่ยอดรับเงินจริงจากระบบออร์เดอร์หรือกำไรของบริษัท</p>
              <p>ใช้รายงานที่ตรงช่วงวันที่และการตั้งค่า Attribution เดียวกันเมื่อต้องการเปรียบเทียบ</p>
            </Panel>
          </aside>
        </div>
      </> : null}

      {(importOpen || (!loading && reports.length === 0)) ? <section ref={importRef} className={styles.importPanel} aria-label="นำเข้ารายงานโฆษณา">
        <ImportPanel onImported={imported} onPreview={previewed} />
      </section> : null}
      {selected && report ? <OwnedDetail ad={selected} report={report} preview={preview} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

export function LegacyOwnedReports() {
  const [open,setOpen]=useState(false);
  return <details className={styles.legacy} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>นำเข้ารายงาน CSV / รายงานเดิม</summary>
    {open?<OwnedAdsClient />:null}
  </details>;
}

function TemplateLink() {
  return <a className={styles.template} data-testid="owned-template" download="pt-glory-company-ads-template.csv"
    href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${OWNED_CSV_TEMPLATE}`)}`}><Icon name="download" />แบบฟอร์ม CSV</a>;
}

type ImportRequest = { name: string; account_name: string; date_start: string; date_end: string; currency: "THB"; csv: string };

function ImportPanel({ onImported, onPreview }: { onImported: (report: OwnedAdReport) => void; onPreview: (report: OwnedAdReport) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<ImportRequest | null>(null);
  async function previewFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setProblem(null); setPrepared(null);
    try {
      if (file.size > MAX_OWNED_IMPORT_BYTES) throw new Error("ไฟล์ CSV ต้องมีขนาดไม่เกิน 5 MiB");
      let csv: string;
      try { csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("อ่านไฟล์ไม่สำเร็จ กรุณาบันทึกไฟล์เป็น CSV UTF-8 แล้วลองใหม่"); }
      const request: ImportRequest = {
        name: String(form.get("name") ?? "").trim(), account_name: String(form.get("account_name") ?? "").trim(),
        date_start: String(form.get("date_start") ?? ""), date_end: String(form.get("date_end") ?? ""),
        currency: "THB", csv,
      };
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_OWNED_IMPORT_BYTES) {
        throw new Error("ไฟล์และข้อมูลรายงานรวมกันต้องไม่เกิน 5 MiB กรุณาลดขนาดไฟล์");
      }
      const parsed = parseOwnedAdImport(request);
      onPreview({ ...parsed, id: "local-preview", source_label: "ตัวอย่างจากไฟล์ CSV ของทีม · ยังไม่บันทึก", imported_at: new Date().toISOString() });
      setPrepared(request);
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    if (busy || !prepared) return;
    setBusy(true); setProblem(null);
    try {
      const response = await fetch("/api/owned-ads/reports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(prepared),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.report?.rows)) {
        throw new Error(payload?.message ?? payload?.error ?? "ยังไม่สามารถนำเข้ารายงานได้");
      }
      onImported(payload.report);
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  }
  return <Panel padded>
    <div className={styles.importLayout}>
      <div className={styles.importIntro}>
        <div className={styles.importIcon}><Icon name="upload" /></div>
        <h2>นำเข้ารายงานของทีม</h2>
        <p>ดาวน์โหลดแบบฟอร์ม แล้ววางข้อมูลระดับ Ad จากรายงานของบริษัท หนึ่งแถวต่อ Ad ในช่วงวันที่ที่เลือก</p>
        <p>purchase_value = มูลค่าซื้อที่ Meta รายงาน · conversations = บทสนทนาที่เริ่มต้น · clicks = คลิกลิงก์ · ไม่มีข้อมูลให้เว้นว่าง</p>
        <p>ดูตัวอย่างและตรวจสอบตัวเลขจากไฟล์ได้ก่อนบันทึก ข้อมูลจะส่งไปเก็บเมื่อกดบันทึกให้ทีมเท่านั้น</p>
        <TemplateLink />
      </div>
      <form className={styles.importForm} onSubmit={previewFile} onChange={() => setPrepared(null)} data-testid="owned-import-form">
        <div className={styles.formRow}>
          <label className={styles.label}>ชื่อรายงาน<input name="name" type="text" required maxLength={200} placeholder="เช่น รายงานสัปดาห์ล่าสุด" /></label>
          <label className={styles.label}>ชื่อบัญชีโฆษณา<input name="account_name" type="text" required maxLength={200} placeholder="ชื่อบัญชีของบริษัท" /></label>
        </div>
        <div className={styles.formRow}>
          <label className={styles.label}>ตั้งแต่วันที่<input name="date_start" type="date" required /></label>
          <label className={styles.label}>ถึงวันที่<input name="date_end" type="date" required /></label>
        </div>
        <label className={styles.file}>เลือกไฟล์ CSV
          <input type="file" accept=".csv,text/csv" required data-testid="owned-file" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setProblem(null); }} />
          <small>UTF-8 · ใช้หัวคอลัมน์ตามแบบฟอร์ม · THB · สูงสุด 5 MiB / 5,000 Ads · แปลง Excel เป็น CSV ก่อน</small>
        </label>
        {problem ? <ErrorState title="ยังนำเข้าไม่ได้" detail={problem} testId="owned-import-error" /> : null}
        <div className={styles.formFoot}><p>{prepared ? "ตรวจสอบตัวอย่างแล้วบันทึกให้ทีมเปิดดูร่วมกัน" : "เลือกไฟล์และดูตัวอย่างก่อนบันทึก"}</p>
          <div className={styles.actions}>
            <button type="submit" disabled={busy || !file} data-testid="owned-preview-submit">{busy && !prepared ? "กำลังตรวจไฟล์…" : "ดูตัวอย่างไฟล์"}</button>
            <button type="button" data-variant="primary" disabled={busy || !prepared} onClick={() => void save()} data-testid="owned-import-submit">{busy && prepared ? "กำลังบันทึก…" : "บันทึกให้ทีม"}</button>
          </div>
        </div>
      </form>
    </div>
  </Panel>;
}

export function AdStatus({ status }: { status: string | null }) {
  const labels:Record<string,string>={ACTIVE:"กำลังแสดง",PAUSED:"หยุดแอด",CAMPAIGN_PAUSED:"หยุดแคมเปญ",ADSET_PAUSED:"หยุดชุดแอด",ARCHIVED:"เก็บถาวร",DELETED:"ลบแล้ว",DISAPPROVED:"ไม่ผ่านการอนุมัติ",WITH_ISSUES:"มีปัญหา"};
  return <span className={`${styles.status} ${status?.toUpperCase() === "ACTIVE" ? styles.active : ""}`}>{status?labels[status.toUpperCase()]??status:"ไม่ระบุสถานะ"}</span>;
}

export function Creative({ url, videoUrl = null, name, detail = false, mediaLoading = false, sizes, isVideo = false }: { url: string | null; videoUrl?:string|null; name: string; detail?: boolean; mediaLoading?: boolean; sizes?: string; isVideo?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string|null>(null);
  const [failedVideo,setFailedVideo]=useState<string|null>(null);
  const src = webUrl(url);
  const playable=detail?webUrl(videoUrl):null;
  const sourceVideo=playable&&playable!==failedVideo?playable:null;
  const broken=src!==null&&failedUrl===src;
  const video = src ? /\.(mp4|webm|mov)(?:$|\?)/i.test(src) : false;
  return <div className={styles.preview}>
    {sourceVideo?<video data-testid="owned-media-video" src={sourceVideo} poster={src??undefined} controls preload="none" onError={()=>setFailedVideo(sourceVideo)} aria-label={name}/>
    : !src || broken ? <div className={styles.noMedia} role={mediaLoading?"status":undefined}><Icon name="image" /><span>{mediaLoading?"กำลังโหลดภาพชัด…":broken ? "ไฟล์ครีเอทีฟนี้เปิดไม่ได้" : "ไม่มีไฟล์ครีเอทีฟในรายงาน"}</span></div>
      : video ? <video src={src} controls={detail} muted={!detail} preload={detail?"metadata":"none"} onError={() => setFailedUrl(src)} aria-label={name} />
        : <AdImage src={src} alt={name} original={detail} sizes={sizes} referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} />}
    {!detail&&(isVideo||video)?<span className={styles.videoBadge}><span aria-hidden="true">▶</span> ดูวิดีโอ</span>:null}
    {detail&&playable&&failedVideo===playable?<span className={styles.videoError} role="alert">วิดีโอนี้เล่นไม่ได้ ลองปิดแล้วเปิดรายละเอียดอีกครั้ง</span>:null}
  </div>;
}

export function OwnedCard({ ad, onOpen, currency = "THB", compareHref, contextLabel, mediaLoading = false, isVideo = false }: { ad: OwnedAdRow; onOpen: () => void; currency?: string; compareHref?: string; contextLabel?: string; mediaLoading?: boolean; isVideo?: boolean }) {
  const metrics = summarizeOwnedReport([ad]);
  return <article className={styles.card} data-testid={`owned-ad-${ad.ad_id}`}>
    <button type="button" className={styles.previewButton} onClick={onOpen} aria-label={`${isVideo?'ดูวิดีโอ':'ดูรายละเอียด'} ${ad.ad_name}`}><Creative url={ad.creative_url} name={ad.ad_name} isVideo={isVideo} mediaLoading={mediaLoading} /></button>
    <div className={styles.cardBody}>
      <div className={styles.cardTop}><AdStatus status={ad.status} /><span className={styles.adId} title={contextLabel??ad.ad_id}>{contextLabel??`Ad ${ad.ad_id}`}</span></div>
      <h3 className={styles.adName}>{ad.ad_name}</h3><p className={styles.campaign} title={ad.campaign_name}>{ad.campaign_name}</p>
      <div className={styles.metrics}>
        <Metric label="ค่าโฆษณา" value={money(ad.spend,currency)} /><Metric label="ROAS (Meta)" value={ratio(metrics.roas.value)} />
        <Metric label="บทสนทนา" value={count(ad.conversations)} /><Metric label="ค่า / บทสนทนา" value={money(metrics.cost_per_conversation.value,currency)} />
      </div>
      <div className={styles.deliveryFacts}>
        <span>ซื้อ (Meta) <strong>{count(ad.purchases)}</strong></span>
        {ad.video_3s!==null?<span>ดู 3 วินาที <strong>{count(ad.video_3s)}</strong></span>:null}
        {ad.thruplays!==null?<span>ThruPlay <strong>{count(ad.thruplays)}</strong></span>:null}
      </div>
      <div className={styles.cardActions}><button type="button" className={styles.cardOpen} onClick={onOpen}>ดูรายละเอียด →</button>
        {compareHref?<Link href={compareHref} className={styles.cardCompare} data-testid={`company-compare-${ad.ad_id}`}>เลือกเปรียบเทียบ</Link>:null}
      </div>
    </div>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong data-numeral>{value}</strong></div>;
}

function OwnedDetail({ ad, report, preview, onClose }: { ad: OwnedAdRow; report: OwnedAdReport; preview: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const metrics = summarizeOwnedReport([ad]);
  const destination = webUrl(ad.destination_url);
  const facts: [string, string][] = [
    ["Ad ID", ad.ad_id], ["แคมเปญ", ad.campaign_name], ["ชุดโฆษณา", ad.adset_name ?? "—"],
    ["บัญชีโฆษณา", report.account_name], ["ช่วงวันที่", `${dateLabel(report.date_start)} — ${dateLabel(report.date_end)}`],
    ["รายงาน", report.name], ["แหล่งข้อมูล", report.source_label], [preview ? "ดูไฟล์เมื่อ" : "นำเข้าเมื่อ", thaiDateTime(report.imported_at)],
  ];
  return <dialog ref={dialog} className={styles.drawer} aria-labelledby="owned-detail-title" data-testid="owned-detail"
    onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className={styles.drawerInner}>
      <header className={styles.drawerHead}><div><AdStatus status={ad.status} /><h2 id="owned-detail-title">{ad.ad_name}</h2></div>
        <button type="button" aria-label="ปิดรายละเอียดโฆษณา" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <div className={styles.drawerBody}>
        <Creative url={ad.creative_url} name={ad.ad_name} detail />
        <section className={styles.drawerSection}><h3>ผลลัพธ์ตามรายงาน</h3>
          <div className={styles.detailMetrics}>
            <Metric label="ค่าโฆษณา" value={money(ad.spend)} /><Metric label="มูลค่าซื้อ (Meta)" value={money(ad.purchase_value)} />
            <Metric label="ROAS (Meta)" value={ratio(metrics.roas.value)} /><Metric label="Impressions" value={count(ad.impressions)} />
            <Metric label="คลิกลิงก์" value={count(ad.clicks)} /><Metric label="CTR (ลิงก์)" value={metrics.ctr.value === null ? "—" : `${ratio(metrics.ctr.value)}%`} />
            <Metric label="บทสนทนา" value={count(ad.conversations)} /><Metric label="ค่าใช้จ่าย / บทสนทนา" value={money(metrics.cost_per_conversation.value)} />
            <Metric label="การซื้อ (Meta)" value={count(ad.purchases)} /><Metric label="CPA (Meta)" value={money(metrics.cpa.value)} />
            <Metric label="CPC (ลิงก์)" value={money(metrics.cpc.value)} /><Metric label="ดูวิดีโอ 3 วินาที" value={count(ad.video_3s)} />
            <Metric label="ThruPlay" value={count(ad.thruplays)} /><Metric label="ยอดขายยืนยัน / กำไร" value="—" /><Metric label="อัตราปิดการขาย" value="—" />
          </div>
          <p className={styles.basis}>ยอดดูวิดีโอเป็นจำนวนครั้งจากรายงาน · ยังไม่มีฐานข้อมูลออร์เดอร์เพื่อยืนยันยอดขายหรืออัตราปิด</p>
        </section>
        <section className={styles.drawerSection}><h3>ข้อมูลและที่มาของโฆษณา</h3>
          <dl className={styles.facts}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            <div><dt>ลิงก์ปลายทาง</dt><dd>{destination ? <a href={destination} target="_blank" rel="noopener noreferrer">เปิดปลายทาง ↗</a> : "—"}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  </dialog>;
}
