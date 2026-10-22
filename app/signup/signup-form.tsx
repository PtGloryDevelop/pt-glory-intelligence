"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ErrorState } from "@/components/states/ErrorState";
import { submitSignup, type SignupState } from "./actions";
import login from "../login/login.module.css";
import styles from "./signup.module.css";

/** The sign-up form; on an error it keeps what was typed (never the password) and says what to fix. */
export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(submitSignup, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className={styles.sent} role="status" data-testid="signup-sent">
        <h2>{state.already ? "มีคำขอของอีเมลนี้รออยู่แล้ว" : "ส่งคำขอแล้ว"}</h2>
        <p>ผู้ดูแลระบบจะตรวจและอนุมัติสิทธิ์ให้ เมื่ออนุมัติแล้วเข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้ได้ทันที</p>
        <Link href="/login" className={styles.back}>กลับไปหน้าเข้าสู่ระบบ</Link>
      </div>
    );
  }

  const values = state.status === "error" ? state.values : null;
  return (
    <form action={action} className={login.form} data-testid="signup-form">
      {state.status === "error" ? <ErrorState title={state.error} testId="signup-error" /> : null}
      <label className={login.field}>
        ชื่อ-นามสกุล
        <input name="full_name" type="text" required minLength={2} maxLength={80} autoComplete="name" defaultValue={values?.full_name} />
      </label>
      <label className={login.field}>
        อีเมลที่ใช้ทำงาน
        <input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={values?.email} />
      </label>
      <div className={styles.pair}>
        <label className={login.field}>
          รหัสผ่าน
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <label className={login.field}>
          ยืนยันรหัสผ่าน
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </label>
      </div>
      <p className={styles.hint}>รหัสผ่านอย่างน้อย 8 ตัวอักษร</p>
      <label className={login.field}>
        <span>ทีม / ตำแหน่ง <span className={styles.optional}>ไม่บังคับ</span></span>
        <input name="team" type="text" maxLength={60} placeholder="เช่น ทีมยิงแอด U24" defaultValue={values?.team} />
      </label>
      <label className={login.field}>
        <span>ข้อความถึงผู้ดูแล <span className={styles.optional}>ไม่บังคับ</span></span>
        <textarea name="note" maxLength={300} rows={2} className={styles.note} defaultValue={values?.note} />
      </label>
      {/* Hidden from people; bots fill it. */}
      <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden className={styles.trap} />
      <button type="submit" data-variant="primary" className={login.submit} disabled={pending}>{pending ? "กำลังส่งคำขอ…" : "ส่งคำขอใช้งาน"}</button>
    </form>
  );
}
