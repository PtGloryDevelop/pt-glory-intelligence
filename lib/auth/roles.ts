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
