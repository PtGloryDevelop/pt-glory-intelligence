"use client";

import { useState } from "react";
import { AdCard, type AdCardData } from "@/components/AdCard";
import { AdDrawer } from "@/components/AdDrawer";
import type { Media } from "@/lib/media";
import styles from "./page-detail.module.css";

/**
 * The ads behind one timeline bucket.
 *
 * The rows arrive already read by the server, from the same query that produced
 * the count on the chart — so the two cannot disagree, and nothing is
 * re-aggregated in the browser. All this component owns is which ad the drawer
 * is showing.
 */

type Row = AdCardData & { media: Media; archive_url?: string | null; archive_status?: string | null };

export function BucketEvidence({ rows, datasetId, testId = "bucket-evidence" }: {
  rows: Row[];
  /** Set only in dataset scope, so the drawer stays pinned to that snapshot. */
  datasetId: string | null;
  testId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className={styles.grid} data-testid={testId}>
        {rows.map((row) => (
          <AdCard key={row.ad_archive_id} ad={row} onOpen={() => setSelected(row.ad_archive_id)} />
        ))}
      </div>
      {selected ? (
        <AdDrawer adArchiveId={selected} datasetId={datasetId} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
