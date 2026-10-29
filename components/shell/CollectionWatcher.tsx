"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { CollectionDto } from "../../lib/collect/dto.ts";
import styles from "./CollectionWatcher.module.css";

/** The page a running collection is advanced from fires this right after it starts one. */
export const COLLECTION_STARTED = "pt:collection-started";
const SETTLED = new Set(["succeeded", "failed", "needs_admin"]);
const ACTIVE_MS = 5_000;
const IDLE_MS = 60_000;
// A collection older than this is not chased here: its provider data has expired, so it needs an admin, not a nudge.
const MAX_AGE_MS = 3 * 86_400_000;

/**
 * Keeps an analyst's running collections moving from any page of the app.
 *
 * A collection only advances when someone asks for its state (GET /api/collections/<id> nudges it one step,
 * never a paid start; the scheduler is off on purpose). That used to mean keeping its progress page open.
 * Here every open page of the app asks instead, so a person can start a collection and go on working.
 * Its own progress page already asks, so this skips that one.
 */
export function useCollectionWatcher(enabled: boolean) {
  const pathname = usePathname();
  const [active, setActive] = useState<CollectionDto[]>([]);
  const [done, setDone] = useState<CollectionDto | null>(null);
  const [wake, setWake] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const started = () => setWake(value => value + 1);
    window.addEventListener(COLLECTION_STARTED, started);
    return () => window.removeEventListener(COLLECTION_STARTED, started);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: CollectionDto[] = [];
    let listedAt = 0;
    async function tick() {
      try {
        // The list is re-read on every idle tick, and every 30 s while something runs (a run started in another tab shows up).
        if (!running.length || Date.now() - listedAt > 30_000) {
          const response = await fetch("/api/collections", { cache: "no-store" });
          if (response.ok) {
            const body = await response.json() as { collections: CollectionDto[] };
            running = body.collections.filter(item => !SETTLED.has(item.status) && Date.now() - Date.parse(item.createdAt) < MAX_AGE_MS);
            listedAt = Date.now();
          }
        }
        const next: CollectionDto[] = [];
        for (const item of running) {
          if (pathname === `/collect/${item.id}`) { next.push(item); continue; }
          const response = await fetch(`/api/collections/${item.id}`, { cache: "no-store" });
          if (!response.ok) continue;
          const fresh = await response.json() as CollectionDto;
          if (SETTLED.has(fresh.status)) { if (live) setDone(fresh); } else next.push(fresh);
        }
        running = next;
        // Its own progress page already shows it, so the note there would only repeat it.
        if (live) setActive(next.filter(item => pathname !== `/collect/${item.id}`));
      } catch { /* a missed tick is harmless: the next one asks again */ }
      if (live) timer = setTimeout(tick, running.length ? ACTIVE_MS : IDLE_MS);
    }
    void tick();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [enabled, pathname, wake]);

  return { active, done, dismiss: () => setDone(null) };
}

const name = (item: CollectionDto) => item.keyword ?? item.datasetName ?? "รอบเก็บแอด";

/** The sidebar's note: what is being collected, and how the last one ended. */
export function CollectionNote(props: ReturnType<typeof useCollectionWatcher> & { compact?: boolean }) {
  const note = noteFor(props);
  return note && !props.compact ? <div className={styles.slot}>{note}</div> : note;
}

function noteFor({ active, done, dismiss, compact = false }: ReturnType<typeof useCollectionWatcher> & { compact?: boolean }) {
  if (active.length) {
    const item = active[0];
    return <Link href={`/collect/${item.id}`} className={styles.note} data-compact={compact || undefined} data-testid="shell-collecting">
      <span className={styles.spinner} aria-hidden />
      <span className={styles.text}><b>กำลังเก็บแอด{active.length > 1 ? ` ${active.length} รอบ` : ""}</b>{compact ? null : <span>{name(item)} · {item.statusLabel}</span>}</span>
    </Link>;
  }
  if (!done) return null;
  const ok = done.status === "succeeded";
  return <span className={styles.note} data-compact={compact || undefined} data-state={ok ? "ok" : "warn"} data-testid="shell-collected">
    <Link href={`/collect/${done.id}`} className={styles.text} onClick={dismiss}>
      <b>{ok ? "เก็บแอดเสร็จแล้ว" : done.status === "needs_admin" ? "รอบเก็บแอดรอผู้ดูแลตรวจ" : "เก็บแอดไม่สำเร็จ"}</b>
      {compact ? null : <span>{name(done)}{ok && done.itemCount != null ? ` · ${done.itemCount.toLocaleString("th-TH")} แอด` : ""}</span>}
    </Link>
    <button type="button" className={styles.close} onClick={dismiss} aria-label="ปิดข้อความ">×</button>
  </span>;
}
