"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  SIGNAL_META, signalsFor, type WatchSignal, type WatchTargetType,
} from "@/lib/watchlist/contract";
import { Panel, PanelHead } from "@/components/Surface";
import styles from "../watchlist.module.css";

/**
 * The three things a person can do to a watch.
 *
 * Resetting the baseline is the only one that changes what any number means, so
 * it asks first and says what will happen — there is no event history to fall
 * back on, and what stops being counted does not come back.
 */
export function WatchControls({ id, targetType, signals, baselineAt, resetExplanation }: {
  id: string;
  targetType: WatchTargetType;
  signals: WatchSignal[];
  baselineAt: string;
  resetExplanation: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<WatchSignal[]>(signals);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<null | "signals" | "baseline" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const available = signalsFor(targetType);
  const dirty =
    chosen.length !== signals.length || chosen.some((signal) => !signals.includes(signal));

  const call = async (kind: "signals" | "baseline" | "delete", run: () => Promise<Response>) => {
    setBusy(kind);
    setError(null);
    const response = await run();
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "ทำรายการไม่สำเร็จ");
      return false;
    }
    return true;
  };

  return (
    <Panel padded className={styles.section}>
      <PanelHead title="จัดการรายการติดตาม" meta={`จุดอ้างอิงปัจจุบัน · ${new Date(baselineAt).toLocaleString("th-TH")}`} />

      <fieldset className={styles.signalPicker}>
        <legend className={styles.legend}>สัญญาณที่ติดตาม</legend>
        {available.map((signal) => (
          <label key={signal} className={styles.checkbox} htmlFor={`signal-${signal}`}>
            <input
              id={`signal-${signal}`}
              type="checkbox"
              data-testid={`toggle-${signal}`}
              checked={chosen.includes(signal)}
              onChange={(event) => {
                setChosen((current) =>
                  event.target.checked
                    ? [...current, signal]
                    : current.filter((entry) => entry !== signal));
              }}
            />
            <span>
              {SIGNAL_META[signal].label}
              <span className={styles.signalHelper}>{SIGNAL_META[signal].helper}</span>
            </span>
          </label>
        ))}
        <p className={styles.stateNote}>
          การเปลี่ยนสัญญาณไม่ย้ายจุดอ้างอิง — สองอย่างนี้แยกจากกัน
        </p>
        <button
          type="button"
          data-variant="primary"
          data-testid="save-signals"
          disabled={!dirty || chosen.length === 0 || busy !== null}
          onClick={async () => {
            const ok = await call("signals", () =>
              fetch(`/api/watchlist/${id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ signals: chosen }),
              }));
            if (ok) router.refresh();
          }}
        >
          {busy === "signals" ? "กำลังบันทึก…" : "บันทึกสัญญาณ"}
        </button>
      </fieldset>

      <div className={styles.actions}>
        <div className={styles.action}>
          <h3 className={styles.actionTitle}>ตั้งจุดอ้างอิงใหม่</h3>
          {confirmingReset ? (
            <>
              <p className={styles.caveat} data-testid="reset-explanation">{resetExplanation}</p>
              <div className={styles.actionRow}>
                <button
                  type="button" data-variant="primary" data-testid="confirm-reset"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await call("baseline", () =>
                      fetch(`/api/watchlist/${id}/baseline`, { method: "POST" }));
                    if (ok) { setConfirmingReset(false); router.refresh(); }
                  }}
                >
                  {busy === "baseline" ? "กำลังตั้ง…" : "ยืนยันตั้งจุดอ้างอิงใหม่"}
                </button>
                <button type="button" onClick={() => setConfirmingReset(false)}>ยกเลิก</button>
              </div>
            </>
          ) : (
            <button type="button" data-testid="reset-baseline" onClick={() => setConfirmingReset(true)}>
              ตั้งจุดอ้างอิงใหม่
            </button>
          )}
        </div>

        <div className={styles.action}>
          <h3 className={styles.actionTitle}>เลิกติดตาม</h3>
          {confirmingDelete ? (
            <>
              <p className={styles.caveat} data-testid="delete-explanation">
                ลบเฉพาะรายการติดตามนี้ · ข้อมูลโฆษณา Dataset เพจ และหมวดหมู่ ไม่ถูกลบ
              </p>
              <div className={styles.actionRow}>
                <button
                  type="button" data-variant="danger" data-testid="confirm-delete"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await call("delete", () =>
                      fetch(`/api/watchlist/${id}`, { method: "DELETE" }));
                    if (ok) router.push("/watchlist");
                  }}
                >
                  {busy === "delete" ? "กำลังลบ…" : "ยืนยันเลิกติดตาม"}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}>ยกเลิก</button>
              </div>
            </>
          ) : (
            <button type="button" data-testid="delete-watch" onClick={() => setConfirmingDelete(true)}>
              เลิกติดตาม
            </button>
          )}
        </div>
      </div>

      {error ? <p className={styles.caveat} data-testid="watch-error">{error}</p> : null}
    </Panel>
  );
}
