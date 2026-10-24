import "server-only";
import { dbUser } from "../db/user.ts";
import { requireRole } from "./roles.ts";
import { isRole, type Role } from "./role-model.ts";
import { serviceClient } from "./service-client.ts";

/** `role` null: access was taken away (the login stays, see setTeamRole). `self`: the admin looking at the list. */
export type TeamMember = { user_id: string; email: string; role: Role | null; self: boolean; last_sign_in_at: string | null; reset_requested_at: string | null };
export class PasswordResetError extends Error {}

// ponytail: one page of 1,000 logins covers this team; page through listUsers if it ever grows past that.
async function allLogins() {
  const { data, error } = await serviceClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users;
}

/**
 * "Forgot password": stores the request only when the email belongs to an approved account (one with a role),
 * so nobody can use it to get around sign-up approval. The answer to the person is the same either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = (await allLogins()).find((login) => login.email?.toLowerCase() === email);
  if (!user) return;
  const service = serviceClient();
  const role = await service.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (role.error) throw role.error;
  if (!role.data) return;
  const row = await service.from("password_reset_requests").insert({ email });
  // 23505: a request for this email is already waiting.
  if (row.error && row.error.code !== "23505") throw row.error;
}

/**
 * Every confirmed login: approved accounts, then those whose access was taken away, so it can be given back.
 * Those asking for a new password come first. Sign-ups still waiting are not confirmed and stay out. Admin only.
 */
export async function listTeam(): Promise<TeamMember[]> {
  const actor = await requireRole("admin");
  const db = await dbUser();
  const [roles, resets, logins] = await Promise.all([
    db.from("user_roles").select("user_id,role"),
    db.from("password_reset_requests").select("email,created_at").eq("status", "pending"),
    allLogins(),
  ]);
  if (roles.error) throw roles.error;
  if (resets.error) throw resets.error;
  const roleOf = new Map((roles.data ?? []).filter((row) => isRole(row.role)).map((row) => [row.user_id as string, row.role as Role]));
  const asked = new Map((resets.data ?? []).map((row) => [row.email as string, row.created_at as string]));
  return logins
    .filter((login) => login.email && (roleOf.has(login.id) || login.email_confirmed_at))
    .map((login) => {
      const email = login.email!.toLowerCase(), role = roleOf.get(login.id) ?? null;
      return { user_id: login.id, email, role, self: login.id === actor.userId, last_sign_in_at: login.last_sign_in_at ?? null, reset_requested_at: role ? asked.get(email) ?? null : null };
    })
    .sort((a, b) => Number(Boolean(b.reset_requested_at)) - Number(Boolean(a.reset_requested_at)) || Number(!a.role) - Number(!b.role) || a.email.localeCompare(b.email));
}

/**
 * A one-time link to set a new password, for an approved account. Nothing is emailed: the admin sends the link
 * to the person directly. The token is spent only when the person submits a new password, so a chat app's link
 * preview cannot use it up. Closes any waiting request for that email and records who made the link.
 */
export async function createResetLink(userId: string, origin: string): Promise<{ email: string; link: string }> {
  const actor = await requireRole("admin");
  const db = await dbUser();
  const role = await db.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (role.error) throw role.error;
  if (!role.data) throw new PasswordResetError("บัญชีนี้ยังไม่ได้รับอนุมัติ ตั้งรหัสผ่านใหม่ให้ไม่ได้");
  const service = serviceClient();
  const found = await service.auth.admin.getUserById(userId);
  const email = found.data.user?.email?.toLowerCase();
  if (found.error || !email) throw new PasswordResetError("ไม่พบบัญชีนี้");
  const generated = await service.auth.admin.generateLink({ type: "recovery", email });
  const token = generated.data.properties?.hashed_token;
  if (generated.error || !token) throw generated.error ?? new Error("Recovery token missing");
  const closed = await db.from("password_reset_requests").update({ status: "handled", handled_at: new Date().toISOString(), handled_by: actor.userId })
    .eq("email", email).eq("status", "pending");
  if (closed.error) throw closed.error;
  await service.from("audit_logs").insert({ actor: actor.userId, action: "password_reset.link_created", entity_type: "user", entity_id: userId, before: null, after: { email } });
  return { email, link: `${origin}/reset-password?token_hash=${encodeURIComponent(token)}` };
}
