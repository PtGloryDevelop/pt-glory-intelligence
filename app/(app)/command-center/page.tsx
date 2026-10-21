import { forbidden, redirect } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * The Command Center now lives on the owned-ads page as its quick-rankings tab (UI v3).
 * Old links keep working: their filters carry over. Links that carried `sort` were for the
 * ads list (UI v2 merge) and still land on the list itself.
 */
export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  const params = await searchParams;
  const next = new URLSearchParams();
  if (params.sort != null) {
    for (const [key, value] of Object.entries(params)) for (const item of [value].flat()) if (item != null) next.append(key, item);
    redirect(`/owned-ads/performance?${next}`);
  }
  for (const key of ["period", "from", "to", "unit", "pageId"]) for (const item of [params[key]].flat()) if (item != null) next.append(key, item);
  next.set("tab", "rank");
  redirect(`/owned-ads/performance?${next}`);
}
