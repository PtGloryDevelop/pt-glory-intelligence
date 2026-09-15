import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import { AppShell } from "@/components/shell/AppShell";
import { visibleNav } from "@/components/shell/nav";

export const dynamic = "force-dynamic";

/**
 * Shell for every authenticated page.
 *
 * The route group changes no URLs — `/import` is still `/import`. The redirect
 * here is a convenience so pages do not each repeat it; each page and every API
 * route still performs its own authorization, because this layout is not a
 * security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  // The menu is decided here, by the role the server resolved: an entry the
  // caller may not use never reaches their HTML.
  return (
    <AppShell role={actor.role} sections={visibleNav(actor.role)}>
      {children}
    </AppShell>
  );
}
