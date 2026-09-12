import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { listCategories } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  const actor = await requireActorOrRedirect();

  // Hiding the form is a convenience, not the control: the commit route checks
  // the role again and answers 403 regardless of what the browser sends.
  if (actor.role === "viewer") {
    return (
      <>
        <PageHeader title="นำเข้าข้อมูล" />
        <EmptyState
          testId="viewer-notice"
          title="สิทธิ์ของคุณคือ viewer"
          body="ดูข้อมูลได้ แต่ไม่สามารถนำเข้าได้"
          action={<Link href="/datasets">ไปที่ชุดข้อมูล</Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="นำเข้าข้อมูล"
        description="อัปโหลดไฟล์ JSON ของ PT Glory · ขั้นตรวจจะไม่เขียนฐานข้อมูล"
      />
      <ImportClient categories={await listCategories()} />
    </>
  );
}
