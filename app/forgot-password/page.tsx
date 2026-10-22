import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import login from "../login/login.module.css";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

/** Forgot password: leave the email, an admin sends a one-time link to set a new one. */
export default async function ForgotPasswordPage() {
  if (await getActor()) redirect("/");
  return (
    <main className={login.wrap}>
      <div className={login.card}>
        <div className={login.head}>
          <Image className={login.logo} src="/logo/pt-mark.png" alt="" width={48} height={48} priority />
          <div className={login.wordmark}>PT GLORY<span>AD INTELLIGENCE</span></div>
        </div>
        <div className={login.body}>
          <h1 className={login.welcome}>ลืมรหัสผ่าน</h1>
          <p className={login.sub}>กรอกอีเมลที่ใช้เข้าสู่ระบบ ผู้ดูแลจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้คุณ</p>
          <ForgotForm />
          <p className={login.foot}>จำรหัสได้แล้ว? <Link href="/login">เข้าสู่ระบบ</Link></p>
        </div>
      </div>
    </main>
  );
}
