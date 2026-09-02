import Link from "next/link";
import { getActor } from "@/lib/auth/roles";
import { PageHeader } from "@/components/shell/PageHeader";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actor = await getActor();

  return (
    <>
      <PageHeader
        title="PT Glory Intelligence"
        description="ระบบวิเคราะห์โฆษณาคู่แข่งภายใน · Phase 1 — นำเข้าข้อมูลและสำรวจ Dataset"
      />
      <p>
        เข้าสู่ระบบแล้ว · สิทธิ์ <strong>{actor?.role}</strong>
      </p>
      <nav style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Link href="/datasets">ชุดข้อมูล</Link>
        <Link href="/import">นำเข้าข้อมูล</Link>
      </nav>
    </>
  );
}
