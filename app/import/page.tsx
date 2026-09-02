import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import { listCategories } from "@/lib/read/queries";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // Hiding the form is a convenience, not the control: the commit route checks
  // the role again and answers 403 regardless of what the browser sends.
  if (actor.role === "viewer") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
        <h1>นำเข้าข้อมูล</h1>
        <p role="status" data-testid="viewer-notice">
          สิทธิ์ของคุณคือ viewer — ดูข้อมูลได้ แต่ไม่สามารถนำเข้าได้
        </p>
        <Link href="/datasets">ไปที่ชุดข้อมูล</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      <h1>นำเข้าข้อมูล</h1>
      <p style={{ color: "var(--muted)" }}>
        อัปโหลดไฟล์ JSON จาก PT Glory Extension · ขั้นตรวจจะไม่เขียนฐานข้อมูล
      </p>
      <ImportClient categories={await listCategories()} />
    </main>
  );
}
