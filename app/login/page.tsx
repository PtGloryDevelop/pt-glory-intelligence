import { redirect } from "next/navigation";
import { dbUser } from "@/lib/db/user";
import { getActor } from "@/lib/auth/roles";
import { ErrorState } from "@/components/states/ErrorState";
import { BrandLockup } from "@/components/BrandMark";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
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
    if (error) redirect("/login?error=invalid");
    // A signed-in user without a role row cannot do anything; say so explicitly
    // instead of dropping them on an empty app.
    if (!(await getActor())) redirect("/login?error=no_role");
    redirect("/");
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.head}>
          <BrandLockup size="md" tagline="Competitive Ads Intelligence" />
        </div>

        <div className={styles.body}>
          <h1 className={styles.welcome}>เข้าสู่ระบบ</h1>
          <p className={styles.sub}>ระบบภายในบริษัท · สำหรับทีม PT Glory เท่านั้น</p>

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
