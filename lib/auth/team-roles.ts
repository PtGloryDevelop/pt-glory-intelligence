import "server-only";
import { dbUser } from "../db/user.ts";
import { requireRole } from "./roles.ts";
import type { Role } from "./role-model.ts";
import { serviceClient } from "./service-client.ts";

export class TeamRoleError extends Error {}

/**
 * Change an approved account's role, or take its access away (`null`). Written with the admin's own session, so RLS
 * keeps its rule that nobody changes their own role: the admin doing this always stays an admin.
 * Taking access away removes the role row only. Every page, API and policy reads that row, so access ends on the
 * next request, while the login and what it made stay: several tables keep their author with no delete rule, and
 * some would delete the person's work with them. Giving access back is the same call with a role.
 */
export async function setTeamRole(userId: string, role: Role | null): Promise<void> {
  const actor = await requireRole("admin");
  if (userId === actor.userId) throw new TeamRoleError("เปลี่ยนสิทธิ์ของตัวเองไม่ได้ ให้ผู้ดูแลอีกคนเปลี่ยนให้");
  const service = serviceClient();
  const login = await service.auth.admin.getUserById(userId);
  if (login.error || !login.data.user) throw new TeamRoleError("ไม่พบบัญชีนี้");
  // A sign-up still waiting is decided with อนุมัติ / ปฏิเสธ, which also confirms or removes its login.
  if (!login.data.user.email_confirmed_at) throw new TeamRoleError("บัญชีนี้ยังรออนุมัติ ใช้ปุ่มอนุมัติในคำขอใช้งาน");
  const db = await dbUser();
  const before = await db.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (before.error) throw before.error;
  const from = (before.data?.role as Role | undefined) ?? null;
  if (from === role) return;
  const written = role
    ? await db.from("user_roles").upsert({ user_id: userId, role, updated_at: new Date().toISOString() }).select("user_id")
    : await db.from("user_roles").delete().eq("user_id", userId).select("user_id");
  if (written.error) throw written.error;
  // RLS turns a refused delete into zero rows rather than an error.
  if (!written.data?.length) throw new TeamRoleError("เปลี่ยนสิทธิ์ไม่สำเร็จ");
  await service.from("audit_logs").insert({
    actor: actor.userId, action: role ? "user_role.change" : "user_role.revoke", entity_type: "user", entity_id: userId,
    before: { role: from, email: login.data.user.email ?? null }, after: { role },
  });
}

/**
 * Where a login is the author of team work. The first group has no delete rule, so a delete would fail; the second
 * would be deleted along with the login (collection requests, watched items). Either way the account is kept and
 * its access taken away instead. Other references are set to null on delete and keep their rows.
 */
const KEPT_WORK = [
  ["app_settings", "updated_by"], ["audit_logs", "actor"], ["categories", "created_by"], ["collection_requests", "reservation_released_by"],
  ["collection_runs", "created_by"], ["datasets", "created_by"], ["collection_requests", "requested_by"], ["watch_items", "created_by"],
] as const;

/**
 * Delete an account for good: only someone else's, and only one with no team work behind it (typically a login
 * nobody used). Pending password requests for it are removed with it; the deletion is audited.
 */
export async function deleteTeamAccount(userId: string): Promise<void> {
  const actor = await requireRole("admin");
  if (userId === actor.userId) throw new TeamRoleError("ลบบัญชีของตัวเองไม่ได้");
  const service = serviceClient();
  const login = await service.auth.admin.getUserById(userId);
  if (login.error || !login.data.user) throw new TeamRoleError("ไม่พบบัญชีนี้");
  const counts = await Promise.all(KEPT_WORK.map(([table, column]) =>
    service.from(table).select(column, { count: "exact", head: true }).eq(column, userId)));
  const failed = counts.find((result) => result.error);
  if (failed?.error) throw failed.error;
  if (counts.some((result) => result.count)) throw new TeamRoleError("บัญชีนี้มีงานในระบบ เช่น คำขอเก็บแอดหรือรายการที่ติดตาม ลบไม่ได้ ให้เลือก “ไม่มีสิทธิ์” แทน");
  const role = await service.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  const email = login.data.user.email?.toLowerCase() ?? null;
  const removed = await service.auth.admin.deleteUser(userId);
  if (removed.error) throw removed.error;
  if (email) await service.from("password_reset_requests").delete().eq("email", email).eq("status", "pending");
  await service.from("audit_logs").insert({
    actor: actor.userId, action: "user.delete", entity_type: "user", entity_id: userId,
    before: { email, role: role.data?.role ?? null, last_sign_in_at: login.data.user.last_sign_in_at ?? null }, after: null,
  });
}
