"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./compare.module.css";

/**
 * Scope first, then two pages inside it.
 *
 * Changing the scope clears both pages on purpose: a page chosen in one scope
 * may not exist in the next, and carrying it over would produce a comparison
 * the reader never asked for — or a refusal they cannot explain.
 */
export function CompareChooser({ scope, pageA, pageB, datasets, categories, pages }: {
  scope: string;
  pageA: string;
  pageB: string;
  datasets: { value: string; label: string }[];
  categories: { value: string; label: string }[];
  pages: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [a, setA] = useState(pageA);
  const [b, setB] = useState(pageB);

  const ready = scope !== "" && a !== "" && b !== "" && a !== b;

  return (
    <form
      className={styles.chooser}
      data-testid="compare-chooser"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) router.push(`/compare?scope=${scope}&a=${a}&b=${b}`);
      }}
    >
      <label className={styles.field} htmlFor="compare-scope">
        <span className={styles.label}>ขอบเขตข้อมูล</span>
        <select
          id="compare-scope" data-testid="compare-scope" value={scope}
          onChange={(event) => {
            // Both pages are dropped with the scope they were chosen in.
            router.push(event.target.value ? `/compare?scope=${event.target.value}` : "/compare");
          }}
        >
          <option value="">เลือกขอบเขต…</option>
          <option value="all">ทุกข้อมูลที่เก็บมา</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
          {datasets.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor="compare-a">
        <span className={styles.label}>Page A</span>
        <select
          id="compare-a" data-testid="compare-a" value={a} disabled={!scope}
          onChange={(event) => setA(event.target.value)}
        >
          <option value="">เลือกเพจ…</option>
          {pages.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor="compare-b">
        <span className={styles.label}>Page B</span>
        <select
          id="compare-b" data-testid="compare-b" value={b} disabled={!scope}
          onChange={(event) => setB(event.target.value)}
        >
          <option value="">เลือกเพจ…</option>
          {/* The same page on both sides is not a comparison. */}
          {pages.filter((option) => option.id !== a).map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <button type="submit" data-variant="primary" data-testid="compare-go" disabled={!ready}>
        เปรียบเทียบ
      </button>

      {scope && pages.length < 2 ? (
        <p className={styles.chooserNote} data-testid="chooser-thin">
          ขอบเขตนี้มีเพจไม่ถึงสองเพจ — เลือกขอบเขตที่กว้างกว่านี้เพื่อเปรียบเทียบ
        </p>
      ) : null}
    </form>
  );
}
