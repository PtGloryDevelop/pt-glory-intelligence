"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ARCHIVE_EXPLANATION, type BrandStatus } from "@/lib/brands/contract";
import { Panel, PanelHead } from "@/components/Surface";
import styles from "../brands.module.css";

/**
 * Editing a Brand.
 *
 * Rename is safe by construction: identity is the uuid, so "Glory" becoming
 * "Glory Thailand" moves no mapping and breaks no reference.
 *
 * There is no delete. A Brand that has ever held a Page is the record of a
 * decision somebody made, and archiving is what "we stopped using this
 * grouping" actually means — the history stays, new mappings stop.
 */
export function BrandControls({ id, name, notes, status, hasHistory }: {
  id: string;
  name: string;
  notes: string | null;
  status: BrandStatus;
  hasHistory: boolean;
}) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "status">(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);

  const patch = async (kind: "save" | "status", body: Record<string, unknown>) => {
    setBusy(kind);
    setError(null);
    setDuplicates([]);
    const response = await fetch(`/api/brands/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "แก้ไขไม่สำเร็จ");
      setDuplicates(payload.duplicates ?? []);
      return false;
    }
    router.refresh();
    return true;
  };

  const dirty = draftName !== name || draftNotes !== (notes ?? "");

  return (
    <Panel padded className={styles.section}>
      <PanelHead title="จัดการแบรนด์" meta="ชื่อเปลี่ยนได้ · การจับคู่ไม่หลุด เพราะตัวตนคือ Brand ID" />

      <div className={styles.editRow}>
        <label htmlFor="brand-name">
          <span>ชื่อแบรนด์</span>
          <input
            id="brand-name" data-testid="brand-rename"
            value={draftName} maxLength={120}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
        <label htmlFor="brand-notes">
          <span>บันทึกภายใน (ไม่ใช่หลักฐาน)</span>
          <textarea
            id="brand-notes" data-testid="brand-notes" rows={2} maxLength={2000}
            value={draftNotes}
            onChange={(event) => setDraftNotes(event.target.value)}
          />
        </label>
        <button
          type="button" data-variant="primary" data-testid="brand-save"
          disabled={!dirty || draftName.trim() === "" || busy !== null}
          onClick={() => patch("save", { name: draftName, notes: draftNotes })}
        >
          {busy === "save" ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>

      <div className={styles.editRow}>
        {status === "active" ? (
          confirmingArchive ? (
            <>
              <p className={styles.basis} data-testid="archive-explanation">{ARCHIVE_EXPLANATION}</p>
              <button
                type="button" data-variant="danger" data-testid="confirm-archive"
                disabled={busy !== null}
                onClick={async () => {
                  if (await patch("status", { status: "archived" })) setConfirmingArchive(false);
                }}
              >
                {busy === "status" ? "กำลังเก็บ…" : "ยืนยันเก็บเข้าคลัง"}
              </button>
              <button type="button" onClick={() => setConfirmingArchive(false)}>ยกเลิก</button>
            </>
          ) : (
            <button type="button" data-testid="archive-brand" onClick={() => setConfirmingArchive(true)}>
              เก็บแบรนด์เข้าคลัง
            </button>
          )
        ) : (
          <button
            type="button" data-testid="restore-brand" disabled={busy !== null}
            onClick={() => patch("status", { status: "active" })}
          >
            {busy === "status" ? "กำลังเปิดใช้งาน…" : "เปิดใช้งานแบรนด์อีกครั้ง"}
          </button>
        )}
        <p className={styles.basis} data-testid="no-delete-note">
          {hasHistory
            ? "แบรนด์นี้มีประวัติการจับคู่แล้ว จึงไม่มีปุ่มลบ — การเก็บเข้าคลังรักษาประวัติไว้ทั้งหมด"
            : "ระบบไม่มีการลบแบรนด์ เพราะประวัติการตัดสินใจต้องอยู่ครบ"}
        </p>
      </div>

      {error ? <p className={styles.error} data-testid="brand-edit-error">{error}</p> : null}
      {duplicates.length > 0 ? (
        <ul className={styles.duplicates} data-testid="brand-edit-duplicates">
          {duplicates.map((brand) => (
            <li key={brand.id}>{brand.name}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
