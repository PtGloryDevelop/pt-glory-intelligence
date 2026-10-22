"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ErrorState } from "@/components/states/ErrorState";
import { submitForgot, type ForgotState } from "./actions";
import login from "../login/login.module.css";
import styles from "../signup/signup.module.css";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(submitForgot, { status: "idle" });
  if (state.status === "sent") {
    return (
      <div className={styles.sent} role="status" data-testid="forgot-sent">
        <h2>ส่งคำขอแล้ว</h2>
        <p>ถ้าอีเมลนี้มีบัญชีอยู่ ผู้ดูแลระบบจะได้รับคำขอ และส่งลิงก์ตั้งรหัสผ่านใหม่ให้คุณทาง LINE หรือแชท</p>
        <Link href="/login" className={styles.back}>กลับไปหน้าเข้าสู่ระบบ</Link>
      </div>
    );
  }
  return (
    <form action={action} className={login.form} data-testid="forgot-form">
      {state.status === "error" ? <ErrorState title={state.error} testId="forgot-error" /> : null}
      <label className={login.field}>
        อีเมลที่ใช้เข้าสู่ระบบ
        <input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={state.status === "error" ? state.email : undefined} />
      </label>
      <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden className={styles.trap} />
      <button type="submit" data-variant="primary" className={login.submit} disabled={pending}>{pending ? "กำลังส่งคำขอ…" : "ขอตั้งรหัสผ่านใหม่"}</button>
    </form>
  );
}
