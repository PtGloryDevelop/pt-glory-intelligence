import { randomUUID } from "node:crypto";
import { forbidden } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { listCategories } from "@/lib/read/queries";
import { listCollections } from "@/lib/collect/read";
import { collectorFormSettings } from "@/lib/collect/form-settings";
import { PageHeader } from "@/components/shell/PageHeader";
import { CollectClient } from "./collect-client";

export const dynamic = "force-dynamic";

/**
 * Asking for a new collection.
 *
 * Everything a person needs to decide is here and nothing else is: a keyword, a
 * country, what to count as current, how many ads at most, which category the
 * result belongs to, and what to call it. How the data is actually fetched is
 * the server's business and is not mentioned on this page.
 *
 * The idempotency key is generated here, once per rendered form. A key made in
 * the browser would change on every re-render, and each change is another paid
 * collection — so the form carries one key from the moment it exists, and a
 * double click, a slow network or a stray retry all land on the same request.
 */
export default async function CollectPage() {
  const actor = await requireActorOrRedirect();
  // A viewer reads research; they do not spend money. Refused with a status,
  // not a hidden button.
  if (!satisfies(actor.role, "analyst")) forbidden();

  const [categories, settings, recent] = await Promise.all([
    listCategories(),
    collectorFormSettings(),
    listCollections(10),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="DISCOVER · ค้นแอดใหม่"
        title="คุณอยากสำรวจแอดเรื่องอะไร?"
        description="เลือกคำค้นและประเทศ ระบบจะรวบรวมแอดมาให้ค้นและเปรียบเทียบในคลังของทีม"
      />
      <CollectClient
        requestKey={randomUUID()}
        categories={categories}
        settings={settings}
        recent={recent}
      />
    </>
  );
}
