"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CollectionDto } from "@/lib/collect/dto";
import { thaiDateTime } from "@/lib/format/date";
import styles from "./progress.module.css";

/**
 * Progress, read from the product's own endpoint and nothing else.
 *
 * The page polls `GET /api/collections/:id`, which the server also uses to nudge
 * the work along by one bounded step. That is the whole mechanism: no state
 * machine in the browser, no provider, and no way for a refresh to start a
 * second collection — the nudge behind that endpoint cannot claim a request
 * that has never been started.
 *
 * Polling stops when the collection reaches a state that will not change by
 * itself: finished, failed, or waiting for a person.
 */

const POLL_MS = 4_000;
const SETTLED = new Set(["succeeded", "failed", "needs_admin"]);

/** What each state means for what the reader should do next. */
const GUIDANCE: Record<string, string> = {
  queued: "คำขอเข้าคิวแล้ว ระบบจะเริ่มเก็บข้อมูลให้เอง",
  collecting: "กำลังเก็บข้อมูลอยู่ ปิดหน้านี้ได้ งานจะทำต่อจนเสร็จ",
  checking: "กำลังตรวจสอบว่าข้อมูลครบแล้วหรือยัง",
  processing: "กำลังบันทึกข้อมูลเข้าระบบ",
  needs_admin: "รอบนี้ต้องให้ผู้ดูแลระบบตรวจสอบก่อน ระบบแจ้งให้แล้ว",
  succeeded: "เก็บข้อมูลสำเร็จ",
  failed: "ไม่สามารถเก็บข้อมูลรอบนี้ได้ · ลองใหม่อีกครั้ง",
};

export function CollectProgress({ initial }: { initial: CollectionDto }) {
  const [collection, setCollection] = useState(initial);
  const [elapsed, setElapsed] = useState("");
  const settled = SETTLED.has(collection.status);

  useEffect(() => {
    if (settled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/collections/${collection.id}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as CollectionDto;
        if (!cancelled) setCollection(next);
      } catch {
        // A poll that does not answer changes nothing on screen; the next one
        // will. Nothing here retries harder than the timer already does.
      }
    };

    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [collection.id, settled]);

  useEffect(() => {
    if (settled) return;
    // The request's own creation time. An unreadable one means no elapsed
    // figure rather than a made-up one counted from when this page opened.
    const base = new Date(collection.createdAt).getTime();
    if (Number.isNaN(base)) return;
    const format = () => {
      const seconds = Math.max(0, Math.round((Date.now() - base) / 1000));
      const minutes = Math.floor(seconds / 60);
      setElapsed(minutes > 0 ? `${minutes} นาที ${seconds % 60} วินาที` : `${seconds} วินาที`);
    };
    format();
    const timer = setInterval(format, 1_000);
    return () => clearInterval(timer);
  }, [collection.createdAt, settled]);

  const result = collection.result ?? null;
  const ads = result?.ads ?? null;
  const quarantined = result?.quarantined ?? null;
  // The import engine's own word for a run that could not take everything.
  const partial = collection.status === "succeeded"
    && ((quarantined !== null && quarantined > 0) || collection.stopReason === "limit_reached");

  return (
    <div className={styles.page} data-testid="collect-progress" data-status={collection.status}>
      <section className={styles.status}>
        <span className={styles.badge} data-testid="status-label">{collection.statusLabel}</span>
        <p className={styles.guidance} data-testid="status-guidance">
          {GUIDANCE[collection.status] ?? collection.statusLabel}
        </p>
        {!settled && (
          <p className={styles.meta} data-testid="elapsed">ใช้เวลาไปแล้ว {elapsed}</p>
        )}
      </section>

      {collection.status === "collecting" && collection.itemCount !== null && (
        <p className={styles.meta} data-testid="found-so-far">
          พบโฆษณาแล้ว {collection.itemCount.toLocaleString("th-TH")} รายการ (ตัวเลขระหว่างทาง ยังไม่ใช่ผลสรุป)
        </p>
      )}

      {collection.status === "succeeded" && (
        <section className={styles.result} data-testid="collect-result">
          {ads === 0 ? (
            // A real, complete answer: this search found nothing. There is no
            // dataset to open, and inventing an empty one would be a lie.
            <p data-testid="zero-result">ไม่พบโฆษณาตามเงื่อนไขนี้</p>
          ) : (
            <>
              <dl className={styles.counts}>
                <div><dt>โฆษณา</dt><dd data-testid="count-ads">{(ads ?? 0).toLocaleString("th-TH")}</dd></div>
                <div><dt>เพจ</dt><dd data-testid="count-pages">{(result?.pages ?? 0).toLocaleString("th-TH")}</dd></div>
                <div><dt>กักไว้ตรวจสอบ</dt><dd data-testid="count-quarantine">{(quarantined ?? 0).toLocaleString("th-TH")}</dd></div>
              </dl>
              {partial && (
                <p className={styles.partial} data-testid="partial-notice">
                  สำเร็จบางส่วน · {collection.stopReason === "limit_reached"
                    ? "เก็บครบตามจำนวนสูงสุดที่ตั้งไว้"
                    : "บางรายการถูกกักไว้ตรวจสอบ"}
                </p>
              )}
              {collection.datasetId && (
                <Link className={styles.open} href={`/competitors?dataset=${collection.datasetId}`} data-testid="open-dataset">
                  ดูแอดที่เก็บได้ →
                </Link>
              )}
            </>
          )}
        </section>
      )}

      {collection.status === "failed" && (
        <section className={styles.result} data-testid="collect-failed">
          <p>{GUIDANCE.failed}</p>
          <Link className={styles.open} href="/collect" data-testid="retry-collect">ลองใหม่</Link>
        </section>
      )}

      {collection.requiresAdmin && (
        <p className={styles.meta} data-testid="needs-admin-note">
          ผู้ดูแลระบบจะตรวจสอบรอบนี้ให้ ไม่ต้องส่งคำขอใหม่
        </p>
      )}

      <dl className={styles.scope} data-testid="collect-scope">
        <div><dt>คำค้น</dt><dd>{collection.keyword ?? "—"}</dd></div>
        <div><dt>ประเทศ</dt><dd>{collection.country ?? "—"}</dd></div>
        <div><dt>สถานะโฆษณา</dt><dd>{collection.activeStatus === "all" ? "ทั้งหมด" : "กำลังแสดง"}</dd></div>
        <div><dt>จำนวนสูงสุด</dt><dd>{collection.maxRecords?.toLocaleString("th-TH") ?? "—"}</dd></div>
        <div><dt>เริ่มเมื่อ</dt><dd>{thaiDateTime(collection.createdAt)}</dd></div>
        <div><dt>เสร็จเมื่อ</dt><dd>{thaiDateTime(collection.finishedAt)}</dd></div>
      </dl>
    </div>
  );
}
