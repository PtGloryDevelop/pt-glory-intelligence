"use client";

import { ErrorState } from "@/components/states/ErrorState";

/**
 * When a page throws.
 *
 * Without this boundary a failed read — the database unreachable, a request
 * timing out — dropped the reader onto Next's own "This page couldn't load"
 * screen: someone else's typeface, someone else's English, and no way to tell a
 * broken connection apart from broken data. This is a system failure said in the
 * product's own voice, and kept clearly separate from the states that mean
 * something about the data: partial, unknown, unusable, zero results.
 *
 * The message deliberately carries no backend detail. `digest` is the id Next
 * writes to the server log for this exact throw, which is what makes a report
 * traceable without putting a stack trace on a screen.
 */
export default function AppError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: "8px 0" }}>
      <ErrorState
        testId="route-error"
        title="โหลดหน้านี้ไม่สำเร็จ"
        detail="ระบบติดต่อฐานข้อมูลไม่ได้ในขณะนี้ ข้อมูลที่มีอยู่ไม่ได้เสียหาย ลองใหม่อีกครั้งได้เลย"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button type="button" data-variant="primary" data-testid="route-error-retry" onClick={reset}>
          ลองอีกครั้ง
        </button>
        {error.digest ? (
          <span style={{ fontSize: "var(--fs-meta)", color: "var(--muted)" }}>
            รหัสอ้างอิง {error.digest}
          </span>
        ) : null}
      </div>
    </div>
  );
}
