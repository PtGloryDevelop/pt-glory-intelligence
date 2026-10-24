"use client";

import { useActionState, useState } from "react";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/role-model";
import { changeRole, type RoleState } from "./team-actions";
import styles from "./settings.module.css";

/** One account's role. The save button shows only after a change; taking access away asks for it in so many words. */
export function RoleControl({ userId, email, role }: { userId: string; email: string; role: Role | null }) {
  const [state, action, pending] = useActionState<RoleState, FormData>(changeRole, { status: "idle" });
  const current = role ?? "none";
  const [choice, setChoice] = useState<string>(current);
  const revoking = choice === "none" && role != null;
  return (
    <form action={action} className={styles.decide}>
      <input type="hidden" name="user_id" value={userId} />
      <label className={styles.srOnly} htmlFor={`team-role-${userId}`}>สิทธิ์ของ {email}</label>
      <select id={`team-role-${userId}`} name="role" value={choice} onChange={(event) => setChoice(event.target.value)} disabled={pending}>
        {ROLES.map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
        <option value="none">ไม่มีสิทธิ์ (เข้าใช้ไม่ได้)</option>
      </select>
      {choice !== current ? (
        <button type="submit" disabled={pending} data-variant={revoking ? undefined : "primary"} className={revoking ? styles.rejectConfirm : styles.approve}>
          {pending ? "กำลังบันทึก…" : revoking ? "ยืนยันถอนสิทธิ์" : role ? "บันทึกสิทธิ์" : "คืนสิทธิ์"}
        </button>
      ) : null}
      {state.status === "error" ? <span className={styles.problem} role="alert">{state.error}</span> : null}
    </form>
  );
}
