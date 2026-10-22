import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import login from "../login/login.module.css";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

/** Ask for an account. An admin approves it; until then the login cannot sign in. */
export default async function SignupPage() {
  if (await getActor()) redirect("/");
  return (
    <main className={login.wrap}>
      <div className={login.card}>
        <div className={login.head}>
          <Image className={login.logo} src="/logo/pt-mark.png" alt="" width={48} height={48} priority />
          <div className={login.wordmark}>PT GLORY<span>AD INTELLIGENCE</span></div>
        </div>
        <div className={login.body}>
          <h1 className={login.welcome}>ขอสิทธิ์ใช้งาน</h1>
          <p className={login.sub}>กรอกข้อมูลแล้วส่งคำขอ ผู้ดูแลระบบจะอนุมัติให้ จากนั้นเข้าสู่ระบบได้ทันที</p>
          <SignupForm />
          <p className={login.foot}>มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link></p>
        </div>
      </div>
    </main>
  );
}
