"use client";

import { useEffect, useMemo, useState } from "react";
import { AdCard, type AdCardData } from "@/components/AdCard";
import { AdDrawer } from "@/components/AdDrawer";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingSkeleton } from "@/components/states/LoadingSkeleton";
import { Panel, PanelHead } from "@/components/Surface";
import { PAGE_SIGNALS, SIGNAL_LABEL, type PageSignal } from "@/lib/pages/scope";
import type { Media } from "@/lib/media";
import styles from "./page-detail.module.css";

/**
 * The ads behind every number above.
 *
 * This is the whole point of the surface: a count that cannot be opened is a
 * claim, and this product does not make claims it cannot show the rows for. The
 * card, the drawer and the media states are the frozen ones — there is no second
 * ad renderer here, and no second definition of what a signal means, because the
 * filtering happens in SQL under the same names the summary used.
 */

type Row = AdCardData & { media: Media; archive_url?: string | null; archive_status?: string | null };

const PAGE_SIZE = 24;

export function PageEvidence({ pageId, scope, recentDays, datasetId, counts, canAnalyze=false }: {
  canAnalyze?:boolean;
  pageId: string;
  scope: string;
  recentDays: number;
  /** Set only in dataset scope, so the drawer stays pinned to that snapshot. */
  datasetId: string | null;
  counts: Record<PageSignal, number>;
}) {
  const initial = useMemo(() => {
    const query = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const raw = query.get("signal");
    return {
      signal: (PAGE_SIGNALS as readonly string[]).includes(raw ?? "") ? (raw as PageSignal) : null,
      format: query.get("format") ?? "",
      cta: query.get("cta") ?? "",
      platform: query.get("platform") ?? "",
    };
  }, []);

  const [signal, setSignal] = useState<PageSignal | null>(initial.signal);
  const [dimension, setDimension] = useState(initial);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<{ key: string; rows: Row[]; total: number } | null>(null);

  // The request is the identity of what is on screen. Deriving "loading" from it
  // rather than from a flag means a stale response can never be shown as if it
  // answered the current question.
  const key = useMemo(() => {
    const query = new URLSearchParams({
      scope, recentDays: String(recentDays),
      limit: String(PAGE_SIZE), offset: String(offset),
    });
    if (signal) query.set("signal", signal);
    if (dimension.format) query.set("format", dimension.format);
    if (dimension.cta) query.set("cta", dimension.cta);
    if (dimension.platform) query.set("platform", dimension.platform);
    return query.toString();
  }, [scope, recentDays, offset, signal, dimension]);

  useEffect(() => {
    let live = true;
    fetch(`/api/pages/${encodeURIComponent(pageId)}/ads?${key}`)
      .then(async (response) => (response.ok ? response.json() : { rows: [], total: 0 }))
      .then((payload) => {
        if (!live) return;
        setState({ key, rows: payload.rows ?? [], total: payload.total ?? 0 });
      })
      .catch(() => { if (live) setState({ key, rows: [], total: 0 }); });
    return () => { live = false; };
  }, [pageId, key]);

  const loading = state?.key !== key;

  const pick = (next: PageSignal | null) => {
    setSignal(next);
    // Choosing a signal drops a dimension filter arrived at from the mix bars:
    // showing "VIDEO ads that are also evergreen" under a heading that says
    // only one of the two would misstate what is on screen.
    setDimension({ signal: next, format: "", cta: "", platform: "" });
    setOffset(0);
  };

  const applied = [dimension.format, dimension.cta, dimension.platform].filter(Boolean);
  const heading =
    applied.length > 0 ? `หลักฐาน: ${applied.join(" · ")}`
    : signal ? `หลักฐาน: ${SIGNAL_LABEL[signal]}`
    : "หลักฐาน: โฆษณาทั้งหมดของเพจนี้";

  return (
    <Panel padded className={styles.section}>
      <span id="evidence" className={styles.anchor} />
      <PanelHead
        title={heading}
        meta={state ? `${state.total.toLocaleString("th-TH")} รายการ` : "กำลังโหลด…"}
      />

      <div className={styles.signalTabs} role="group" aria-label="เลือกสัญญาณ" data-testid="signal-tabs">
        <button
          type="button" data-testid="signal-all"
          className={signal === null && applied.length === 0 ? styles.signalOn : undefined}
          aria-pressed={signal === null && applied.length === 0}
          onClick={() => pick(null)}
        >
          ทั้งหมด
        </button>
        {PAGE_SIGNALS.map((key) => (
          <button
            key={key} type="button" data-testid={`signal-${key}`}
            className={signal === key ? styles.signalOn : undefined}
            aria-pressed={signal === key}
            onClick={() => pick(key)}
          >
            {SIGNAL_LABEL[key]} <span data-numeral>{counts[key]}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingSkeleton rows={3} /> : null}

      {!loading && state && state.rows.length === 0 ? (
        <EmptyState
          testId="evidence-empty"
          title="ไม่มีโฆษณาในกลุ่มนี้"
          body="ตัวเลขด้านบนคือศูนย์สำหรับสัญญาณนี้ในขอบเขตที่เลือก"
        />
      ) : null}

      {!loading && state && state.rows.length > 0 ? (
        <>
          <div className={styles.grid} data-testid="evidence-grid">
            {state.rows.map((row) => (
              <AdCard
                key={row.ad_archive_id}
                ad={row}
                onOpen={() => setSelected(row.ad_archive_id)}
              />
            ))}
          </div>

          {state.total > PAGE_SIZE ? (
            <div className={styles.pager}>
              <button
                type="button" data-testid="evidence-prev" disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              >
                ← ก่อนหน้า
              </button>
              <span className={styles.pagerLabel}>
                {offset + 1}–{offset + state.rows.length} จาก {state.total.toLocaleString("th-TH")}
              </span>
              <button
                type="button" data-testid="evidence-next"
                disabled={offset + PAGE_SIZE >= state.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                ถัดไป →
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {selected ? (
        // The frozen drawer. In dataset scope it is pinned to that dataset's
        // snapshot; in a wider scope it opens in master context and says so.
        <AdDrawer adArchiveId={selected} datasetId={datasetId} canAnalyze={canAnalyze} onClose={() => setSelected(null)} />
      ) : null}
    </Panel>
  );
}
