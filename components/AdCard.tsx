"use client";

import { useState } from "react";
import { type Media } from "@/lib/media";
import { resolveMedia } from "@/lib/media/resolve";
import { formatIdentity } from "@/lib/media/format";
import { thaiDate } from "@/lib/format/date";
import { StatusBadge } from "./StatusBadge";
import styles from "./AdCard.module.css";

/**
 * One ad in the research grid. The creative dominates; everything else is
 * supporting metadata in a fixed reading order:
 *
 *   creative → page + status → copy → CTA/platforms → started/age → reuse
 *
 * Every field is a stored observation from the dataset's own run. Nothing here
 * is a performance figure, because the source has none — no engagement, no
 * reach, no spend, and no "winning ad" score derived from them.
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
  /** Short-lived delivery URL for the archived preview, when one exists. */
  archive_url?: string | null;
  archive_status?: string | null;
};

export function AdCard({ ad, onOpen }: { ad: AdCardData; onOpen: () => void }) {
  const identity = formatIdentity(ad.display_format);
  const reused = ad.collation_count && ad.collation_count > 1 ? ad.collation_count : null;

  return (
    <article className={styles.card} data-testid={`ad-card-${ad.ad_archive_id}`}>
      {/* The whole card opens the drawer, not just the image. */}
      <button
        type="button"
        className={styles.hit}
        data-testid={`open-ad-${ad.ad_archive_id}`}
        onClick={onOpen}
        aria-label={`เปิดรายละเอียดโฆษณาของ ${ad.page_name ?? "เพจที่ไม่ทราบชื่อ"}`}
      >
        <div className={styles.frame}>
          <Preview ad={ad} />
          {identity ? (
            <span className={styles.formatTag} data-testid={`card-format-${ad.ad_archive_id}`}>
              {identity.isVideo ? <VideoGlyph /> : null}
              {identity.label}
            </span>
          ) : null}
          {reused ? (
            <span className={styles.reuse} data-testid={`card-reuse-${ad.ad_archive_id}`}>
              ใช้ซ้ำ {reused}
            </span>
          ) : null}
        </div>

        <div className={styles.body}>
          <div className={styles.head}>
            <span className={styles.page} title={ad.page_name ?? undefined}>
              {ad.page_name ?? "—"}
            </span>
            <StatusBadge isActive={ad.is_active} />
          </div>

          <p className={styles.copy} data-testid={`card-copy-${ad.ad_archive_id}`}>
            {ad.body_text ?? ad.title ?? "—"}
          </p>

          <div className={styles.meta}>
            {ad.cta_type ? <span className={styles.cta}>{ad.cta_type}</span> : null}
            <span className={styles.platforms}>
              {ad.publisher_platform?.length ? ad.publisher_platform.join(" · ") : "—"}
            </span>
          </div>

          <div className={styles.foot}>
            <span>
              เริ่ม {thaiDate(ad.start_date)} · {ad.ad_age_days} วัน
            </span>
            {reused ? <span className={styles.reuseInline}>ใช้ซ้ำ {reused}</span> : null}
          </div>
        </div>
      </button>
    </article>
  );
}

function VideoGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/**
 * Four distinct media states, four distinct messages.
 *
 * "Nothing was captured" and "captured but not displayable" are different facts
 * about the data, and an expired CDN link with no archive is a third. Collapsing
 * them would have the product assert something its own rows contradict.
 */
function Preview({ ad }: { ad: AdCardData }) {
  const [broken, setBroken] = useState(false);
  const resolved = resolveMedia(ad.display_format, ad.media, {
    archivePath: null,
    archiveStatus: ad.archive_status ?? null,
    presentationUrl: ad.archive_url ?? null,
  });

  if (resolved.state === "none" || resolved.state === "unusable" || broken) {
    const message =
      // Only a source URL can go stale on us; an archived object cannot.
      broken ? "สื่อต้นทางหมดอายุ"
      : resolved.state === "none" ? "ไม่มีสื่อที่บันทึกไว้"
      : "ไม่สามารถแสดงตัวอย่างสื่อ";
    return (
      <div
        className={styles.placeholder}
        data-testid="card-media-placeholder"
        data-media-state={broken ? "expired" : resolved.state}
      >
        <MediaGlyph />
        <span>{message}</span>
      </div>
    );
  }

  // A still even for a video: the poster is the frame the collector captured,
  // and a grid of autoplaying video is not a research tool.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN / signed storage, no loader
    <img
      className={styles.media}
      src={resolved.src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      data-testid="card-media"
      data-media-kind={resolved.kind}
      data-media-source={resolved.state}
    />
  );
}

function MediaGlyph() {
  return (
    <svg
      className={styles.placeholderIcon} width="22" height="22" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden focusable="false"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
