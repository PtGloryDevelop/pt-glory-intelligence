"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PAGE_SORTS, RECENT_DAYS } from "@/lib/pages/scope";
import styles from "./pages.module.css";

/**
 * The Page list's research state, kept in the URL.
 *
 * Deliberately a form rather than a live-filtering client component: the list is
 * server-rendered from SQL, so every keystroke would be a round trip. Submitting
 * on Enter or on change is one navigation, and the resulting URL is shareable —
 * the same rule the Explorer follows, reached with far less machinery.
 */
export function PageToolbar({ scope, search, active, sort, recentDays }: {
  scope: string;
  search: string;
  active: string;
  sort: string;
  recentDays: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(search);

  const go = (extra: Record<string, string>) => {
    const query = new URLSearchParams();
    query.set("scope", scope);
    const next = { search: draft, active, sort, recentDays: String(recentDays), ...extra };
    for (const [key, value] of Object.entries(next)) {
      if (value !== "" && value !== undefined) query.set(key, value);
    }
    // A new filter starts at the first page; keeping the offset would land the
    // reader in the middle of a set they have not seen the start of.
    query.delete("offset");
    router.push(`/pages?${query.toString()}`);
  };

  return (
    <form
      className={styles.toolbar}
      data-testid="pages-toolbar"
      onSubmit={(event) => { event.preventDefault(); go({}); }}
    >
      <label className={styles.search} htmlFor="page-search">
        <span className={styles.label}>ค้นชื่อเพจ</span>
        <input
          id="page-search"
          data-testid="page-search"
          value={draft}
          placeholder="ชื่อเพจ หรือ Page ID"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>

      <label className={styles.field} htmlFor="page-active">
        <span className={styles.label}>มีโฆษณาสถานะ</span>
        <select
          id="page-active" data-testid="page-active" value={active}
          onChange={(event) => go({ active: event.target.value })}
        >
          <option value="">ทั้งหมด</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="unknown">ไม่ทราบ</option>
        </select>
      </label>

      <label className={styles.field} htmlFor="page-recent">
        <span className={styles.label}>หน้าต่าง “พบใหม่”</span>
        <select
          id="page-recent" data-testid="page-recent" value={String(recentDays)}
          onChange={(event) => go({ recentDays: event.target.value })}
        >
          {RECENT_DAYS.map((days) => (
            <option key={days} value={days}>{days} วัน</option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor="page-sort">
        <span className={styles.label}>เรียงตาม</span>
        <select
          id="page-sort" data-testid="page-sort" value={sort}
          onChange={(event) => go({ sort: event.target.value })}
        >
          {PAGE_SORTS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </label>

      <button type="submit" data-variant="primary" data-testid="page-search-submit">ค้นหา</button>
    </form>
  );
}
