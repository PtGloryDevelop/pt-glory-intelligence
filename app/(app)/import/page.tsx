import { forbidden } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { listCategories } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  const actor = await requireActorOrRedirect();

  // Hiding the form is a convenience, not the control: both import routes check
  // the role again and answer 403 regardless of what the browser sends.
  //
  // Admin only since C14. Manual import is how an admin recovers — from a file
  // a capture tool produced, or one kept from an earlier collection — and it is
  // no longer one of the ways a person collects data. `forbidden()` makes the
  // refusal a real 403 rather than a 200 with a message in it.
  if (!satisfies(actor.role, "admin")) forbidden();

  return (
    <>
      <PageHeader
        title="นำเข้าไฟล์ (กู้คืนระบบ)"
        description="อัปโหลดไฟล์ JSON ของ PT Glory · ขั้นตรวจจะไม่เขียนฐานข้อมูล"
      />
      <ImportClient categories={await listCategories()} />
    </>
  );
}
