"use client";

import { useState } from "react";
import { mediaUrls, type Media } from "@/lib/media";
import { StatusBadge } from "./StatusBadge";
import styles from "./AdCard.module.css";

/**
 * One ad in the research grid. The creative dominates; everything else is
 * supporting metadata in a fixed reading order.
 *
 * Every field is a stored observation from the dataset's own run. Nothing on
 * this card is a performance figure, because the source has none — no
 * engagement, no reach, no spend, and no "winning ad" score derived from them.
 */

export type AdCardData = {
  ad_archive_id: string;
  page_name: string | null;
  is_active: boolean | null;
  body_text: string | null;
  title: string | null;
  display_format: string | null;
  cta_type: string | null;
  publisher_platform: string[] | null;
  start_date: string;
  ad_age_days: number;
  collation_count: number | null;
  media: Media;
};

export function AdCard({ ad, onOpen }: { ad: AdCardData; onOpen: () => void }) {
  return (
    <article className={styles.card} data-testid={`ad-card-${ad.ad_archive_id}`}>
      <button
        type="button"
        className={styles.hit}
        data-testid={`open-ad-${ad.ad_archive_id}`}
        onClick={onOpen}
        aria-label={`เปิดรายละเอียดโฆษณา ${ad.ad_archive_id}`}
      >
        <Preview media={ad.media} />
      </button>

      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.page} title={ad.page_name ?? undefined}>
            {ad.page_name ?? "—"}
          </span>
          <StatusBadge isActive={ad.is_active} />
        </div>

        {/* Copy preview, clamped. The full text lives in the drawer. */}
        <p className={styles.copy} data-testid={`card-copy-${ad.ad_archive_id}`}>
          {ad.body_text ?? ad.title ?? "—"}
        </p>

        <div className={styles.meta}>
          <span className={styles.tag}>{ad.display_format ?? "—"}</span>
          <span className={styles.tag}>{ad.cta_type ?? "—"}</span>
        </div>

        <div className={styles.platforms}>
          {ad.publisher_platform?.length ? ad.publisher_platform.join(" · ") : "—"}
        </div>

        <div className={styles.foot}>
          <span>
            เริ่ม {new Date(ad.start_date).toLocaleDateString("th-TH")} · {ad.ad_age_days} วัน
          </span>
          {/* Reuse is a stored collation count, not a popularity signal. */}
          {ad.collation_count && ad.collation_count > 1 ? (
            <span className={styles.reuse} data-testid={`card-reuse-${ad.ad_archive_id}`}>
              ใช้ซ้ำ {ad.collation_count}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Media lives on Meta's CDN and those URLs expire, so a creative that will not
 * load is normal rather than an error. The placeholder stays neutral: inventing
 * artwork for an ad whose creative we never captured would be a fabrication.
 */
function Preview({ media }: { media: Media }) {
  const [broken, setBroken] = useState(false);
  const url = mediaUrls(media)[0];

  if (!url || broken) {
    return (
      <div className={styles.placeholder} data-testid="card-media-placeholder">
        {url ? "สื่อโหลดไม่ได้ (ลิงก์ต้นทางหมดอายุ)" : "ไม่มีสื่อที่บันทึกไว้"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader
    <img
      className={styles.media}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      data-testid="card-media"
    />
  );
}
