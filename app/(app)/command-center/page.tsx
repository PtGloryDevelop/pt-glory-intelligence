import { forbidden } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { OwnedPerformance } from "../owned-performance";

export const dynamic = "force-dynamic";
export default async function CommandCenter() {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  return <OwnedPerformance ranking />;
}
