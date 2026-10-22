"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ErrorState } from "@/components/states/ErrorState";
import { setNewPassword, type ResetState } from "./actions";
import login from "../login/login.module.css";
import styles from "../signup/signup.module.css";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, { status: "idle" });
  if (state.status === "error" && state.spent) {
    return (
      <div className={login.form}>
        <ErrorState title={state.error} testId="reset-error" />
        <Link href="/login" className={styles.back}>ไปหน้าเข้าสู่ระบบ</Link>
      </div>
    );
  }
  return (
    <form action={action} className={login.form} data-testid="reset-form">
      {state.status === "error" ? <ErrorState title={state.error} testId="reset-error" /> : null}
      <input type="hidden" name="token_hash" value={token} />
      <div className={styles.pair}>
        <label className={login.field}>
          รหัสผ่านใหม่
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <label className={login.field}>
          ยืนยันรหัสผ่านใหม่
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </label>
      </div>
      <p className={styles.hint}>รหัสผ่านอย่างน้อย 8 ตัวอักษร · ลิงก์นี้ใช้ได้ครั้งเดียว</p>
      <button type="submit" data-variant="primary" className={login.submit} disabled={pending}>{pending ? "กำลังตั้งรหัสผ่าน…" : "ตั้งรหัสผ่านและเข้าสู่ระบบ"}</button>
    </form>
  );
}
