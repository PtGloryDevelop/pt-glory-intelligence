import { forbidden } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { readCollectorUsage, listRecoveryQueue, readCollectorSettings } from "@/lib/collect/admin";
import { PageHeader } from "@/components/shell/PageHeader";
import { CollectorClient } from "./collector-client";
import {apifyTokenConfigured} from '@/lib/collect/apify';

export const dynamic = "force-dynamic";

/**
 * What the collector costs and what it is waiting for. Admin only.
 *
 * Held reservations and settled provider figures are separate numbers on this
 * page because they are separate facts: one is money PT Glory is keeping aside,
 * the other is money the provider says was spent. Neither is ever called ad
 * spend, and a figure that has not settled says so on its face.
 */
export default async function CollectorPage() {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "admin")) forbidden();
  const actorRef = { userId: actor.userId, role: actor.role };

  const [usage, queue, settings] = await Promise.all([
    readCollectorUsage(actorRef),
    listRecoveryQueue(actorRef),
    readCollectorSettings(actorRef),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="การเชื่อมต่อและค่าเก็บข้อมูล"
        description="ตั้งค่าแหล่งข้อมูลและวงเงินสำหรับการค้นแอดของทีม"
      />
      <CollectorClient usage={usage} queue={queue} settings={settings} tokenConfigured={apifyTokenConfigured()} />
    </>
  );
}
