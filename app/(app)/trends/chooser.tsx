"use client";

import { useRouter } from "next/navigation";
import styles from "./trends.module.css";

/**
 * Which data the trend is about.
 *
 * A trend with no stated scope would be a change in "everything we happen to
 * have", which is a fact about our collection schedule rather than about
 * anything a researcher asked. So the scope is chosen first, and it stays in
 * the URL from then on.
 */
export function TrendChooser({ categories, datasets }: {
  categories: { value: string; label: string }[];
  datasets: { value: string; label: string }[];
}) {
  const router = useRouter();

  return (
    <form className={styles.chooser} data-testid="trend-chooser">
      <label className={styles.field} htmlFor="trend-scope">
        <span className={styles.controlLabel}>ขอบเขตข้อมูล</span>
        <select
          id="trend-scope" data-testid="trend-scope" defaultValue=""
          onChange={(event) => {
            if (event.target.value) router.push(`/trends?scope=${event.target.value}`);
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
      <p className={styles.controlNote}>
        เลือกหมวดหรือ Dataset แล้วจึงเจาะดูรายเพจได้จากตารางอันดับ
      </p>
    </form>
  );
}
