"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MOVE_EXPLANATION, UNMAP_EXPLANATION, DUPLICATE_EXPLANATION,
} from "@/lib/brands/contract";
import styles from "./MapPageControl.module.css";

type BrandOption = { id: string; name: string; status: string; active_pages: number };

/**
 * The one place a Page is attached to a Brand, moved, or detached.
 *
 * Three rules the UI has to keep, because the database cannot express them:
 *
 *   1. Nothing is submitted by typing. Searching is searching; creating a Brand
 *      is a separate button; mapping is a third. A picker that mapped on Enter
 *      would turn a typo into an editorial decision with somebody's name on it.
 *   2. A move says which Brand it is leaving and which it is joining, and asks.
 *      It is not a merge, and the wording never calls it one.
 *   3. A duplicate name is shown, never chosen. Two companies may share a name.
 */
export function MapPageControl({ pageId, currentBrand, canEdit, testId = "map-page" }: {
  pageId: string;
  currentBrand: { id: string; name: string } | null;
  canEdit: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrandOption[] | null>(null);
  const [selected, setSelected] = useState<BrandOption | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "search" | "create" | "map" | "unmap">(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<BrandOption[]>([]);

  if (!canEdit) {
    // A viewer reads the grouping and changes nothing. The control is absent
    // rather than disabled: there is no action here for them to discover.
    return (
      <span className={styles.readonly} data-testid={`${testId}-readonly`}>
        {currentBrand ? currentBrand.name : "ยังไม่จับคู่"}
      </span>
    );
  }

  const search = async () => {
    setBusy("search");
    setError(null);
    const response = await fetch(`/api/brands?search=${encodeURIComponent(query)}`);
    setBusy(null);
    if (!response.ok) { setError("ค้นหาแบรนด์ไม่สำเร็จ"); return; }
    const payload = await response.json();
    setResults(payload.brands ?? []);
  };

  const createBrand = async () => {
    setBusy("create");
    setError(null);
    setDuplicates([]);
    const response = await fetch("/api/brands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: query }),
    });
    setBusy(null);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "สร้างแบรนด์ไม่สำเร็จ");
      // The existing Brand is offered, not applied.
      setDuplicates(payload.duplicates ?? []);
      return;
    }
    setSelected({ id: payload.id, name: query.trim(), status: "active", active_pages: 0 });
    setResults(null);
  };

  const map = async () => {
    if (!selected) return;
    setBusy("map");
    setError(null);
    const response = await fetch("/api/brand-mappings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId: selected.id, pageId, note: note || null }),
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "จับคู่ไม่สำเร็จ");
      return;
    }
    setOpen(false);
    setSelected(null);
    setNote("");
    setQuery("");
    setResults(null);
    router.refresh();
  };

  const unmap = async () => {
    setBusy("unmap");
    setError(null);
    const response = await fetch(`/api/brand-mappings?pageId=${encodeURIComponent(pageId)}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "เลิกจับคู่ไม่สำเร็จ");
      return;
    }
    router.refresh();
  };

  return (
    <div className={styles.wrap} data-testid={testId}>
      {!open ? (
        <div className={styles.actions}>
          <button type="button" data-testid={`${testId}-open`} onClick={() => setOpen(true)}>
            {currentBrand ? "ย้ายแบรนด์" : "จับคู่แบรนด์"}
          </button>
          {currentBrand ? (
            <button
              type="button" data-testid={`${testId}-unmap`}
              disabled={busy !== null} onClick={unmap}
            >
              {busy === "unmap" ? "กำลังเลิกจับคู่…" : "เลิกจับคู่"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.panel}>
          <label className={styles.field} htmlFor={`${testId}-query`}>
            <span>ค้นหาแบรนด์</span>
            <input
              id={`${testId}-query`}
              data-testid={`${testId}-query`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter searches. It never maps and never creates: both of those
                // are decisions, and a decision needs its own button.
                if (event.key === "Enter") { event.preventDefault(); void search(); }
              }}
              placeholder="ชื่อแบรนด์"
            />
          </label>
          <div className={styles.actions}>
            <button
              type="button" data-testid={`${testId}-search`}
              disabled={busy !== null} onClick={search}
            >
              {busy === "search" ? "กำลังค้นหา…" : "ค้นหา"}
            </button>
            <button
              type="button" data-testid={`${testId}-create`}
              disabled={busy !== null || query.trim() === ""} onClick={createBrand}
            >
              สร้างแบรนด์ใหม่
            </button>
          </div>

          {duplicates.length > 0 ? (
            <div className={styles.duplicates} data-testid={`${testId}-duplicates`}>
              <p>{DUPLICATE_EXPLANATION}</p>
              <ul>
                {duplicates.map((brand) => (
                  <li key={brand.id}>
                    <button
                      type="button"
                      data-testid={`${testId}-pick-${brand.id}`}
                      onClick={() => { setSelected(brand); setDuplicates([]); setError(null); }}
                    >
                      เลือก {brand.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {results ? (
            results.length === 0 ? (
              <p className={styles.empty} data-testid={`${testId}-no-results`}>
                ไม่พบแบรนด์ที่ตรงกับคำค้นนี้ — กด “สร้างแบรนด์ใหม่” ถ้าต้องการสร้าง
              </p>
            ) : (
              <ul className={styles.results} data-testid={`${testId}-results`}>
                {results.map((brand) => (
                  <li key={brand.id}>
                    <button
                      type="button"
                      data-testid={`${testId}-pick-${brand.id}`}
                      aria-pressed={selected?.id === brand.id}
                      className={selected?.id === brand.id ? styles.picked : undefined}
                      onClick={() => setSelected(brand)}
                    >
                      {brand.name}
                      <span className={styles.meta}>{brand.active_pages} เพจ</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {selected ? (
            <div className={styles.confirm} data-testid={`${testId}-confirm-panel`}>
              {currentBrand ? (
                <p className={styles.move} data-testid={`${testId}-move-explanation`}>
                  ย้ายจาก <strong>{currentBrand.name}</strong> ไปยัง <strong>{selected.name}</strong>
                  <span className={styles.hint}>{MOVE_EXPLANATION}</span>
                </p>
              ) : (
                <p data-testid={`${testId}-map-explanation`}>
                  จับคู่เพจนี้กับ <strong>{selected.name}</strong>
                </p>
              )}
              <label className={styles.field} htmlFor={`${testId}-note`}>
                <span>เหตุผล / บันทึก (ไม่บังคับ)</span>
                <input
                  id={`${testId}-note`} data-testid={`${testId}-note`}
                  value={note} onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div className={styles.actions}>
                <button
                  type="button" data-variant="primary" data-testid={`${testId}-confirm`}
                  disabled={busy !== null} onClick={map}
                >
                  {busy === "map" ? "กำลังบันทึก…" : currentBrand ? "ยืนยันย้ายแบรนด์" : "ยืนยันจับคู่"}
                </button>
                <button type="button" onClick={() => setSelected(null)}>ยกเลิก</button>
              </div>
            </div>
          ) : null}

          {!selected ? (
            <button
              type="button" className={styles.close}
              data-testid={`${testId}-close`}
              onClick={() => { setOpen(false); setError(null); setDuplicates([]); }}
            >
              ปิด
            </button>
          ) : null}
        </div>
      )}

      {currentBrand && !open ? (
        <p className={styles.hint} data-testid={`${testId}-unmap-hint`}>{UNMAP_EXPLANATION}</p>
      ) : null}
      {error ? <p className={styles.error} data-testid={`${testId}-error`}>{error}</p> : null}
    </div>
  );
}
