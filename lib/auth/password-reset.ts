import "server-only";
import { dbUser } from "../db/user.ts";
import { requireRole } from "./roles.ts";
import { isRole, type Role } from "./role-model.ts";
import { serviceClient } from "./service-client.ts";

export type TeamMember = { user_id: string; email: string; role: Role; last_sign_in_at: string | null; reset_requested_at: string | null };
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

/** Every approved account, those asking for a new password first. Admin only. */
export async function listTeam(): Promise<TeamMember[]> {
  await requireRole("admin");
  const db = await dbUser();
  const [roles, resets, logins] = await Promise.all([
    db.from("user_roles").select("user_id,role"),
    db.from("password_reset_requests").select("email,created_at").eq("status", "pending"),
    allLogins(),
  ]);
  if (roles.error) throw roles.error;
  if (resets.error) throw resets.error;
  const byId = new Map(logins.map((login) => [login.id, login]));
  const asked = new Map((resets.data ?? []).map((row) => [row.email as string, row.created_at as string]));
  return (roles.data ?? [])
    .filter((row) => isRole(row.role) && byId.get(row.user_id)?.email)
    .map((row) => {
      const login = byId.get(row.user_id)!, email = login.email!.toLowerCase();
      return { user_id: row.user_id as string, email, role: row.role as Role, last_sign_in_at: login.last_sign_in_at ?? null, reset_requested_at: asked.get(email) ?? null };
    })
    .sort((a, b) => Number(Boolean(b.reset_requested_at)) - Number(Boolean(a.reset_requested_at)) || a.email.localeCompare(b.email));
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
