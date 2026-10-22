"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_CATEGORY_NAME } from "@/lib/categories/name";
import { Panel, PanelHead } from "@/components/Surface";
import styles from "./categories.module.css";

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.error ?? "บันทึกไม่สำเร็จ";
}

export function CategoryCreate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel padded className={styles.create}>
      <PanelHead title="เพิ่มหมวดหมู่" meta="ใช้จัดกลุ่ม Dataset ตอนนำเข้าและเก็บข้อมูล" />
      <form className={styles.row} data-testid="category-create-form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setError(null);
        const problem = await send("/api/categories", "POST", { name });
        setBusy(false);
        if (problem) return setError(problem);
        setName(""); router.refresh();
      }}>
        <label htmlFor="new-category-name">ชื่อหมวดหมู่</label>
        <input id="new-category-name" data-testid="category-name-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_CATEGORY_NAME} />
        <button type="submit" data-variant="primary" disabled={busy || name.trim() === ""}>{busy ? "กำลังเพิ่ม…" : "เพิ่มหมวดหมู่"}</button>
      </form>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </Panel>
  );
}

/** Rename for analyst+, delete for admin. Delete is refused by the server while datasets remain. */
export function CategoryRowActions({ id, name, datasets, canDelete }: { id: string; name: string; datasets: number; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<string | null>) {
    setBusy(true); setError(null);
    const problem = await work();
    setBusy(false);
    if (problem) return setError(problem);
    setEditing(false); router.refresh();
  }

  if (editing) return (
    <form className={styles.row} onSubmit={(event) => { event.preventDefault(); void run(() => send(`/api/categories/${id}`, "PATCH", { name: value })); }}>
      <input aria-label={`ชื่อใหม่ของ ${name}`} value={value} onChange={(event) => setValue(event.target.value)} maxLength={MAX_CATEGORY_NAME} autoFocus />
      <button type="submit" data-variant="primary" disabled={busy || value.trim() === ""}>บันทึก</button>
      <button type="button" onClick={() => { setEditing(false); setValue(name); setError(null); }}>ยกเลิก</button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </form>
  );
  return (
    <div className={styles.row}>
      <button type="button" onClick={() => setEditing(true)} data-testid={`category-rename-${id}`}>แก้ชื่อ</button>
      {canDelete ? (
        <button type="button" disabled={busy || datasets > 0} title={datasets > 0 ? "ลบได้เมื่อไม่มี Dataset ในหมวดนี้" : undefined} data-testid={`category-delete-${id}`}
          onClick={() => { if (window.confirm(`ลบหมวดหมู่ “${name}”?
รายการ Watchlist ของทุกคนที่ผูกกับหมวดนี้จะถูกลบไปด้วย`)) void run(() => send(`/api/categories/${id}`, "DELETE")); }}>ลบ</button>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
