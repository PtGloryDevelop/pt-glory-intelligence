"use client";

import { useEffect, useState } from "react";
import { AdCard, type AdCardData } from "@/components/AdCard";
import { AdDrawer } from "@/components/AdDrawer";
import styles from "./progress.module.css";

const PREVIEW = 8;

/**
 * The first ads a finished collection brought in, shown where it finished.
 *
 * Reads the dataset through the same endpoint as the library, so what appears
 * here is exactly what the library will show. An ad opens in the drawer, not on
 * another page.
 */
export function CollectedPreview({ datasetId }: { datasetId: string }) {
  const [rows, setRows] = useState<(AdCardData & { ad_archive_id: string })[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/datasets/${datasetId}/ads?limit=${PREVIEW}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) setRows(body.rows);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [datasetId]);

  if (failed) return null;
  if (!rows) return <p className={styles.meta} role="status">กำลังเปิดตัวอย่างแอดที่เก็บได้…</p>;
  if (!rows.length) return null;

  return (
    <section className={styles.preview} data-testid="collected-preview" aria-label="ตัวอย่างแอดที่เก็บได้">
      <div className={styles.previewGrid}>
        {rows.map((ad) => <AdCard key={ad.ad_archive_id} ad={ad} compact onOpen={() => setOpen(ad.ad_archive_id)} />)}
      </div>
      {open && (
        <AdDrawer
          adArchiveId={open} datasetId={datasetId} canAnalyze onClose={() => setOpen(null)}
          compareHref={`/compare/ads?${new URLSearchParams({ dataset: datasetId, rival: open, returnTo: "/competitors" })}`}
        />
      )}
    </section>
  );
}
