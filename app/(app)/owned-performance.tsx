"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import type { OwnedPerformanceData, OwnedPerformanceRow, OwnedPeriodPreset, OwnedPerformanceSort } from "@/lib/owned-ads/performance";
import { ownedPerformancePeriod, parseOwnedPerformanceQuery, OWNED_PERFORMANCE_STATUSES } from "@/lib/owned-ads/performance";
import { ownedPageChoices } from "@/lib/owned-ads/page-names";
import { AdStatus, Creative } from "./owned-ads/owned-client";
import { CompanyDetail } from "./owned-ads/company-library";
import styles from "./owned-performance.module.css";

const PERIODS: readonly [OwnedPeriodPreset, string][] = [["3d", "3 วัน"], ["7d", "7 วัน"], ["14d", "14 วัน"], ["this-month", "เดือนนี้"], ["last-month", "เดือนที่แล้ว"], ["all", "ทั้งหมดที่นำเข้า"], ["custom", "กำหนดเอง"], ["today", "วันนี้"], ["yesterday", "เมื่อวาน"]];
const SORTS: readonly [OwnedPerformanceSort, string][] = [["spend", "ค่าแอดสูงสุด"], ["conversations", "ทักมากสุด"], ["cost_per_conversation", "ค่าทักถูกสุด"], ["roas", "ROAS สูงสุด"], ["hook_rate", "Hook rate สูงสุด"], ["longest", "มีค่าแอดหลายวันสุด"], ["newest", "เริ่มมีค่าแอดล่าสุด"]];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const date = (value: string | null | undefined) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "—";
const adKey = (ad: { account_id: string; ad_id: string }) => `${ad.account_id}:${ad.ad_id}`;

export function OwnedPerformance({ ranking = false }: { ranking?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  const period = PERIODS.find(([value]) => value === params.get("period"))?.[0] ?? "7d";
  const sort = SORTS.find(([value]) => value === params.get("sort"))?.[0] ?? "spend";
  const [result, setResult] = useState<{ query: string; data: OwnedPerformanceData } | null>(null);
  const [problem, setProblem] = useState<{ query: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [currency, setCurrency] = useState("THB");
  const [selected, setSelected] = useState<OwnedPerformanceRow | null>(null);
  const [media, setMedia] = useState<Record<string, string | null>>({});
  const [mediaProblem, setMediaProblem] = useState(false);
  const [namesLoading, setNamesLoading] = useState(false);
  const [namesMessage, setNamesMessage] = useState("");
  const data = result?.query === query ? result.data : null;
  const error = problem?.query === query ? problem.message : null;
  const loading = !data && !error;
  const rows = data?.rows;
  const choices = result?.data.filters;
  const pageChoices = ownedPageChoices(choices?.pages ?? []);
  const unnamedPages = pageChoices.filter(page => !page.name).length;
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  const group = data?.summary.find(item => item.currency === currency) ?? data?.summary[0];

  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (!Object.hasOwn(values, "page")) next.delete("page");
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
    setSelected(null);
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    change({ q: String(form.get("q") ?? "").trim(), from: period === "custom" ? String(form.get("from") ?? "") : "", to: period === "custom" ? String(form.get("to") ?? "") : "" });
  }
  async function refreshPageNames() {
    setNamesLoading(true); setNamesMessage("");
    try {
      const response = await fetch("/api/owned-ads/page-names", { method: "POST" });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error ?? "อัปเดตชื่อเพจไม่สำเร็จ");
      setNamesMessage(report.unresolved ? `มีชื่อแล้ว ${report.named} จาก ${report.pages} เพจในคลัง · อีก ${report.unresolved} เพจยังอ่านชื่อไม่ได้ กรุณาตรวจสิทธิ์เพจ` : `อัปเดตชื่อครบ ${report.named} เพจในคลังแล้ว`);
      setRefresh(value => value + 1);
    } catch (error) { setNamesMessage(error instanceof Error ? error.message : "อัปเดตชื่อเพจไม่สำเร็จ"); }
    finally { setNamesLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/owned-ads/performance?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "เปิดผลลัพธ์โฆษณาไม่ได้");
        if (!controller.signal.aborted) {
          if (body.page !== Number(new URLSearchParams(query).get("page") ?? 0)) {
            const corrected = new URLSearchParams(query);
            corrected.set("page", String(body.page));
            window.history.replaceState(null, "", `${pathname}?${corrected}${window.location.hash}`);
            return;
          }
          setResult({ query, data: body }); setProblem(null);
        }
      }).catch(error => { if (!controller.signal.aborted) setProblem({ query, message: error.message }); });
    return () => controller.abort();
  }, [query, refresh, pathname]);
  useEffect(() => {
    if (!rows?.length) return;
    const controller = new AbortController();
    async function load() {
      for (let offset = 0; offset < rows!.length && !controller.signal.aborted; offset += 4) {
        const items = rows!.slice(offset, offset + 4).filter(ad => !Object.hasOwn(media, adKey(ad))).map(({ account_id, ad_id }) => ({ account_id, ad_id }));
        if (!items.length) continue;
        try {
          const response = await fetch("/api/owned-ads/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), signal: controller.signal });
          if (!response.ok) throw new Error();
          const body = await response.json();
          if (!controller.signal.aborted) { setMedia(previous => ({ ...previous, ...Object.fromEntries(body.items.map((item: { account_id: string; ad_id: string; url: string | null }) => [adKey(item), item.url])) })); setMediaProblem(false); }
        } catch {
          if (!controller.signal.aborted) { setMedia(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [adKey(item), previous[adKey(item)] ?? null])) })); setMediaProblem(true); }
        }
      }
    }
    void load();
    return () => controller.abort();
    // Cache entries do not restart the request for the same displayed rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const money = (value: number | null | undefined) => `${number(value)}${value == null ? "" : ` ${group?.currency ?? ""}`}`;
  const compareHref = (ad: OwnedPerformanceRow) => `/compare/ads?${new URLSearchParams({ account: ad.account_id, owned: ad.ad_id, returnTo })}`;
  const page = data?.page ?? 0;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 24;
  const coverage = data?.coverage;

  return <div className={styles.page} data-testid={ranking ? "command-center" : "owned-performance"}>
    <PageHeader title={ranking ? "Command Center" : "คลังแอดของเรา"} description={ranking ? "จัดอันดับจากผลลัพธ์จริง แล้วเปิดสื่อที่ต้องการตรวจต่อ" : "ดูสื่อและผลลัพธ์ในช่วงเดียวกัน เพื่อเลือกแอดที่ต้องตรวจหรือเทียบกับคู่แข่ง"} actions={<div className={styles.actions}><Link href={ranking ? `/owned-ads/performance${query ? `?${query}` : ""}` : `/command-center${query ? `?${query}` : ""}`}>{ranking ? "กลับคลังแอด" : "ดูอันดับแอด →"}</Link><button type="button" onClick={() => { setResult(null); setProblem(null); setRefresh(value => value + 1); }} disabled={loading} data-testid="performance-refresh">รีเฟรชข้อมูล</button></div>} />
    <div className={styles.source}><span>Ads Management{coverage ? ` · มีข้อมูล ${date(coverage.from)} — ${date(coverage.to)}` : " · กำลังตรวจช่วงข้อมูล"}</span><Link href="/owned-ads">อัปเดตข้อมูลจากเว็บเดิม</Link></div>

    {data ? <div className={styles.periodLine} data-testid="performance-period-line"><span>ผลลัพธ์ {date(data.period.from)} — {date(data.period.to)} · ตัวเลขสรุปจากแอดทั้งหมดที่ตรงตัวกรอง</span>{data.summary.length > 1 ? <label>สกุลเงินสรุป<select aria-label="สกุลเงินสรุป" value={group?.currency ?? ""} onChange={event => setCurrency(event.target.value)}>{data.summary.map(item => <option key={item.currency} value={item.currency}>{item.currency}</option>)}</select></label> : null}</div> : null}
    {data ? <div className={styles.kpis}><KPIRow testId="performance-kpis"><KPIStat label="ยอดขาย (Meta)" value={<><span className={styles.figure}>{number(group?.purchase_value)}</span>{group?.purchase_value != null ? <small className={styles.currency}>{group.currency}</small> : null}</>} helper="มูลค่าซื้อที่ Meta รายงาน" testId="performance-sales" /><KPIStat label="ทัก" value={<span className={styles.figure}>{number(group?.conversations)}</span>} helper="บทสนทนาที่เริ่มต้นจากแอด" testId="performance-conversations" /><KPIStat label="ROAS (Meta)" value={<span className={styles.figure}>{number(group?.roas)}</span>} helper={`ค่าแอด ${money(group?.spend)}`} testId="performance-roas" /><KPIStat label="% ปิดจากระบบขาย" value="—" helper="ยังไม่ได้เชื่อมระบบขาย · ยอดปิด ÷ ทัก" testId="performance-close" /></KPIRow></div> : null}

    <form className={styles.filters} onSubmit={submit} data-testid="performance-filters">
      <div className={styles.searchRow}><label htmlFor="performance-search">ค้นหาสื่อโฆษณา<input key={params.get("q") ?? ""} id="performance-search" name="q" type="search" maxLength={160} defaultValue={params.get("q") ?? ""} placeholder="ชื่อแอด ชื่อ VDO แคปชัน หรือคำค้น" data-testid="performance-search" /></label><button type="submit" data-variant="primary">ค้นหา</button></div>
      <div className={styles.controls}>
        <label>ช่วงวันที่<select data-testid="performance-period" value={period} onChange={event => {
          const custom = data?.period ?? ownedPerformancePeriod(parseOwnedPerformanceQuery(new URLSearchParams()), null);
          change({ period: event.target.value, from: event.target.value === "custom" ? custom.from : "", to: event.target.value === "custom" ? custom.to : "" });
        }}>{PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>ยูนิต<select data-testid="performance-unit" value={params.get("unit") ?? ""} onChange={event => change({ unit: event.target.value, pageId: "" })}><option value="">ทุกยูนิต</option>{choices?.units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>เพจ<select data-testid="performance-page" value={params.get("pageId") ?? ""} onChange={event => change({ pageId: event.target.value })}><option value="">ทุกเพจ</option>{pageChoices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>สถานะล่าสุด<select data-testid="performance-status" value={params.get("status") ?? ""} onChange={event => change({ status: event.target.value })}><option value="">ทุกสถานะ</option>{OWNED_PERFORMANCE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>เรียงตาม<select data-testid="performance-sort" value={sort} onChange={event => change({ sort: event.target.value })}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {period === "custom" ? <div className={styles.customDates} key={`${params.get("from")}:${params.get("to")}`}><label>ตั้งแต่<input name="from" type="date" required defaultValue={params.get("from") ?? ""} data-testid="performance-from" /></label><label>ถึง<input name="to" type="date" required defaultValue={params.get("to") ?? ""} data-testid="performance-to" /></label><button type="submit">ใช้ช่วงวันที่นี้</button></div> : null}
      {params.get("q") || params.get("unit") || params.get("pageId") || params.get("status") ? <button type="button" className={styles.clear} onClick={() => change({ q: "", unit: "", pageId: "", status: "" })}>ล้างคำค้นและตัวกรอง</button> : null}
      {unnamedPages ? <div className={styles.pageNames}><p className={styles.note} data-testid="performance-page-names">{number(unnamedPages)} เพจยังไม่มีชื่อจากต้นทาง · หลังจัดสิทธิ์เพจแล้ว กดอัปเดตชื่อได้ที่นี่{params.get("pageId") ? <> · <a href={`https://www.facebook.com/${params.get("pageId")}`} target="_blank" rel="noopener noreferrer">เปิดเพจที่เลือก ↗</a></> : null}</p><button type="button" onClick={refreshPageNames} disabled={namesLoading} data-testid="performance-refresh-names">{namesLoading ? "กำลังอ่านชื่อเพจ…" : "อัปเดตชื่อเพจ"}</button></div> : null}
      {namesMessage ? <p className={styles.note} role="status">{namesMessage}</p> : null}
    </form>

    {error ? <div className={styles.notice} role="alert">{error} <button type="button" onClick={() => { setProblem(null); setRefresh(value => value + 1); }}>ลองอีกครั้ง</button></div> : null}
    {loading ? <p className={styles.notice} role="status">กำลังเปิดสื่อและสรุปผลลัพธ์…</p> : null}
    {data ? <>
      {!data.ready ? <div className={styles.notice} role="status">ชุดข้อมูลนี้ยังไม่มีผลลัพธ์รายวันสำหรับ Flow ใหม่ <Link href="/owned-ads">อัปเดตข้อมูลจากเว็บเดิม</Link> เพื่อเลือกช่วงวันที่ได้</div> : null}
      {coverage && (data.period.from < coverage.from || data.period.to > coverage.to) ? <p className={styles.note} data-testid="performance-coverage">ช่วงที่เลือกมีวันที่อยู่นอกข้อมูลที่นำเข้า วันที่ไม่มีข้อมูลไม่ถูกนับเป็นผลลัพธ์ศูนย์</p> : null}

      {ranking ? <div className={styles.rankingTabs} role="group" aria-label="จัดอันดับแอด" data-testid="performance-rankings">{SORTS.map(([value, label]) => <button key={value} type="button" aria-pressed={sort === value} onClick={() => change({ sort: value })}>{label}</button>)}</div> : null}
      <div className={styles.sectionHead}><div><h2>{ranking ? SORTS.find(([value]) => value === sort)?.[1] : "สื่อโฆษณา"}</h2><p data-testid="performance-count">{total ? `${number(page * pageSize + 1)}–${number(Math.min((page + 1) * pageSize, total))} จาก ${number(total)} แอด` : "ไม่พบแอดในช่วงและตัวกรองนี้"}</p></div><span>{ranking ? "เรียงทั้งชุดข้อมูล ไม่ใช่เฉพาะหน้านี้" : "ภาพเต็ม · เปิดรายละเอียดเพื่ออ่านทั้งหมด"}</span></div>
      {mediaProblem ? <p className={styles.note} role="status">ยังโหลดภาพชัดบางภาพไม่ได้ กำลังแสดงไฟล์ที่มีจากต้นทาง</p> : null}
      <div className={styles.grid} data-testid="performance-grid">{data.rows.map((ad, index) => <article className={styles.card} key={adKey(ad)} data-testid={`performance-ad-${ad.ad_id}`}>
        <div className={styles.cardHead}>{ranking ? <span className={styles.rank}>{number(page * pageSize + index + 1)}</span> : null}<div><strong>{ad.page_name ?? ad.account_name}</strong><span>{ad.unit_names.length ? ad.unit_names.join(" · ") : "ยังไม่ระบุยูนิต"}</span></div><AdStatus status={ad.status} /></div>
        <button type="button" className={styles.previewButton} onClick={() => setSelected(ad)} aria-label={`${ad.video_id ? 'ดูวิดีโอ' : 'เปิดสื่อ'} ${ad.ad_name}`}><Creative url={media[adKey(ad)] ?? ad.creative_url} name={ad.ad_name} isVideo={Boolean(ad.video_id)} mediaLoading={!Object.hasOwn(media, adKey(ad))} /></button>
        <div className={styles.cardBody}><h3>{ad.ad_name}</h3><p className={styles.caption} title={ad.body_text ?? ad.title ?? undefined}>{ad.body_text ?? ad.title ?? "ต้นทางไม่มีแคปชัน"}</p><div className={styles.metadata}><span title={ad.campaign_name}>แคมเปญ · {ad.campaign_name}</span><span>{ad.delivery_days == null ? "ยังไม่มีวันที่ส่งแอด" : `มีค่าแอด ${number(ad.delivery_days)} วันในช่วงนี้`} · {date(ad.delivery_first)}</span></div>
          <dl className={styles.cardMetrics}><Fact label={`ค่าแอด (${ad.currency})`} value={number(ad.spend)} /><Fact label="ค่าทัก" value={ad.cost_per_conversation == null ? "—" : `${number(ad.cost_per_conversation)} ${ad.currency}`} /><Fact label="ทัก" value={number(ad.conversations)} /><Fact label="ROAS (Meta)" value={number(ad.spend != null && ad.spend > 0 && ad.purchase_value != null ? ad.purchase_value / ad.spend : null)} /><Fact label="Hook rate" value={ad.hook_rate == null || !ad.video_id && ad.video_3s === 0 && ad.thruplays === 0 ? "—" : `${number(ad.hook_rate * 100)}%`} /><Fact label="% ปิด (ระบบขาย)" value="—" /></dl>
          <div className={styles.cardActions}><button type="button" onClick={() => setSelected(ad)}>ดูรายละเอียด</button><Link href={compareHref(ad)} data-cta data-testid={`performance-compare-${ad.ad_id}`}>เลือกเทียบ</Link></div>
        </div>
      </article>)}</div>
      {data.ready && !total ? <div className={styles.empty}><h3>ยังไม่มีแอดพร้อมผลลัพธ์ในช่วงนี้</h3><p>ลองเลือกวันที่ที่อยู่ในช่วงข้อมูล หรือเปิดคลังทั้งหมดเพื่อดูสื่อที่ยังไม่มีค่าแอด</p><button type="button" onClick={() => change({ period: "all", unit: "", pageId: "", q: "", status: "", from: "", to: "" })}>ดูผลลัพธ์ทั้งหมดที่นำเข้า</button> <Link href="/owned-ads?spend=all">เปิดคลังแอดทั้งหมด</Link></div> : null}
      {total ? <div className={styles.pager}><span>หน้า {number(page + 1)} / {number(Math.ceil(total / pageSize))}</span><div><button type="button" data-testid="performance-prev" disabled={page === 0} onClick={() => change({ page: String(page - 1) })}>ก่อนหน้า</button><button type="button" data-testid="performance-next" disabled={(page + 1) * pageSize >= total} onClick={() => change({ page: String(page + 1) })}>ถัดไป</button></div></div> : null}
      <section className={styles.summary} aria-labelledby="performance-summary-title"><div><span className={styles.eyebrow}>สรุปจากข้อมูลจริง</span><h2 id="performance-summary-title">ข้อมูลพร้อมใช้วางแผน</h2></div><div className={styles.findings}><p><strong>{number(group?.ad_count)} แอด · {group?.currency ?? "—"}</strong><br />ตรงกับยูนิต เพจ คำค้น และช่วงวันที่ที่เลือก</p><p><strong>ค่าแอดต่อทัก {money(group?.cost_per_conversation)}</strong><br />ค่าแอดรวม ÷ จำนวนบทสนทนา · ใช้ดูอันดับค่าทักเพื่อเลือกสื่อตรวจต่อ</p><p><strong>Hook rate {group?.hook_rate == null ? "—" : `${number(group.hook_rate * 100)}%`}</strong><br />เปรียบเทียบการดึงความสนใจของวิดีโอในช่วงเดียวกัน</p></div><p className={styles.note}>ยังไม่มีข้อมูลยอดปิดจากระบบขาย จึงยังสรุป % ปิดหรือกำไรจริงไม่ได้ · การวิเคราะห์ AI ยังไม่เปิดใช้งาน</p><div className={styles.summaryLinks}><Link href={`/command-center?${new URLSearchParams({ ...Object.fromEntries(params), sort: "cost_per_conversation", page: "0" })}`}>ตรวจแอดค่าทักถูก →</Link><Link href="/competitors">ดูสื่อคู่แข่งเพื่อเทียบแนวทาง →</Link></div></section>
      <details className={styles.basis}><summary>แหล่งข้อมูลและวิธีอ่านตัวเลข</summary><p>ยอดขายและ ROAS เป็นการระบุที่มาจาก Meta · ไม่ใช่ยอดขายยืนยันจากระบบขายของทีม</p><p>% ปิดที่ทีมต้องการ = ยอดปิดจากระบบขาย ÷ จำนวนทัก · แสดง “—” จนกว่าจะเชื่อมข้อมูลขาย</p><p>Hook rate = ยอดดูวิดีโอที่ต้นทางรายงาน ÷ Impressions · ข้อมูลไม่ครบแสดง “—”</p><p>“มีค่าแอดกี่วัน” นับวันที่มีค่าแอดจริงภายในช่วงที่เลือก · วันที่เริ่มคือวันมีค่าแอดครั้งแรกที่ระบบนำเข้ามา จึงอาจเริ่มยิงก่อนหน้านั้น · สถานะเป็นสถานะล่าสุดจากเว็บเดิม</p><p>ตัวเลขที่ข้อมูลไม่ครบหรือหารไม่ได้แสดง “—” · ไม่รวมยอดต่างสกุลเงินเป็นตัวเลขเดียว</p></details>
    </> : null}
    {selected ? <CompanyDetail ad={selected} creativeUrl={media[adKey(selected)] ?? selected.creative_url} mediaLoading={!Object.hasOwn(media, adKey(selected))} period={data ? { date_start: data.period.from, date_end: data.period.to } : null} returnTo={returnTo} onClose={() => setSelected(null)} /> : null}
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd data-numeral>{value}</dd></div>; }
