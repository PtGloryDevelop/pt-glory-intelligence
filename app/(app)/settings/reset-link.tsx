"use client";

import { useActionState, useState } from "react";
import { makeResetLink, type LinkState } from "./team-actions";
import styles from "./settings.module.css";

/** One account's "new password" button; the link appears once, here, with a copy button. */
export function ResetLinkButton({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(makeResetLink, { status: "idle" });
  const [copied, setCopied] = useState(false);
  if (state.status === "link") {
    return (
      <div className={styles.linkBox} data-testid={`reset-link-${email}`}>
        <div className={styles.linkRow}>
          <input readOnly value={state.link} onFocus={(event) => event.currentTarget.select()} aria-label={`ลิงก์ตั้งรหัสผ่านใหม่ของ ${email}`} />
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(state.link); setCopied(true); } catch { setCopied(false); } }}>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</button>
        </div>
        <span className={styles.hint}>ส่งให้ {email} ทาง LINE หรือแชท · ใช้ได้ครั้งเดียว ภายในประมาณ 1 ชั่วโมง</span>
      </div>
    );
  }
  return (
    <form action={action} className={styles.decide}>
      <input type="hidden" name="user_id" value={userId} />
      <button type="submit" className={styles.linkButton} disabled={pending}>{pending ? "กำลังสร้างลิงก์…" : "สร้างลิงก์ตั้งรหัสใหม่"}</button>
      {state.status === "error" ? <span className={styles.problem} role="alert">{state.error}</span> : null}
    </form>
  );
}
