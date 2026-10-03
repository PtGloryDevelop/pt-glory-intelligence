import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { Dashboard } from "../dashboard";

export const dynamic = "force-dynamic";
export default async function MarketOverview() {
  const actor = await requireActorOrRedirect();
  return <Dashboard canAnalyze={satisfies(actor.role, "analyst")} />;
}
