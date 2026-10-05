import { redirect } from "next/navigation";
import Image from "next/image";
import { dbUser } from "@/lib/db/user";
import { getActor } from "@/lib/auth/roles";
import { ErrorState } from "@/components/states/ErrorState";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  unavailable: "ยังเชื่อมต่อระบบเข้าสู่ระบบไม่ได้ กรุณาลองใหม่อีกครั้ง",
  no_role: "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน แจ้งผู้ดูแลระบบเพื่อกำหนดสิทธิ์",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getActor()) redirect("/");
  const message = ERRORS[(await searchParams).error ?? ""];

  async function signIn(formData: FormData) {
    "use server";
    const supabase = await dbUser();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    if (error) {
      console.error("Login failed", error.code ?? error.name);
      redirect(error.name === "AuthRetryableFetchError" ? "/login?error=unavailable" : "/login?error=invalid");
    }
    // A signed-in user without a role row cannot do anything; say so explicitly
    // instead of dropping them on an empty app.
    if (!(await getActor())) redirect("/login?error=no_role");
    redirect("/");
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.head}>
          <Image className={styles.logo} src="/logo/pt-mark.png" alt="" width={48} height={48} priority />
          <div className={styles.wordmark}>PT GLORY<span>AD INTELLIGENCE</span></div>
        </div>

        <div className={styles.body}>
          <h1 className={styles.welcome}>พื้นที่สำหรับไอเดียครั้งต่อไป</h1>
          <p className={styles.sub}>เข้าสู่คลังแอดของทีม เพื่อสำรวจ เปรียบเทียบ และตัดสินใจจากหลักฐาน</p>

          {message ? <ErrorState title={message} /> : null}

          <form action={signIn} className={styles.form} style={{ marginTop: 18 }}>
            <label className={styles.field}>
              อีเมล
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label className={styles.field}>
              รหัสผ่าน
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit" data-variant="primary" className={styles.submit}>
              เข้าสู่ระบบ
            </button>
          </form>

          <p className={styles.foot}>ยังไม่ได้รับสิทธิ์ใช้งาน? ติดต่อผู้ดูแลระบบ</p>
        </div>
      </div>
    </main>
  );
}
