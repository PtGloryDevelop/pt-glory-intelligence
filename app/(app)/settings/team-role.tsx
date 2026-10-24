"use client";

import { useActionState, useState } from "react";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/role-model";
import { changeRole, deleteAccount, type DeleteState, type RoleState } from "./team-actions";
import styles from "./settings.module.css";

/**
 * One account's role, with "no access" and "delete" as the last two choices. The button shows only after a change;
 * taking access away or deleting asks for it in so many words. The server refuses to delete an account with team work.
 */
export function RoleControl({ userId, email, role }: { userId: string; email: string; role: Role | null }) {
  const [state, action, pending] = useActionState<RoleState, FormData>(changeRole, { status: "idle" });
  const [removal, remove, removing] = useActionState<DeleteState, FormData>(deleteAccount, { status: "idle" });
  const current = role ?? "none";
  const [choice, setChoice] = useState<string>(current);
  const deleting = choice === "delete", revoking = choice === "none" && role != null, busy = pending || removing;
  const problem = state.status === "error" ? state.error : removal.status === "error" ? removal.error : null;
  return (
    <form action={action} className={styles.decide}>
      <input type="hidden" name="user_id" value={userId} />
      <label className={styles.srOnly} htmlFor={`team-role-${userId}`}>สิทธิ์ของ {email}</label>
      <select id={`team-role-${userId}`} name="role" value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
        {ROLES.map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
        <option value="none">ไม่มีสิทธิ์ (เข้าใช้ไม่ได้)</option>
        <option value="delete">ลบบัญชีถาวร</option>
      </select>
      {choice !== current ? (
        <button type="submit" formAction={deleting ? remove : undefined} disabled={busy}
          data-variant={deleting || revoking ? undefined : "primary"} className={deleting || revoking ? styles.rejectConfirm : styles.approve}>
          {busy ? "กำลังบันทึก…" : deleting ? "ยืนยันลบบัญชีถาวร" : revoking ? "ยืนยันถอนสิทธิ์" : role ? "บันทึกสิทธิ์" : "คืนสิทธิ์"}
        </button>
      ) : null}
      {problem ? <span className={styles.problem} role="alert">{problem}</span> : null}
    </form>
  );
}
