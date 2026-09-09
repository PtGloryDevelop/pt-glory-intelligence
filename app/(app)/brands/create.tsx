"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DUPLICATE_EXPLANATION } from "@/lib/brands/contract";
import { Panel, PanelHead } from "@/components/Surface";
import styles from "./brands.module.css";

/**
 * Creating a Brand.
 *
 * A name that normalizes to one already in use is refused and the existing
 * Brand is shown — as a link, never as a substitution. "Glory" and "GLORY" may
 * well be two different companies; nothing here decides that for a person.
 */
export function BrandCreate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);

  return (
    <Panel padded className={styles.create}>
      <PanelHead title="สร้างแบรนด์ใหม่" meta="เป็นการตัดสินใจของคน ไม่ใช่การเดาจากชื่อเพจ" />
      <form
        className={styles.createRow}
        data-testid="brand-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setDuplicates([]);
          const response = await fetch("/api/brands", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          setBusy(false);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(payload.error ?? "สร้างแบรนด์ไม่สำเร็จ");
            setDuplicates(payload.duplicates ?? []);
            return;
          }
          setName("");
          router.push(`/brands/${payload.id}`);
        }}
      >
        <label htmlFor="new-brand-name">ชื่อแบรนด์</label>
        <input
          id="new-brand-name"
          data-testid="brand-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
        />
        <button type="submit" data-variant="primary" data-testid="brand-create-submit" disabled={busy || name.trim() === ""}>
          {busy ? "กำลังสร้าง…" : "สร้างแบรนด์"}
        </button>
      </form>

      {error ? (
        <p className={styles.error} data-testid="brand-create-error">{error}</p>
      ) : null}
      {duplicates.length > 0 ? (
        <div className={styles.duplicates} data-testid="brand-duplicates">
          <p>{DUPLICATE_EXPLANATION}</p>
          <ul>
            {duplicates.map((brand) => (
              <li key={brand.id}>
                <a href={`/brands/${brand.id}`} data-testid={`brand-duplicate-${brand.id}`}>
                  {brand.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
