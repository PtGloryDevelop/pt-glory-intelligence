import { forbidden, redirect } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { CommandCenter } from "./command-center";

export const dynamic = "force-dynamic";
/** The ranking board. Old links carried `sort` for the ads list (UI v2 merge); those still land there with their filters. */
export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  const params = await searchParams;
  if (params.sort != null) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) for (const item of [value].flat()) if (item != null) next.append(key, item);
    redirect(`/owned-ads/performance?${next}`);
  }
  return <CommandCenter />;
}
