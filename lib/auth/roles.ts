import { redirect } from "next/navigation";
import { dbUser } from "../db/user.ts";
import { AuthorizationError, isRole, satisfies, type Actor, type Role } from "./role-model.ts";

export { ROLES, AuthorizationError, isRole, satisfies } from "./role-model.ts";
export type { Actor, Role } from "./role-model.ts";

/** Current actor, or null when nobody is signed in or the account has no role yet. */
export async function getActor(): Promise<Actor | null> {
  const supabase = await dbUser();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const { data: row } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  return isRole(row?.role) ? { userId: user.id, role: row.role } : null;
}

/**
 * Throws before any privileged work happens. Import routes must call this
 * *before* opening a transaction, because that connection bypasses RLS.
 */
export async function requireRole(required: Role): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthorizationError(401, "Sign in required");
  if (!satisfies(actor.role, required)) {
    throw new AuthorizationError(403, `Requires ${required} role`);
  }
  return actor;
}

/**
 * The guard every authenticated page must await before it reads anything.
 *
 * The `(app)` layout also redirects, but a layout is not an ordering mechanism:
 * Next renders layout and page concurrently, so a page that starts a query in
 * its own body has already issued it by the time the layout's `redirect()`
 * throws. That is how an unauthenticated `GET /datasets` came to answer 307
 * while still logging `42501 permission denied for function dataset_list` — the
 * grants stopped it, which is the last line of defence doing a job the request
 * path should never have handed it.
 *
 * So each page awaits this first, and only then reads. The redirect here is the
 * ordering; the grants stay exactly as strict as they are.
 */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}
