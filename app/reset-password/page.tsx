import Image from "next/image";
import Link from "next/link";
import { ErrorState } from "@/components/states/ErrorState";
import login from "../login/login.module.css";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

/** Opened from the admin's one-time link. Opening it spends nothing; submitting the new password does. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token_hash?: string | string[] }> }) {
  const raw = (await searchParams).token_hash;
  const token = typeof raw === "string" ? raw : "";
  return (
    <main className={login.wrap}>
      <div className={login.card}>
        <div className={login.head}>
          <Image className={login.logo} src="/logo/pt-mark.png" alt="" width={48} height={48} priority />
          <div className={login.wordmark}>PT GLORY<span>AD INTELLIGENCE</span></div>
        </div>
        <div className={login.body}>
          <h1 className={login.welcome}>ตั้งรหัสผ่านใหม่</h1>
          <p className={login.sub}>ตั้งรหัสผ่านใหม่แล้วเข้าสู่ระบบได้ทันที</p>
          {token ? <ResetForm token={token} /> : <ErrorState title="ลิงก์ไม่ครบ ขอลิงก์ใหม่จากผู้ดูแล" />}
          <p className={login.foot}><Link href="/login">กลับไปหน้าเข้าสู่ระบบ</Link></p>
        </div>
      </div>
    </main>
  );
}
