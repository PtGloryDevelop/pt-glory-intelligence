import { redirect } from "next/navigation";
import { dbUser } from "@/lib/db/user";
import { getActor } from "@/lib/auth/roles";

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
    <main style={{ maxWidth: 380, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 24 }}>เข้าสู่ระบบ</h1>
      {message ? (
        <p role="status" style={{ color: "var(--gold-deep)" }}>
          {message}
        </p>
      ) : null}
      <form action={signIn} style={{ display: "grid", gap: 12 }}>
        <label>
          อีเมล
          <input name="email" type="email" required style={{ width: "100%", minHeight: 44 }} />
        </label>
        <label>
          รหัสผ่าน
          <input
            name="password"
            type="password"
            required
            style={{ width: "100%", minHeight: 44 }}
          />
        </label>
        <button type="submit" style={{ minHeight: 48 }}>
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}
