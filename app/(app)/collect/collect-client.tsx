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
 * Nothing about a provider appears in this file, and the only endpoint it knows
 * is the product's own.
 */

type Category = { id: string; name: string };

const FALLBACK_ERROR = "ไม่สามารถเริ่มเก็บข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
// A select value no category id can take (ids are UUIDs).
const NEW_CATEGORY = "__new__";
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

export function CollectClient(
  { requestKey, categories, settings, recent }:
  {
    requestKey: string;
    categories: Category[];
    settings: CollectorFormSettings;
    recent: CollectionDto[];
  },
) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [country, setCountry] = useState(settings.countries[0] ?? "");
  const [activeStatus, setActiveStatus] = useState<"active" | "all">("active");
  const [maxRecords, setMaxRecords] = useState(String(Math.min(300, settings.maxRecordsPerRun ?? 300)));
  const [categoryId, setCategoryId] = useState("");
  const [categoryList, setCategoryList] = useState(categories);
  // With no categories yet there is nothing to pick, so the name box is already open.
  const [creatingCategory, setCreatingCategory] = useState(categories.length === 0);
  const [newCategory, setNewCategory] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryNote, setCategoryNote] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
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

  /**
   * Creating a category used to mean leaving this form for the categories page
   * and coming back. Now it happens in place: the existing endpoint creates it
   * (same analyst rule as this page), it joins the list and is selected.
   */
  function openNewCategory() {
    setCreatingCategory(true);
    setCategoryNote(null);
    if (newCategory.trim() === "") setNewCategory(keyword.replace(/["“”]/g, "").trim());
  }

  async function createCategory() {
    const name = newCategory.trim();
    if (name === "" || categoryBusy) return;
    // Typing a name that already exists picks it rather than failing on the duplicate.
    const existing = categoryList.find((category) => sameName(category.name, name));
    if (existing) {
      setCategoryId(existing.id);
      setCreatingCategory(false);
      setCategoryNote(`มีหมวดหมู่ “${existing.name}” อยู่แล้ว · เลือกให้แล้ว`);
      return;
    }
    setCategoryBusy(true);
    setCategoryNote(null);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && typeof payload?.id === "string") {
        setCategoryList((list) => [...list, { id: payload.id, name }].sort((a, b) => a.name.localeCompare(b.name, "th")));
        setCategoryId(payload.id);
        setCreatingCategory(false);
        setNewCategory("");
        setCategoryNote(`สร้างหมวดหมู่ “${name}” แล้ว · เลือกให้แล้ว`);
        return;
      }
      setCategoryNote(typeof payload?.error === "string" ? payload.error : "สร้างหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่");
    } catch {
      setCategoryNote("สร้างหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCategoryBusy(false);
    }
  }

  // The suggestion follows what has been typed until somebody edits it, and
  // then it is theirs.
  const suggestion = keyword.trim() === "" || country === ""
    ? ""
    : suggestedDatasetName(keyword, country);
  const nameValue = touchedName ? datasetName : suggestion;

  const cap = settings.maxRecordsPerRun;
  const records = Number(maxRecords);
  const invalid =
    keyword.trim() === "" ? "กรุณาระบุคำค้น"
      : keyword.trim().length > 100 ? "คำค้นยาวเกินไป"
        : country === "" ? "กรุณาเลือกประเทศ"
          : categoryId === "" ? "กรุณาเลือกหมวดหมู่"
            : !Number.isInteger(records) || records < 1 ? "จำนวนสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1"
              : cap !== null && records > cap ? `จำนวนสูงสุดต้องไม่เกิน ${cap}`
                : nameValue.trim() === "" ? "กรุณาตั้งชื่อ Dataset"
                  : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // The guard that matters is the shared key below; this only keeps the
    // screen honest while the first answer is still coming back.
    if (submitting || invalid) return;
    setSubmitting(true);
    setProblem(null);

    try {
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
        // land on the same progress view.
        router.push(`/collect/${payload.id}`);
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

  return (
    <div className={styles.layout}>
      <form className={styles.form} onSubmit={submit} data-testid="collect-form">
        <UsageBars show={["collect"]} />
        <div className={styles.field}>
          <label htmlFor="keyword">คำค้น</label>
          <input
            id="keyword" data-testid="keyword" value={keyword} maxLength={100}
            onChange={(event) => { if (!fromLink(event.target.value)) { setKeyword(event.target.value); setLinkNote(null); } }}
            onPaste={(event) => { if (fromLink(event.clipboardData.getData("text"))) event.preventDefault(); }}
            placeholder="เช่น วิตามินซี หรือวางลิงก์จาก Ads Library"
            aria-describedby="keyword-hint"
          />
          <span id="keyword-hint" className={styles.hint} role="status">
            {linkNote ?? <>ใส่ในเครื่องหมายคำพูด เช่น <code>&quot;natto prime&quot;</code> เพื่อค้นตรงวลี · หรือวางลิงก์ค้นหาจาก Ads Library ระบบจะเติมคำค้น ประเทศ และสถานะให้</>}
          </span>
        </div>

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
          <label htmlFor="category">หมวดหมู่</label>
          <select
            id="category" data-testid="category-select" value={creatingCategory ? NEW_CATEGORY : categoryId}
            onChange={(event) => {
              if (event.target.value === NEW_CATEGORY) { setCategoryId(""); openNewCategory(); return; }
              setCreatingCategory(false);
              setCategoryNote(null);
              setCategoryId(event.target.value);
            }}
          >
            {/* No default: which research this belongs to is a decision, and a
                pre-selected category would make it for somebody. */}
            <option value="">— เลือกหมวดหมู่ —</option>
            {categoryList.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
            <option value={NEW_CATEGORY}>+ สร้างหมวดหมู่ใหม่</option>
          </select>
          {creatingCategory && (
            // Not a nested <form>: Enter here creates the category instead of submitting the collection.
            <div className={styles.inlineCreate}>
              <input
                aria-label="ชื่อหมวดหมู่ใหม่" data-testid="category-new-name" value={newCategory}
                maxLength={MAX_CATEGORY_NAME} placeholder="ชื่อหมวดหมู่ใหม่ เช่น วิตามินผิว" autoFocus={categoryList.length > 0}
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createCategory(); } }}
              />
              <button
                type="button" className={styles.inlineCreateButton} data-testid="category-new-submit"
                disabled={categoryBusy || newCategory.trim() === ""} onClick={() => void createCategory()}
              >
                {categoryBusy ? "กำลังสร้าง…" : "สร้างและเลือก"}
              </button>
              {categoryList.length > 0 && (
                <button type="button" onClick={() => { setCreatingCategory(false); setCategoryNote(null); }}>ยกเลิก</button>
              )}
            </div>
          )}
          {categoryNote && <span className={styles.hint} role="status" data-testid="category-note">{categoryNote}</span>}
        </div>

        <div className={styles.field}>
          <label htmlFor="dataset-name">ชื่อรอบข้อมูล</label>
          <input
            id="dataset-name" data-testid="dataset-name" value={nameValue} maxLength={200}
            onChange={(event) => { setTouchedName(true); setDatasetName(event.target.value); }}
          />
          <span className={styles.hint}>แก้ไขได้ · ตั้งให้อัตโนมัติจากคำค้นและประเทศ</span>
        </div>

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
    </div>
  );
}
