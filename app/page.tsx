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
      {actor ? (
        <nav style={{ display: "grid", gap: 8, marginTop: 16 }}>
          <Link href="/datasets">ชุดข้อมูล</Link>
          <Link href="/import">นำเข้าข้อมูล</Link>
        </nav>
      ) : null}
    </main>
  );
}
