import { forbidden, redirect } from "next/navigation";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
/** UI v2 merged Command Center into แอดของเรา; old links keep working with their filters. */
export default async function CommandCenter({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, "analyst")) forbidden();
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value].flat()) if (item != null) next.append(key, item);
  redirect(`/owned-ads/performance${next.size ? `?${next}` : ""}`);
}
