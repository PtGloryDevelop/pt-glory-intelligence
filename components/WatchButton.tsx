"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./WatchButton.module.css";

/**
 * Saves the thing being looked at, in the scope it is being looked at in.
 *
 * The scope travels with the target because a watch on a page inside one
 * category answers a different question from a watch on the same page across
 * everything — and quietly widening it to `all` would give the reader numbers
 * they never asked for.
 *
 * When the same target and scope is already saved, this is a link to it rather
 * than a second copy.
 */
export function WatchButton({ targetType, pageId, categoryId, scope, signals, existingId, testId = "watch-button" }: {
  targetType: "page" | "category";
  pageId?: string;
  categoryId?: string;
  /** `all`, `dataset:<uuid>` or `category:<uuid>` — the scope on screen. */
  scope: string;
  signals: string[];
  /** Set when this exact target and scope is already watched. */
  existingId?: string | null;
  testId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existingId) {
    return (
      <Link href={`/watchlist/${existingId}`} data-testid={`${testId}-existing`}>
        กำลังติดตาม
      </Link>
    );
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        data-testid={testId}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const response = await fetch("/api/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetType, pageId, categoryId, scope, signals }),
          });
          setBusy(false);
          if (response.ok) {
            const { id } = await response.json();
            router.push(`/watchlist/${id}`);
            return;
          }
          const payload = await response.json().catch(() => ({}));
          // A duplicate is an answer, not a failure: the watch already exists.
          setError(response.status === 409 ? "ติดตามรายการนี้อยู่แล้ว" : (payload.error ?? "บันทึกไม่สำเร็จ"));
        }}
      >
        {busy ? "กำลังบันทึก…" : targetType === "page" ? "ติดตามเพจนี้" : "ติดตามหมวดนี้"}
      </button>
      {error ? <span className={styles.error} data-testid={`${testId}-error`}>{error}</span> : null}
    </span>
  );
}
