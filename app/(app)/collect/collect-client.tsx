"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { countryLabel, suggestedDatasetName, type CollectorFormSettings } from "@/lib/collect/form";
import type { CollectionDto } from "@/lib/collect/dto";
import { ErrorState } from "@/components/states/ErrorState";
import { thaiDateTime } from "@/lib/format/date";
import { parseAdLibraryUrl, type AdLibrarySearch } from "@/lib/collect/url";
import { MAX_CATEGORY_NAME } from "@/lib/categories/name";
import { CollectProgress } from "./[id]/progress-client";
import styles from "./collect.module.css";
import { UsageBars } from "@/components/UsageBars";
import { COLLECTION_STARTED } from "@/components/shell/CollectionWatcher";

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
/** The select's "type a new name" entry; category ids are UUIDs, so it never collides. */
const NEW_CATEGORY = "new";
/** The unit select's "general market research" entry; unit ids are UUIDs, so it never collides. */
const NO_UNIT = "none";
/** Shared with ส่องแอด's unit picker: the unit last chosen in this browser. */
const UNIT_KEY = "ptg:rival-unit";
const noSubscription = () => () => {};
const readSavedUnit = () => { try { return window.localStorage.getItem(UNIT_KEY) ?? ""; } catch { return ""; } };

/** What the form says after taking a link apart, so the reader sees how it will search. */
function linkNoteFor(search: AdLibrarySearch, known: boolean, fallbackCountry: string): string {
  const kind = search.pageId ? "ลิงก์หน้าเพจ" : search.query.startsWith('"') ? "ค้นตรงวลี" : "ค้นคำสำคัญ";
  return `ดึงจากลิงก์ Ads Library แล้ว · ${kind} · ${search.activeStatus === "all" ? "ทุกสถานะ" : "กำลังแสดง"}`
    + (known ? "" : ` · ประเทศ ${search.country} ยังไม่เปิดให้เก็บ จึงใช้ ${countryLabel(fallbackCountry)}`);
}

/**
 * `page` is the collect screen itself. `panel` is the same form opened beside
 * another screen (the competitor board), prefilled from where it was opened;
 * both show the progress and the first ads in place of the form once it starts.
 */
export function CollectClient(
  { requestKey, categories, units = [], settings, recent, mode = "page", initialKeyword = "", initialSearch, initialCategory, keywordChoices = [], onFinished }:
  {
    requestKey: string;
    categories: Category[];
    /** Our units. Choosing one makes the round's pages its rivals; the category then follows the unit's name. */
    units?: Category[];
    settings: CollectorFormSettings;
    recent: CollectionDto[];
    mode?: "page" | "panel";
    initialKeyword?: string;
    /** A link taken apart where the form was opened from: it fills keyword, country and status like a paste. */
    initialSearch?: AdLibrarySearch;
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
  const knownCountry = initialSearch !== undefined && settings.countries.includes(initialSearch.country);
  const [keyword, setKeyword] = useState(initialSearch?.query ?? initialKeyword);
  const [country, setCountry] = useState(knownCountry ? initialSearch!.country : settings.countries[0] ?? "");
  const [activeStatus, setActiveStatus] = useState<"active" | "all">(initialSearch?.activeStatus ?? "active");
  const [maxRecords, setMaxRecords] = useState(String(Math.min(300, settings.maxRecordsPerRun ?? 300)));
  const [categoryList, setCategoryList] = useState(categories);
  // A select, not a datalist: a datalist only offers names matching what is already in the box,
  // so a prefilled category hid every other one. A prefill naming no category starts a new one.
  const prefilled = initialCategory === undefined ? lastUsed
    : categories.find((category) => normalName(category.name) === normalName(initialCategory)) ?? null;
  const [categoryChoice, setCategoryChoice] = useState(prefilled?.id ?? (initialCategory ? NEW_CATEGORY : ""));
  const [newCategory, setNewCategory] = useState(prefilled ? "" : initialCategory ?? "");
  const chosenCategory = categoryChoice === NEW_CATEGORY ? newCategory
    : categoryList.find((category) => category.id === categoryChoice)?.name ?? "";
  // A category named after a unit ("U9", "คู่แข่ง U9") opened from that unit means the unit.
  const unitNamed = (name: string) => units.find((unit) =>
    normalName(name) === normalName(unit.name) || normalName(name) === normalName(`คู่แข่ง ${unit.name}`));
  // "" = not chosen yet (the form asks), NO_UNIT = chosen to be general market research.
  const [picked, setUnitChoice] = useState(
    (initialCategory !== undefined ? unitNamed(initialCategory)?.id : units.find((unit) => unit.id === recent[0]?.unitId)?.id) ?? "");
  // Otherwise the unit last chosen here or in ส่องแอด (it lives in this browser, so the server renders none).
  const saved = useSyncExternalStore(noSubscription, readSavedUnit, () => "");
  const unitChoice = picked || (initialCategory === undefined && units.some((item) => item.id === saved) ? saved : "");
  const unit = units.find((item) => item.id === unitChoice) ?? null;
  function chooseUnit(value: string) {
    setUnitChoice(value);
    try { if (value !== NO_UNIT) window.localStorage.setItem(UNIT_KEY, value); } catch { /* just not remembered */ }
  }
  // The category belongs to general research only; a unit files the round under its own name.
  const showCategory = units.length === 0 || unitChoice === NO_UNIT;
  // A pasted page link asks for that page's ads; its name is looked up so the round can carry it.
  const [pageLink, setPageLink] = useState<{ id: string; name: string | null } | null>(
    initialSearch?.pageId ? { id: initialSearch.pageId, name: null } : null);
  const [datasetName, setDatasetName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Refused as busy: the person's own round that holds the slot, when it is theirs to open.
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(initialSearch ? linkNoteFor(initialSearch, knownCountry, country) : null);

  /** A pasted Ad Library link fills keyword, country and status; anything else is typed as usual. */
  function fromLink(text: string): boolean {
    if (!/^\s*https?:\/\//i.test(text)) return false;
    const search = parseAdLibraryUrl(text);
    if (!search) { setLinkNote("ลิงก์นี้ใช้ไม่ได้ · รองรับลิงก์ผลค้นและลิงก์หน้าเพจจาก Ads Library"); return true; }
    setPageLink(search.pageId ? { id: search.pageId, name: null } : null);
    setKeyword(search.query);
    setActiveStatus(search.activeStatus);
    const known = settings.countries.includes(search.country);
    if (known) setCountry(search.country);
    setLinkNote(linkNoteFor(search, known, country));
    return true;
  }

  const pageId = pageLink?.id ?? null;
  useEffect(() => {
    if (!pageId) return;
    const controller = new AbortController();
    fetch(`/api/rivals/search?page=${pageId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { pages?: { page_name: string | null }[] } | null) => {
        const name = body?.pages?.[0]?.page_name ?? null;
        if (name) setPageLink((current) => current?.id === pageId ? { id: pageId, name } : current);
      }).catch(() => { /* the page is named by its number until it is collected */ });
    return () => controller.abort();
  }, [pageId]);
  // What the round is called by: a page round by its page, a word round by its words.
  const label = pageLink ? (pageLink.name ?? `เพจ ${pageLink.id}`).slice(0, 100) : keyword.trim();
  // Pages from a page link or an exact phrase become the unit's rivals by themselves (lib/collect/rivals.ts).
  const adopts = pageLink !== null || /^".+"$/.test(keyword.trim());

  // The suggestion follows what has been typed until somebody edits it, and
  // then it is theirs.
  const suggestion = label === "" || country === ""
    ? ""
    : suggestedDatasetName(label, country);
  const nameValue = touchedName ? datasetName : suggestion;

  // A unit files the round under a category of the unit's own name, made on submit if it is new.
  const categoryName = unit ? unit.name : chosenCategory;
  // A typed name either is an existing category or becomes a new one on submit.
  const matched = categoryList.find((category) => normalName(category.name) === normalName(categoryName)) ?? null;
  const categoryHint = categoryName.trim() === "" ? null
    : categoryChoice === NEW_CATEGORY
      ? (matched ? `มีหมวด “${matched.name}” อยู่แล้ว · จะใช้หมวดเดิม` : `จะสร้างหมวดหมู่ใหม่ “${categoryName.trim().replace(/\s+/g, " ")}” ให้ตอนกดค้น`)
      : matched?.id === lastUsed?.id ? "หมวดที่ใช้ล่าสุด · เลือกหมวดอื่นได้จากรายการ" : null;

  const cap = settings.maxRecordsPerRun;
  const records = Number(maxRecords);
  const advancedInvalid =
    country === "" ? "กรุณาเลือกประเทศ"
      : !Number.isInteger(records) || records < 1 ? "จำนวนสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1"
        : cap !== null && records > cap ? `จำนวนสูงสุดต้องไม่เกิน ${cap}`
          : nameValue.trim() === "" && label !== "" ? "กรุณาตั้งชื่อเรียกการค้นครั้งนี้"
            : null;
  const invalid =
    label === "" ? "กรุณาระบุคำค้น หรือวางลิงก์"
      : label.length > 100 ? "คำค้นยาวเกินไป"
        : units.length > 0 && unitChoice === "" ? "กรุณาเลือกยูนิต หรือเลือก “ไม่ระบุยูนิต”"
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
    setBusyWith(null);

    try {
      const categoryId = await resolveCategory();
      if (!categoryId) return;
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: label,
          ...(pageLink ? { pageId: pageLink.id } : {}),
          ...(unit ? { unitId: unit.id, unitName: unit.name } : {}),
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
        // The shell keeps it moving from any page, so the person can go on working.
        window.dispatchEvent(new CustomEvent(COLLECTION_STARTED));
        return;
      }
      setProblem(typeof payload?.message === "string" ? payload.message : FALLBACK_ERROR);
      if (payload?.error === "busy") void findBusy();
    } catch {
      setProblem(FALLBACK_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  async function findBusy() {
    const response = await fetch("/api/collections", { cache: "no-store" }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { collections: CollectionDto[] } | null : null;
    const running = body?.collections.find((item) => !["succeeded", "failed", "needs_admin"].includes(item.status));
    setBusyWith(running?.id ?? null);
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
          <label htmlFor="keyword">ค้นด้วย</label>
          {pageLink ? (
            <div className={styles.pageLink} data-testid="collect-page-link">
              <span><b>ลิงก์หน้าเพจ · {pageLink.name ?? `เลขเพจ ${pageLink.id}`}</b>
                <span className={styles.hint}>จะเก็บแอดทั้งหมดของเพจนี้</span></span>
              <button type="button" onClick={() => { setPageLink(null); setLinkNote(null); }}>ใช้คำค้นแทน</button>
            </div>
          ) : <input
            id="keyword" data-testid="keyword" value={keyword} maxLength={100}
            onChange={(event) => { if (!fromLink(event.target.value)) { setKeyword(event.target.value); setLinkNote(null); } }}
            onPaste={(event) => { if (fromLink(event.clipboardData.getData("text"))) event.preventDefault(); }}
            placeholder="เช่น วิตามินซี หรือวางลิงก์จาก Ads Library"
            aria-describedby="keyword-hint"
          />}
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
            {linkNote ?? <>วางลิงก์หน้าเพจหรือลิงก์ผลค้นจาก Ads Library · หรือพิมพ์คำ ใส่ในเครื่องหมายคำพูด เช่น <code>&quot;natto prime&quot;</code> เพื่อค้นตรงวลี</>}
          </span>
        </div>

        {units.length > 0 && (
          <div className={styles.field}>
            <label htmlFor="unit">เป็นคู่แข่งของยูนิต</label>
            <select id="unit" data-testid="unit-select" value={unitChoice} onChange={(event) => chooseUnit(event.target.value)} aria-describedby="unit-hint">
              <option value="" disabled>เลือกยูนิต…</option>
              {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              <option value={NO_UNIT}>ไม่ระบุยูนิต (สำรวจตลาดทั่วไป)</option>
            </select>
            <span id="unit-hint" className={unit ? styles.unitHint : styles.hint} role="status" data-testid="unit-hint">
              {unitChoice === NO_UNIT ? "สำรวจตลาด: แอดเก็บเข้าคลังตามหมวดด้านล่าง ไม่ผูกกับยูนิตไหน"
                : !unit ? "เลือกยูนิตที่จะหาคู่แข่งให้ · เก็บเสร็จแล้วเพจที่ได้จะขึ้นในติดตามคู่แข่งของยูนิตนั้น"
                : adopts ? `เก็บเสร็จแล้ว เพจที่ได้จะเป็นคู่แข่งของ ${unit.name} ทันที ไม่ต้องไปยืนยันอีก`
                  : `เก็บเสร็จแล้ว เลือกเพจที่ใช่ในหน้าผลลัพธ์ · คำค้นนี้จะถูกเพิ่มให้ ${unit.name}`}
            </span>
          </div>
        )}

        {showCategory && <div className={styles.field}>
          <label htmlFor="category">หมวดหมู่</label>
          <select
            id="category" data-testid="category-select" value={categoryChoice}
            onChange={(event) => setCategoryChoice(event.target.value)}
            aria-describedby="category-hint"
          >
            <option value="" disabled>เลือกหมวดหมู่…</option>
            {categoryList.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            <option value={NEW_CATEGORY}>+ สร้างหมวดใหม่…</option>
          </select>
          {categoryChoice === NEW_CATEGORY && (
            <input
              data-testid="category-input" value={newCategory} aria-label="ชื่อหมวดหมู่ใหม่"
              maxLength={MAX_CATEGORY_NAME} autoComplete="off" autoFocus={!initialCategory}
              placeholder="ชื่อหมวดใหม่ เช่น คู่แข่ง U9 วิตามินผิว"
              onChange={(event) => setNewCategory(event.target.value)}
              aria-describedby="category-hint"
            />
          )}
          <span id="category-hint" className={styles.hint} role="status" data-testid="category-hint">
            {categoryHint ?? "เลือกหมวดที่มี หรือเลือก “สร้างหมวดใหม่” แล้วพิมพ์ชื่อ ระบบสร้างให้ตอนกดค้น"}
          </span>
        </div>}

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
              <label htmlFor="dataset-name">ชื่อเรียกการค้นครั้งนี้</label>
              <input
                id="dataset-name" data-testid="dataset-name" value={nameValue} maxLength={200}
                placeholder="ระบบตั้งให้เมื่อพิมพ์คำค้น เช่น วิตามินซี · ไทย · 28 ต.ค. 2569"
                onChange={(event) => { setTouchedName(true); setDatasetName(event.target.value); }}
                aria-describedby="dataset-name-hint"
              />
              <span id="dataset-name-hint" className={styles.hint}>
                ใช้หาการค้นครั้งนี้ย้อนหลัง ในตัวกรอง “รอบที่เก็บ” ของหน้าส่องแอด และในรายการรอบเก็บข้อมูลล่าสุด · ตั้งให้จากคำค้น ประเทศ และวันที่ แก้ได้
              </span>
            </div>
          </div>
        </details>

        {problem && (
          <p className={styles.problem} role="alert" data-testid="collect-problem">
            {problem}
            {busyWith ? <> · <Link href={`/collect/${busyWith}`} data-testid="collect-busy-link">ดูรอบที่กำลังเก็บอยู่</Link></> : null}
          </p>
        )}
        {invalid && label !== "" && (
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
