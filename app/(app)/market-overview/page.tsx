import { cookies } from "next/headers";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { HOME_COOKIE, parseHomeChoice } from "@/lib/home-choice";
import { Dashboard } from "../dashboard";

export const dynamic = "force-dynamic";
/** Always the overview, whatever this person chose as home; the menu's ภาพรวม points here. */
export default async function MarketOverview() {
  const actor = await requireActorOrRedirect();
  return <Dashboard canAnalyze={satisfies(actor.role, "analyst")} home={parseHomeChoice((await cookies()).get(HOME_COOKIE)?.value)} />;
}
