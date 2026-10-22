"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { countryLabel, suggestedDatasetName, type CollectorFormSettings } from "@/lib/collect/form";
import type { CollectionDto } from "@/lib/collect/dto";
import { ErrorState } from "@/components/states/ErrorState";
import { thaiDateTime } from "@/lib/format/date";
import { parseAdLibraryUrl } from "@/lib/collect/url";
import { MAX_CATEGORY_NAME } from "@/lib/categories/name";
import { CollectProgress } from "./[id]/progress-client";
import styles from "./collect.module.css";
import { UsageBars } from "@/components/UsageBars";

/**
 * The collection form.
 *
 * One submission, one request. The key that makes that true is generated on the
 * server when the page renders and never regenerated here: a double click, a
 * slow answer or a retry after an error all carry the same key, so admission
 * hands back the request it already created instead of buying a second one.
 *
 * Two things are asked up front — what to search and which category it belongs
 * to — and one button starts it. Country, status, cap and the dataset name have
 * working defaults and wait under "ตั้งค่าเพิ่มเติม", which opens by itself when
 * one of them is what stops the form.
 *
 * Nothing about a provider appears in this file, and the only endpoints it knows
 * are the product's own.
 */

type Category = { id: string; name: string };

const FALLBACK_ERROR = "ไม่สามารถเริ่มเก็บข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
const normalName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * `page` is the collect screen itself. `panel` is the same form opened beside
 * another screen (the competitor board), prefilled from where it was opened;
 * both show the progress and the first ads in place of the form once it starts.
 */
export function CollectClient(
  { requestKey, categories, settings, recent, mode = "page", initialKeyword = "", initialCategory, keywordChoices = [], onFinished }:
  {
    requestKey: string;
    categories: Category[];
    settings: CollectorFormSettings;
    recent: CollectionDto[];
    mode?: "page" | "panel";
    initialKeyword?: string;
    initialCategory?: string;
    keywordChoices?: string[];
    onFinished?: (collection: CollectionDto) => void;
  },
) {
  const router = useRouter();
  // The category of this person's latest run, shown as such: most runs extend
  // the research done last time, and it stays a visible, editable choice.
  const lastUsed = categories.find((category) => category.id === recent[0]?.categoryId) ?? null;
  const [started, setStarted] = useState<{ key: string; collection: CollectionDto } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [country, setCountry] = useState(settings.countries[0] ?? "");
  const [activeStatus, setActiveStatus] = useState<"active" | "all">("active");
  const [maxRecords, setMaxRecords] = useState(String(Math.min(300, settings.maxRecordsPerRun ?? 300)));
  const [categoryList, setCategoryList] = useState(categories);
  const [categoryName, setCategoryName] = useState(initialCategory ?? lastUsed?.name ?? "");
  const [datasetName, setDatasetName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  /** A pasted Ad Library link fills keyword, country and status; anything else is typed as usual. */
  function fromLink(text: string): boolean {
    if (!/^\s*https?:\/\//i.test(text)) return false;
    const search = parseAdLibraryUrl(text);
    if (!search) { setLinkNote("ลิงก์นี้ใช้ไม่ได้ · รองรับเฉพาะลิงก์ค้นด้วยคำค้นจาก Ads Library (ไม่ใช่ลิงก์หน้าเพจ)"); return true; }
    setKeyword(search.query);
    setActiveStatus(search.activeStatus);
    const known = settings.countries.includes(search.country);
    if (known) setCountry(search.country);
    setLinkNote(`ดึงจากลิงก์ Ads Library แล้ว · ${search.query.startsWith('"') ? "ค้นตรงวลี" : "ค้นคำสำคัญ"} · ${search.activeStatus === "all" ? "ทุกสถานะ" : "กำลังแสดง"}`
      + (known ? "" : ` · ประเทศ ${search.country} ยังไม่เปิดให้เก็บ จึงใช้ ${countryLabel(country)}`));
    return true;
  }

  // The suggestion follows what has been typed until somebody edits it, and
  // then it is theirs.
  const suggestion = keyword.trim() === "" || country === ""
    ? ""
    : suggestedDatasetName(keyword, country);
  const nameValue = touchedName ? datasetName : suggestion;

  // A typed name either is an existing category or becomes a new one on submit.
  const matched = categoryList.find((category) => normalName(category.name) === normalName(categoryName)) ?? null;
  const categoryHint = categoryName.trim() === "" ? null
    : matched ? (matched.id === lastUsed?.id ? "หมวดที่ใช้ล่าสุด · พิมพ์ชื่ออื่นเพื่อเปลี่ยน" : null)
      : `จะสร้างหมวดหมู่ใหม่ “${categoryName.trim().replace(/\s+/g, " ")}” ให้ตอนกดค้น`;

  const cap = settings.maxRecordsPerRun;
  const records = Number(maxRecords);
  const advancedInvalid =
    country === "" ? "กรุณาเลือกประเทศ"
      : !Number.isInteger(records) || records < 1 ? "จำนวนสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1"
        : cap !== null && records > cap ? `จำนวนสูงสุดต้องไม่เกิน ${cap}`
          : nameValue.trim() === "" && keyword.trim() !== "" ? "กรุณาตั้งชื่อรอบข้อมูล"
            : null;
  const invalid =
    keyword.trim() === "" ? "กรุณาระบุคำค้น"
      : keyword.trim().length > 100 ? "คำค้นยาวเกินไป"
        : categoryName.trim() === "" ? "กรุณาระบุหมวดหมู่"
          : categoryName.trim().length > MAX_CATEGORY_NAME ? `ชื่อหมวดหมู่ยาวเกิน ${MAX_CATEGORY_NAME} ตัวอักษร`
            : advancedInvalid;

  /** The id to file this run under, creating the category first when the name is new. */
  async function resolveCategory(): Promise<string | null> {
    if (matched) return matched.id;
    const name = categoryName.trim().replace(/\s+/g, " ");
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.id !== "string") {
      setProblem(typeof payload?.error === "string" ? payload.error : "สร้างหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่");
      return null;
    }
    // Kept in the list, so a retry after a failed collection reuses it instead of creating it twice.
    setCategoryList((list) => [...list, { id: payload.id, name }]);
    return payload.id;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // The guard that matters is the shared key below; this only keeps the
    // screen honest while the first answer is still coming back.
    if (submitting || invalid) return;
    setSubmitting(true);
    setProblem(null);

    try {
      const categoryId = await resolveCategory();
      if (!categoryId) return;
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          country,
          activeStatus,
          maxRecords: records,
          categoryId,
          datasetName: nameValue.trim(),
          // Never regenerated: this is what makes a second click free.
          requestKey,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.id) {
        // 201 for a new request, 200 for the one this key already made. Both
        // show the same progress, here, in place of the form.
        setStarted({ key: requestKey, collection: payload as CollectionDto });
        setRestarting(false);
        // The collection's own address, so a refresh still shows it; nothing is reloaded.
        if (mode === "page") window.history.replaceState(null, "", `/collect/${payload.id}`);
        return;
      }
      setProblem(typeof payload?.message === "string" ? payload.message : FALLBACK_ERROR);
    } catch {
      setProblem(FALLBACK_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (!settings.enabled) {
    return (
      <ErrorState
        testId="collector-disabled"
        title="ยังเปิดใช้การเก็บข้อมูลไม่ได้"
        detail="ระบบเก็บข้อมูลอัตโนมัติยังไม่ได้เปิดใช้งาน ติดต่อผู้ดูแลระบบ"
      />
    );
  }

  // The next round needs a fresh key from the server: the page reloads its own
  // address; the panel asks its host page to render again, keeping what was typed.
  function restart() {
    setRestarting(true);
    if (mode === "page") router.push("/collect");
    else router.refresh();
  }

  const aside = mode === "page" ? (
    <aside className={styles.recent} data-testid="recent-collections">
      <h2 className={styles.recentTitle}>รอบเก็บข้อมูลล่าสุดของคุณ</h2>
      {recent.length === 0 ? (
        <p className={styles.hint}>ยังไม่เคยเก็บข้อมูล</p>
      ) : (
        <ul className={styles.recentList}>
          {recent.map((item) => (
            <li key={item.id}>
              <Link href={`/collect/${item.id}`} data-testid={`recent-${item.id}`}>
                <span className={styles.recentName}>{item.datasetName ?? item.keyword}</span>
                <span className={styles.recentMeta}>
                  {item.statusLabel} · {thaiDateTime(item.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  ) : null;

  // Until the server hands over a new key, the finished round stays on screen.
  if (started && started.key === requestKey) {
    const body = restarting
      ? <p className={styles.hint} role="status">กำลังเตรียมรอบใหม่…</p>
      : <CollectProgress initial={started.collection} onRestart={restart} onSettled={onFinished} />;
    return mode === "page" ? <div className={styles.layout}><div>{body}</div>{aside}</div> : body;
  }

  const form = (
      <form className={styles.form} onSubmit={submit} data-testid="collect-form">
        {mode === "page" && <UsageBars show={["collect"]} />}
        <div className={styles.field}>
          <label htmlFor="keyword">คำค้น</label>
          <input
            id="keyword" data-testid="keyword" value={keyword} maxLength={100}
            onChange={(event) => { if (!fromLink(event.target.value)) { setKeyword(event.target.value); setLinkNote(null); } }}
            onPaste={(event) => { if (fromLink(event.clipboardData.getData("text"))) event.preventDefault(); }}
            placeholder="เช่น วิตามินซี หรือวางลิงก์จาก Ads Library"
            aria-describedby="keyword-hint"
          />
          {keywordChoices.length > 0 && (
            <div className={styles.choices} role="group" aria-label="คำค้นของยูนิตนี้">
              {keywordChoices.map((choice) => (
                <button
                  type="button" key={choice} aria-pressed={keyword === choice}
                  onClick={() => { setKeyword(choice); setLinkNote(null); }}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
          <span id="keyword-hint" className={styles.hint} role="status">
            {linkNote ?? <>ใส่ในเครื่องหมายคำพูด เช่น <code>&quot;natto prime&quot;</code> เพื่อค้นตรงวลี · หรือวางลิงก์ค้นหาจาก Ads Library ระบบจะเติมคำค้น ประเทศ และสถานะให้</>}
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="category">หมวดหมู่</label>
          <input
            id="category" data-testid="category-input" list="category-options" value={categoryName}
            maxLength={MAX_CATEGORY_NAME} autoComplete="off"
            placeholder="เลือกหมวดที่มี หรือพิมพ์ชื่อใหม่ เช่น วิตามินผิว"
            onChange={(event) => setCategoryName(event.target.value)}
            aria-describedby="category-hint"
          />
          <datalist id="category-options">
            {categoryList.map((category) => <option key={category.id} value={category.name} />)}
          </datalist>
          <span id="category-hint" className={styles.hint} role="status" data-testid="category-hint">
            {categoryHint ?? "เลือกจากหมวดที่มี หรือพิมพ์ชื่อใหม่ได้เลย ระบบสร้างให้ตอนกดค้น"}
          </span>
        </div>

        <details
          className={styles.advanced} data-testid="collect-advanced"
          open={advancedOpen || advancedInvalid !== null}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            ตั้งค่าเพิ่มเติม
            <span className={styles.hint}>
              {" "}· {countryLabel(country)} · {activeStatus === "all" ? "ทุกสถานะ" : "กำลังแสดง"} · สูงสุด {maxRecords || "—"} แอด
            </span>
          </summary>
          <div className={styles.advancedBody}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="country">ประเทศ</label>
                <select
                  id="country" data-testid="country" value={country}
                  onChange={(event) => setCountry(event.target.value)}
                >
                  {settings.countries.map((code) => (
                    <option key={code} value={code}>{countryLabel(code)}</option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label htmlFor="active-status">สถานะโฆษณา</label>
                <select
                  id="active-status" data-testid="active-status" value={activeStatus}
                  onChange={(event) => setActiveStatus(event.target.value === "all" ? "all" : "active")}
                >
                  <option value="active">กำลังแสดง</option>
                  <option value="all">ทั้งหมด</option>
                </select>
              </div>

              <div className={styles.field}>
                <label htmlFor="max-records">จำนวนสูงสุด</label>
                <input
                  id="max-records" data-testid="max-records" type="number" inputMode="numeric"
                  min={1} max={cap ?? undefined} value={maxRecords}
                  onChange={(event) => setMaxRecords(event.target.value)}
                />
                {cap !== null && <span className={styles.hint}>สูงสุด {cap.toLocaleString("th-TH")} โฆษณา</span>}
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="dataset-name">ชื่อรอบข้อมูล</label>
              <input
                id="dataset-name" data-testid="dataset-name" value={nameValue} maxLength={200}
                onChange={(event) => { setTouchedName(true); setDatasetName(event.target.value); }}
              />
              <span className={styles.hint}>แก้ไขได้ · ตั้งให้อัตโนมัติจากคำค้นและประเทศ</span>
            </div>
          </div>
        </details>

        {problem && (
          <p className={styles.problem} role="alert" data-testid="collect-problem">{problem}</p>
        )}
        {invalid && keyword !== "" && (
          <p className={styles.hint} data-testid="collect-invalid">{invalid}</p>
        )}

        <button
          type="submit" className={styles.submit} data-testid="collect-submit"
          disabled={submitting || invalid !== null}
        >
          {submitting ? "กำลังส่งคำขอ…" : "ค้นและเก็บแอด →"}
        </button>
      </form>
  );

  return mode === "page" ? <div className={styles.layout}>{form}{aside}</div> : form;
}
