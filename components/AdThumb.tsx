"use client";

import { useState } from "react";
import { type Media } from "@/lib/media";
import { resolveMedia } from "@/lib/media/resolve";
import { formatIdentity } from "@/lib/media/format";
import styles from "./AdThumb.module.css";

/**
 * The creative in a table row: small, fixed, and scannable down a column.
 *
 * Same resolver and same format-identity rule as the card — a VIDEO row still
 * reads as video even though the archived preview is a JPEG poster. No playback
 * controls: a table of thirty players is not an analyst tool.
 */
export function AdThumb({ ad }: {
  ad: {
    display_format: string | null;
    media: Media;
    archive_url?: string | null;
    archive_status?: string | null;
  };
}) {
  const [broken, setBroken] = useState(false);
  const resolved = resolveMedia(ad.display_format, ad.media, {
    archivePath: null,
    archiveStatus: ad.archive_status ?? null,
    presentationUrl: ad.archive_url ?? null,
  });
  const isVideo = formatIdentity(ad.display_format)?.isVideo ?? false;

  if (resolved.state === "none" || resolved.state === "unusable" || broken) {
    return (
      <span
        className={styles.placeholder}
        data-testid="row-media-placeholder"
        data-media-state={broken ? "expired" : resolved.state}
        // The distinction still matters here, it just cannot fit in 48px.
        title={
          broken ? "สื่อต้นทางหมดอายุ"
          : resolved.state === "none" ? "ไม่มีสื่อที่บันทึกไว้"
          : "ไม่สามารถแสดงตัวอย่างสื่อ"
        }
      >
        —
      </span>
    );
  }

  return (
    <span className={styles.wrap}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN / signed storage */}
      <img
        className={styles.thumb} src={resolved.src} alt="" loading="lazy"
        onError={() => setBroken(true)}
        data-testid="row-media" data-media-kind={resolved.kind}
        data-media-source={resolved.state}
      />
      {isVideo ? (
        <span className={styles.videoBadge} aria-label="วิดีโอ" title="วิดีโอ">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
