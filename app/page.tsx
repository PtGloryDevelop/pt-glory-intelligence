import Link from "next/link";
import { getActor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actor = await getActor();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1>PT Glory Intelligence</h1>
      {actor ? (
        <p>
          เข้าสู่ระบบแล้ว · สิทธิ์ <strong>{actor.role}</strong>
        </p>
      ) : (
        <p>
          <Link href="/login">เข้าสู่ระบบ</Link>
        </p>
      )}
      <p style={{ color: "var(--muted)" }}>
        Phase 1 · Gate A — ยังไม่มีหน้าใช้งานจริงจนกว่าจะถึง T13
      </p>
    </main>
  );
}
