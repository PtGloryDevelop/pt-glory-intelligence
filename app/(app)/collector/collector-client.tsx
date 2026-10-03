"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CollectorUsage, RecoveryQueueItem } from "@/lib/collect/admin";
import styles from "./collector.module.css";

/**
 * The admin's view of what collecting costs and what it is waiting for.
 *
 * Three things are kept apart on purpose, because conflating them is how a
 * budget conversation goes wrong: what PT Glory is holding aside, what the
 * provider has reported but not settled, and what is actually settled. The
 * page says which is which in words, not only in column headings.
 */

const ACTION_LABELS: Record<string, string> = {
  retry_settlement: "ตรวจผลใหม่",
  reconcile_original_start: "ตามหารอบเดิม",
  retry_cost_reconciliation: "เช็กยอดใหม่",
  fail_collection: "ปิดงานรอบนี้",
  release_unresolved_reservation: "ปล่อยยอดที่กันไว้",
};

/** The two actions that change something a person has to answer for. */
const NEEDS_REASON = new Set(["fail_collection", "release_unresolved_reservation"]);

const bangkok = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  }).format(date);
};

export function CollectorClient(
  { usage, queue, settings, tokenConfigured = false }:
  { usage: CollectorUsage; queue: RecoveryQueueItem[]; settings: Record<string, unknown>; tokenConfigured?: boolean },
) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: string } | null>(null);
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState(() => JSON.stringify(settings, null, 2));
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftValues = useMemo<Record<string, unknown>>(() => {
    try { const value = JSON.parse(draft); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }, [draft]);
  const changeSetting = (key: string, value: unknown) => setDraft(JSON.stringify({ ...draftValues, [key]: value }, null, 2));

  async function run(id: string, action: string, why: string) {
    setBusy(`${id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/collections/${id}/recovery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: why }),
      });
      const payload = await response.json().catch(() => null);
      setMessage(response.ok
        ? `ดำเนินการแล้ว: ${ACTION_LABELS[action] ?? action}`
        : `ไม่สำเร็จ: ${payload?.message ?? payload?.error ?? "ลองใหม่อีกครั้ง"}`);
      if (response.ok) window.location.reload();
    } finally {
      setBusy(null);
      setConfirming(null);
      setReason("");
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSettingsMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setSettingsMessage("รูปแบบ JSON ไม่ถูกต้อง");
      return;
    }
    setSaving(true);
    try {
    const response = await fetch("/api/collector/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const payload = await response.json().catch(() => null);
    // The server owns every rule about these values; this only shows what it said.
    setSettingsMessage(response.ok
      ? `บันทึกแล้ว ${(payload?.changed ?? []).length} รายการ`
      : payload?.message ?? "บันทึกไม่สำเร็จ");
    } catch {
      setSettingsMessage("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally { setSaving(false); }
  }

  return (
    <div className={styles.page}>
      <section className={styles.card} data-testid="collector-usage">
        <h2 className={styles.title}>งบรอบบิลปัจจุบัน</h2>
        {usage.window ? (
          <p className={styles.meta} data-testid="usage-window">
            {bangkok(usage.window.start)} — {bangkok(usage.window.end)} (เวลากรุงเทพฯ)
          </p>
        ) : (
          <p className={styles.meta} data-testid="usage-window">ยังไม่ได้ตั้งรอบบิล</p>
        )}

        <dl className={styles.figures}>
          <div>
            <dt>ยอดที่กันไว้</dt>
            <dd data-testid="usage-held">{usage.heldReservationUsd} USD</dd>
            <span className={styles.note}>เงินที่ PT Glory กันไว้ล่วงหน้า ยังไม่ใช่ค่าใช้จ่ายจริง</span>
          </div>
          <div>
            <dt>ค่าใช้จ่ายจริงที่สรุปแล้ว</dt>
            <dd data-testid="usage-final">{usage.finalizedActualCostUsd} USD</dd>
            <span className={styles.note}>ยอดที่ผู้ให้บริการรายงานและนิ่งแล้ว</span>
          </div>
          <div>
            <dt>งบคงเหลือ</dt>
            <dd data-testid="usage-available">{usage.availableUsd ?? "—"} USD</dd>
            <span className={styles.note}>จากงบ {usage.monthlyBudgetUsd ?? "—"} USD</span>
          </div>
        </dl>

        {usage.containsProvisional && (
          <p className={styles.provisional} data-testid="usage-provisional">
            มียอดที่ยังไม่นิ่ง (provisional) รวมอยู่ในยอดที่กันไว้ · ยังไม่ใช่ค่าใช้จ่ายจริง
          </p>
        )}
        <p className={styles.note}>
          ตัวเลขทั้งหมดนี้คือค่าเก็บข้อมูลของระบบ ไม่ใช่ค่าโฆษณาของเพจใด
        </p>
      </section>

      <section className={styles.card} data-testid="recovery-queue">
        <h2 className={styles.title}>รอบที่ต้องตรวจสอบ</h2>
        {queue.length === 0 ? (
          <p className={styles.meta} data-testid="recovery-empty">ไม่มีรอบที่รอดำเนินการ</p>
        ) : (
          <ul className={styles.queue}>
            {queue.map((item) => (
              <li key={item.id} className={styles.queueItem} data-testid={`recovery-${item.id}`}>
                <div>
                  <span className={styles.queueName}>{item.datasetName ?? item.keyword ?? item.id}</span>
                  <span className={styles.meta}>
                    {item.status}
                    {item.errorClass ? ` · ${item.errorClass}` : ""}
                    {" · "}{bangkok(item.createdAt)}
                  </span>
                  {item.errorDetail && <p className={styles.detail}>{item.errorDetail}</p>}
                </div>
                <div className={styles.actions}>
                  <Link href={`/collect/${item.id}`} className={styles.secondary}>ดูรอบนี้</Link>
                  {item.actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={styles.action}
                      data-testid={`action-${action}-${item.id}`}
                      disabled={busy !== null}
                      onClick={() => (NEEDS_REASON.has(action)
                        ? setConfirming({ id: item.id, action })
                        : run(item.id, action, ""))}
                    >
                      {ACTION_LABELS[action] ?? action}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {message && <p className={styles.meta} role="status" data-testid="recovery-message">{message}</p>}
      </section>

      {confirming && (
        <section className={styles.card} data-testid="recovery-confirm">
          <h2 className={styles.title}>{ACTION_LABELS[confirming.action]}</h2>
          {confirming.action === "release_unresolved_reservation" && (
            <p className={styles.warning} data-testid="release-warning">
              การปล่อยยอดนี้เปลี่ยนเฉพาะยอดที่ PT Glory กันไว้เท่านั้น
              ไม่ได้แปลว่าผู้ให้บริการไม่คิดเงิน และไม่เปลี่ยนค่าใช้จ่ายจริงที่บันทึกไว้
            </p>
          )}
          <label htmlFor="recovery-reason">เหตุผล (บังคับ)</label>
          <textarea
            id="recovery-reason" data-testid="recovery-reason" rows={3}
            value={reason} onChange={(event) => setReason(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button" className={styles.action} data-testid="recovery-confirm-submit"
              disabled={reason.trim() === "" || busy !== null}
              onClick={() => run(confirming.id, confirming.action, reason)}
            >
              ยืนยัน
            </button>
            <button
              type="button" className={styles.secondary} data-testid="recovery-cancel"
              onClick={() => { setConfirming(null); setReason(""); }}
            >
              ยกเลิก
            </button>
          </div>
        </section>
      )}

      <section className={styles.card} data-testid="collector-settings">
        <h2 className={styles.title}>Apify · แหล่งข้อมูลโฆษณา</h2>
        <p className={styles.note}>
          {tokenConfigured ? "มีโทเคนบนเซิร์ฟเวอร์แล้ว · ยังไม่ใช่การยืนยันว่าแหล่งเก็บพร้อมใช้งาน" : "ยังไม่มีโทเคน · ให้ผู้ดูแลตั้งการเชื่อมต่อ Apify บนเซิร์ฟเวอร์"}
        </p>
        <form onSubmit={saveSettings} className={styles.settingsForm}>
          <div className={styles.connectionFields}>
            <label>ชื่อ Actor
              <input aria-label="ชื่อ Apify Actor" value={typeof draftValues.actor === "string" ? draftValues.actor : ""}
                placeholder="เจ้าของ~ชื่อ-actor" onChange={(event) => changeSetting("actor", event.target.value)} />
              <small>ใช้รูปแบบเจ้าของ~ชื่อ เช่น curious_coder~facebook-ads-library-scraper</small>
            </label>
            <label>เวอร์ชัน Build ที่ตรวจสอบแล้ว
              <input aria-label="Actor Build" value={typeof draftValues.actor_build === "string" ? draftValues.actor_build : ""}
                placeholder="เช่น 0.0.1" onChange={(event) => changeSetting("actor_build", event.target.value)} />
              <small>ตรึงเวอร์ชันเพื่อให้รูปแบบข้อมูลคงที่</small>
            </label>
            {([
              ["monthly_budget_usd", "วงเงินต่อเดือน (USD)"],
              ["max_charge_per_run_usd", "วงเงินสูงสุดต่อรอบ (USD)"],
              ["max_records_per_run", "จำนวนแอดสูงสุดต่อรอบ"],
            ] as const).map(([key, label]) => <label key={key}>{label}
              <input type="number" min="0" step={key === "max_records_per_run" ? "1" : "0.000001"}
                value={typeof draftValues[key] === "number" ? String(draftValues[key]) : ""}
                onChange={(event) => changeSetting(key, event.target.value === "" ? null : Number(event.target.value))} />
            </label>)}
          </div>
          <label className={styles.enabledChoice}><input type="checkbox" checked={draftValues.enabled === true}
            onChange={(event) => changeSetting("enabled", event.target.checked)} />เปิดให้ทีมเริ่มค้นและเก็บข้อมูล</label>
          <details className={styles.advancedSettings}><summary>การตั้งค่าขั้นสูง</summary><textarea
            data-testid="settings-draft" rows={14} spellCheck={false}
            aria-label="การตั้งค่าการเก็บข้อมูลขั้นสูง JSON"
            value={draft} onChange={(event) => setDraft(event.target.value)}
          /></details>
          <div className={styles.actions}>
            <button type="submit" disabled={saving} className={styles.action} data-testid="settings-save">{saving ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button>
          </div>
        </form>
        {settingsMessage && (
          <p className={styles.meta} role="status" data-testid="settings-message">{settingsMessage}</p>
        )}
      </section>
    </div>
  );
}
