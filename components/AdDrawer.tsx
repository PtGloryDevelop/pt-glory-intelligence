"use client";

import { useEffect, useRef, useState } from "react";
import { mediaPresentation, type Media } from "@/lib/media";
import { MEDIA_STATE_MESSAGE, resolveMedia } from "@/lib/media/resolve";
import { formatIdentity } from "@/lib/media/format";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingSkeleton } from "@/components/states/LoadingSkeleton";
import styles from "./AdDrawer.module.css";

/**
 * One ad, inspected.
 *
 * Two rules shape everything here. The values shown are the ones belonging to
 * THIS dataset's collection run — a newer observation may exist and appears in
 * the history below, but it never replaces the primary reading. And a field the
 * snapshot does not have is shown as absent rather than back-filled from a later
 * run, because visual completeness is not worth a false claim about a run.
 */

type Detail = {
  context: "dataset" | "master";
  ad_archive_id: string; page_id: string; page_name: string | null;
  page_profile_uri: string | null; page_like_count: number | null;
  page_categories: string[] | null; start_date: string; end_date: string | null;
  first_seen_at: string; last_seen_at: string; ad_age_days: number;
  is_active: boolean | null; display_format: string | null;
  publisher_platform: string[] | null; cta_type: string | null; cta_text: string | null;
  title: string | null; body_text: string | null; caption: string | null;
  link_url: string | null; link_description: string | null; collation_count: number | null;
  media: Media;
  archive_url?: string | null; archive_status?: string | null;
  observed_at: string | null;
};

type History = {
  observed_at: string; collection_run_id: string; collection_method: string;
  is_active: boolean | null; display_format: string | null;
  publisher_platform: string[] | null; cta_type: string | null; collation_count: number | null;
};

export function AdDrawer({ adArchiveId, datasetId, onClose }: {
  adArchiveId: string; datasetId: string | null; onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "missing" } | { status: "ready"; detail: Detail; history: History[] }
  >({ status: "loading" });
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    const query = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : "";
    fetch(`/api/ads/${encodeURIComponent(adArchiveId)}${query}`)
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) { setState({ status: "missing" }); return; }
        const payload = await response.json();
        setState({ status: "ready", detail: payload.detail, history: payload.history ?? [] });
      })
      .catch(() => { if (live) setState({ status: "missing" }); });
    return () => { live = false; };
  }, [adArchiveId, datasetId]);

  /*
   * Dialog behaviour: Escape closes, focus moves in on open and returns to
   * whatever opened it on close, and Tab stays inside while it is open. A panel
   * that traps focus behind an overlay is unusable by keyboard, and one that
   * drops focus to the top of the document loses the reader's place in a grid
   * of thirty cards.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Back to the card or row that opened this, not to the top of the page.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  const detail = state.status === "ready" ? state.detail : null;
  const title = detail?.page_name ?? "รายละเอียดโฆษณา";

  return (
    <>
      <button type="button" className={styles.scrim} aria-label="ปิดรายละเอียดโฆษณา" onClick={onClose} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`รายละเอียดโฆษณา ${title}`}
        data-testid="ad-drawer"
        className={styles.drawer}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.headerTop}>
              {/* The page leads. The 16-digit archive id is metadata and sits
                  with the other facts, not in the title position. */}
              <span className={styles.pageName} data-testid="drawer-page-name" title={detail?.page_name ?? undefined}>
                {detail?.page_name ?? "รายละเอียดโฆษณา"}
              </span>
              {detail ? <StatusBadge isActive={detail.is_active} /> : null}
            </div>
            {detail ? (
              <p className={styles.contextLine} data-testid="drawer-context" data-context={detail.context}>
                {detail.context === "dataset"
                  ? `ข้อมูลใน Dataset นี้ · Snapshot ${thaiDateTime(detail.observed_at)}`
                  : "สถานะล่าสุดจากทุกรอบ (ไม่ใช่ snapshot ของ Dataset ใด)"}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef} type="button" className={styles.close}
            data-testid="drawer-close" aria-label="ปิด" onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {state.status === "loading" ? <LoadingSkeleton rows={5} /> : null}
          {state.status === "missing" ? (
            <ErrorState
              testId="drawer-not-found"
              title="ไม่พบโฆษณานี้ในชุดข้อมูลนี้"
              detail="ระบบไม่แสดงค่าล่าสุดแทน เพราะจะทำให้อ่านผิดว่าเป็นข้อมูลของรอบนั้น"
            />
          ) : null}
          {state.status === "ready" ? <Body detail={state.detail} history={state.history} /> : null}
        </div>
      </div>
    </>
  );
}

function Body({ detail, history }: { detail: Detail; history: History[] }) {
  const platforms = detail.publisher_platform?.length ? detail.publisher_platform.join(" · ") : "—";
  const categories = detail.page_categories?.length ? detail.page_categories.join(" · ") : "—";

  return (
    <>
      <section className={styles.section}>
        <Creative detail={detail} />
      </section>

      {/* Copy first after the creative: it is what an ad actually says. */}
      {detail.body_text || detail.title || detail.caption ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>ข้อความโฆษณา</h3>
          {detail.title ? <p className={styles.copyTitle}>{detail.title}</p> : null}
          {detail.body_text ? (
            <p className={styles.copy} data-testid="drawer-copy">{detail.body_text}</p>
          ) : (
            <p className={styles.copy}>—</p>
          )}
          {detail.caption ? <p className={styles.copyCaption}>{detail.caption}</p> : null}
        </section>
      ) : null}

      {detail.cta_type || detail.cta_text || detail.link_url || detail.link_description ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>ปุ่มและปลายทาง</h3>
          <dl className={styles.facts}>
            <Fact label="CTA" value={detail.cta_type} />
            <Fact label="ข้อความปุ่ม" value={detail.cta_text} />
            {detail.link_description ? <Fact label="คำอธิบายลิงก์" value={detail.link_description} /> : null}
          </dl>
          {/* Rendered as text, never as a link the reader might follow by
              accident, and never fetched by the server. */}
          {detail.link_url ? (
            <p className={styles.mediaNote}>
              <span className={styles.factLabel}>ปลายทาง</span>
              <span className={styles.destination} data-testid="drawer-destination">
                {destinationLabel(detail.link_url)}
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>ข้อมูลโฆษณา</h3>
        <dl className={styles.facts}>
          <Fact label="รูปแบบ" value={detail.display_format} testId="drawer-format" />
          <Fact label="แพลตฟอร์ม" value={platforms} testId="drawer-platform" />
          <Fact
            label="สถานะ"
            value={detail.is_active === null ? null : detail.is_active ? "Active" : "Inactive"}
            testId="drawer-active"
          />
          <Fact label="เริ่มแสดง" value={thaiDate(detail.start_date)} />
          <Fact label="อายุโฆษณา" value={`${detail.ad_age_days} วัน`} />
          {detail.end_date ? <Fact label="สิ้นสุด" value={thaiDate(detail.end_date)} /> : null}
          {/* First and Last Seen are OUR observations, not Meta's dates. */}
          <Fact label="พบครั้งแรก" value={thaiDate(detail.first_seen_at)} />
          <Fact label="พบครั้งล่าสุด" value={thaiDate(detail.last_seen_at)} />
          {detail.collation_count ? <Fact label="ชุดครีเอทีฟ" value={detail.collation_count} /> : null}
          <Fact label="Ad archive ID" value={detail.ad_archive_id} />
        </dl>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>เพจ</h3>
        <dl className={styles.facts}>
          {/* A Page is not a Brand, and nothing here maps one to the other. */}
          <Fact label="ชื่อเพจ" value={detail.page_name} />
          <Fact label="Page ID" value={detail.page_id} />
          {detail.page_like_count !== null ? (
            <Fact label="ผู้ติดตามเพจ" value={detail.page_like_count.toLocaleString("th-TH")} />
          ) : null}
          <Fact label="หมวดเพจ" value={categories} />
        </dl>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>ประวัติการสังเกต</h3>
        <ObservationHistory history={history} currentObservedAt={detail.observed_at} />
      </section>
    </>
  );
}

/** A fact with its label. `—` when absent; never hidden silently. */
function Fact({ label, value, testId }: { label: string; value: unknown; testId?: string }) {
  const text =
    value === null || value === undefined || value === "" ? "—"
    : Array.isArray(value) ? (value.length ? value.join(" · ") : "—")
    : String(value);
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue} data-testid={testId}>{text}</dd>
    </div>
  );
}

/**
 * The destination as its host, shown as text.
 *
 * The full URL is advertiser-controlled and can be enormous; the host is what a
 * researcher actually reads. It is never turned into a followable link here and
 * never enters the media fetch path.
 */
function destinationLabel(url: string): string {
  try {
    const parsed = new URL(url);
    // Shorten only real web destinations. A javascript:/data:/anything-else URL
    // keeps its scheme on screen: stripping it would make a hostile value read
    // like a normal path.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    return parsed.host + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    return url;
  }
}

/**
 * The creative, as large as the panel allows.
 *
 * Resolution order matches the rest of the product: our archived object first,
 * then a still-live source, then the truthful absence. The four states stay
 * distinct — an archived poster is never reported as "no media" merely because
 * the original CDN link has expired.
 */
function Creative({ detail }: { detail: Detail }) {
  const [sourceBroken, setSourceBroken] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const identity = formatIdentity(detail.display_format);
  const isVideo = identity?.isVideo ?? false;
  const formatLabel = identity?.label ?? null;

  const resolved = resolveMedia(detail.display_format, detail.media, {
    archivePath: null,
    archiveStatus: detail.archive_status ?? null,
    presentationUrl: detail.archive_url ?? null,
  });

  // A live source video is worth playing; a poster is not a video.
  const presentation = mediaPresentation(detail.media);
  const playable = presentation.state === "ready" && presentation.all.find((item) => item.kind === "video");

  /*
   * A source image that will not load is its own state: the entry existed and
   * we chose it, but the CDN link has since expired. That is different from
   * "nothing was captured", and different again from an archived object, which
   * cannot expire on us.
   */
  if (imageBroken && resolved.state === "source") {
    return (
      <>
        <div className={styles.stage}>
          <p className={styles.placeholder} data-testid="media-unavailable" data-media-state="expired">
            <MediaGlyph />
            สื่อต้นทางหมดอายุ · ไม่มีสำเนาที่เก็บไว้สำหรับโฆษณานี้
          </p>
        </div>
        {formatLabel ? <p className={styles.mediaNote}>รูปแบบ: {formatLabel}</p> : null}
      </>
    );
  }

  if (resolved.state === "none" || resolved.state === "unusable") {
    return (
      <>
        <div className={styles.stage}>
          <p className={styles.placeholder} data-testid="media-placeholder" data-media-state={resolved.state}>
            <MediaGlyph />
            {resolved.state === "none"
              ? MEDIA_STATE_MESSAGE.none
              : MEDIA_STATE_MESSAGE.unusable}
          </p>
        </div>
        {formatLabel ? <p className={styles.mediaNote}>รูปแบบ: {formatLabel}</p> : null}
      </>
    );
  }

  // Video with a source that still plays: poster plus controls, no autoplay.
  if (isVideo && playable && !sourceBroken) {
    return (
      <>
        <div className={styles.stage}>
          <video
            className={styles.stageVideo}
            src={playable.src}
            poster={resolved.src}
            controls
            preload="none"
            data-testid="media-video"
            data-media-kind="video"
            // The frame on screen before play is pressed is our archived poster,
            // not the CDN's — worth stating, because it is what remains visible
            // once the source expires.
            data-poster-source={resolved.state}
            onError={() => setSourceBroken(true)}
          />
          <span className={styles.formatTag}><VideoGlyph /> Video</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.stage}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage or CDN URL, no loader */}
        <img
          className={styles.stageMedia}
          src={resolved.src}
          alt=""
          data-testid={resolved.state === "archived" ? "media-archived" : "media-image"}
          data-media-kind={resolved.kind}
          data-media-source={resolved.state}
          onError={() => setImageBroken(true)}
        />
        {formatLabel ? (
          <span className={styles.formatTag}>
            {isVideo ? <VideoGlyph /> : null}{formatLabel}
          </span>
        ) : null}
      </div>
      {isVideo ? (
        // Stated plainly, not as an error. The frozen media policy archives a
        // poster, not the video, so historical playback was never promised.
        <p className={styles.mediaNote} data-testid="media-unavailable">
          วิดีโอต้นทางไม่พร้อมใช้งาน · แสดงภาพตัวอย่างที่เก็บไว้แทน
        </p>
      ) : null}
    </>
  );
}


/**
 * Observations, newest first.
 *
 * These are recorded observations, not a computed diff — the read layer returns
 * what was seen and when, so this says exactly that rather than claiming to know
 * what "changed". The observation this dataset is pinned to is marked, because
 * a newer one may sit above it and must not read as the panel's primary truth.
 */
function ObservationHistory({ history, currentObservedAt }: {
  history: History[]; currentObservedAt: string | null;
}) {
  if (history.length === 0) return <p className={styles.copy}>—</p>;

  return (
    <ul className={styles.history} data-testid="observation-history">
      {history.map((row) => {
        const isCurrent = currentObservedAt !== null && row.observed_at === currentObservedAt;
        return (
          <li
            key={`${row.collection_run_id}-${row.observed_at}`}
            className={`${styles.observation} ${isCurrent ? styles.observationCurrent : ""}`}
            data-testid="observation-row"
            data-current={isCurrent ? "true" : undefined}
          >
            <div className={styles.observationHead}>
              <span className={styles.observationDate}>{thaiDateTime(row.observed_at)}</span>
              {isCurrent ? (
                <span className={styles.currentTag}>Snapshot ปัจจุบันใน Dataset นี้</span>
              ) : null}
              <StatusBadge isActive={row.is_active} />
            </div>
            <p className={styles.observationMeta}>
              <span>{row.display_format ?? "—"}</span>
              <span>{row.cta_type ?? "—"}</span>
              {row.collation_count ? <span>ใช้ซ้ำ {row.collation_count}</span> : null}
              <span title={row.collection_run_id}>{row.collection_method}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function VideoGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function MediaGlyph() {
  return (
    <svg
      width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
