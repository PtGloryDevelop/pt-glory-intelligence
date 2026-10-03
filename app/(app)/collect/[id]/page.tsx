import { forbidden, notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { readCollection } from "@/lib/collect/read";
import { PageHeader } from "@/components/shell/PageHeader";
import { CollectProgress } from "./progress-client";

export const dynamic = "force-dynamic";

/**
 * One collection, while it happens and after it finishes.
 *
 * The first render comes from the server so the page says something true
 * immediately; the client then asks the same endpoint again on a timer. Both
 * read the user-safe DTO, so there is nothing here that could name a provider.
 */
export default async function CollectDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();

  const { id } = await params;
  const collection = await readCollection(id);
  // Not visible and not existing are the same answer: asking for somebody
  // else's id teaches nothing.
  if (!collection) notFound();

  return (
    <>
      <PageHeader
        title={collection.datasetName ?? "รอบเก็บข้อมูล"}
        description={`คำค้น ${collection.keyword ?? "—"}`}
      />
      <CollectProgress initial={collection} />
    </>
  );
}
