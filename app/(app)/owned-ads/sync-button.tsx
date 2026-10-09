"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./owned-ads.module.css";

type SyncProgress = {
  status: string;
  started_at: string | null;
  finished_at: string | null;
  completed_accounts: number | null;
  accounts: unknown[] | null;
  ad_count: number | null;
  error: string | null;
};

/**
 * Update our-ads data from the page that shows it.
 *
 * Starts the same sync as "นำเข้าแอดเรา" and follows it here, so nobody leaves
 * the numbers to refresh them. The sync reads the Ads Management project from
 * this server's disk, so only a server configured for it can run one; anywhere
 * else this says so instead of offering a button that fails.
 */
export function OwnedSyncButton({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [watching, setWatching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A finished run older than our own request is the previous one, not ours.
  const requestedAt = useRef(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/owned-ads/library?progress=1", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (controller.signal.aborted || !body?.progress) return;
        setProgress(body.progress);
        // Someone else's run in progress: follow it rather than start another.
        if (body.progress.status === "running") setWatching(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);

  useEffect(() => {
    if (!watching) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/owned-ads/library?progress=1", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("ตรวจสถานะการอัปเดตไม่สำเร็จ");
        const next: SyncProgress | null = (await response.json()).progress;
        setProgress(next);
        if (!next || next.status === "running" || Date.parse(next.started_at ?? "") < requestedAt.current) return;
        setWatching(false);
        if (next.status === "completed") {
          setMessage(`อัปเดตแล้ว ${next.finished_at ? new Date(next.finished_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""} น.`);
          done.current();
        } else setMessage(next.error ?? "อัปเดตไม่สำเร็จ กรุณาลองใหม่");
      } catch (problem) {
        if (!controller.signal.aborted) setMessage((problem as Error).message);
      } finally { pending = false; }
    }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [watching]);

  async function start() {
    setMessage(null);
    requestedAt.current = Date.now() - 1000;
    setWatching(true);
    try {
      const response = await fetch("/api/owned-ads/sync", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "เริ่มอัปเดตไม่สำเร็จ");
      // Joined a run that was already going: its start is before our click.
      if (body.reused) requestedAt.current = 0;
    } catch (problem) {
      setWatching(false);
      setMessage((problem as Error).message);
    }
  }

  if (!enabled) return <span data-testid="owned-sync-unavailable">อัปเดตข้อมูลได้จากเครื่องหลักที่เชื่อม Ads Management</span>;

  const running = watching || progress?.status === "running";
  const accounts = progress?.accounts?.length ?? 0;
  return (
    <span className={styles.sync}>
      {running ? (
        <span role="status" data-testid="owned-sync-progress">
          กำลังอัปเดต{progress?.status === "running" && accounts ? ` ${progress.completed_accounts ?? 0} / ${accounts} บัญชี · ${(progress.ad_count ?? 0).toLocaleString("th-TH")} แอด` : "…"} · ใช้ข้อมูลเดิมได้ระหว่างรอ
        </span>
      ) : message ? <span role="status" data-testid="owned-sync-message">{message}</span> : null}
      <button type="button" data-testid="owned-sync" onClick={() => void start()} disabled={running}>
        {running ? "กำลังอัปเดต…" : "อัปเดตข้อมูล"}
      </button>
    </span>
  );
}
