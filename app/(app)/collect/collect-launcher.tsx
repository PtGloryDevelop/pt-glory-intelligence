"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CollectorFormSettings } from "@/lib/collect/form";
import type { CollectionDto } from "@/lib/collect/dto";
import { CollectClient } from "./collect-client";
import styles from "./collect-launcher.module.css";

type Category = { id: string; name: string };
export type CollectPrefill = { keywords?: string[]; category?: string; title?: string };
type Launcher = { open: (prefill?: CollectPrefill) => void; version: number };

const LauncherContext = createContext<Launcher | null>(null);

/** Null where nobody may collect (viewers): callers hide their buttons. */
export const useCollectLauncher = () => useContext(LauncherContext);

/**
 * The collect form, opened beside the page that needs new ads.
 *
 * The competitor board used to send people to "เก็บข้อมูลใหม่" and back. Now
 * the same form slides in over the board, prefilled from where it was opened
 * (a unit's keywords and name), shows its progress in place, and bumps
 * `version` when ads arrive so the board reloads them. Closing the panel does
 * not stop anything: the form stays mounted and keeps following the run.
 */
export function CollectLauncherProvider(
  { requestKey, categories, settings, recent, children }:
  { requestKey: string; categories: Category[]; settings: CollectorFormSettings; recent: CollectionDto[]; children: ReactNode },
) {
  const [prefill, setPrefill] = useState<CollectPrefill | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const open = useCallback((next: CollectPrefill = {}) => {
    // The same prefill keeps a run that is still on screen; a different one starts fresh.
    setPrefill((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  }, [isOpen]);

  const value = useMemo(() => ({ open, version }), [open, version]);
  const finished = useCallback((collection: CollectionDto) => {
    if (collection.status === "succeeded") setVersion((current) => current + 1);
  }, []);

  return (
    <LauncherContext.Provider value={value}>
      {children}
      <dialog ref={dialog} className={styles.panel} aria-labelledby="collect-panel-title" onClose={() => setIsOpen(false)} data-testid="collect-panel">
        <header className={styles.head}>
          <div>
            <h2 id="collect-panel-title">{prefill?.title ?? "เก็บแอดคู่แข่งใหม่"}</h2>
            <p>แอดที่ได้จะขึ้นในหน้านี้เมื่อเก็บเสร็จ · ปิดแผงได้ งานจะทำต่อเอง</p>
          </div>
          <button type="button" onClick={() => setIsOpen(false)}>ปิด</button>
        </header>
        {prefill && (
          <CollectClient
            key={JSON.stringify(prefill)} mode="panel"
            requestKey={requestKey} categories={categories} settings={settings} recent={recent}
            initialKeyword={prefill.keywords?.[0] ?? ""} keywordChoices={prefill.keywords ?? []}
            initialCategory={prefill.category} onFinished={finished}
          />
        )}
      </dialog>
    </LauncherContext.Provider>
  );
}

/** The header's way in: an empty form, or nothing for a viewer. */
export function CollectLaunchButton({ className, label = "+ เก็บแอดใหม่" }: { className?: string; label?: string }) {
  const launcher = useCollectLauncher();
  if (!launcher) return null;
  return <button type="button" className={className} onClick={() => launcher.open()} data-testid="collect-launch">{label}</button>;
}
