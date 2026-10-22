import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dbUser } from "../db/user.ts";
import { requireRole } from "./roles.ts";
import type { Role } from "./role-model.ts";
import type { AccessRequestInput } from "./access-request-model.ts";

export type AccessRequestRow = {
  id: string; email: string; full_name: string; team: string | null; note: string | null;
  status: "pending" | "approved" | "rejected"; role: Role | null; created_at: string; decided_at: string | null;
};

/**
 * Service-role client for the account steps a session cannot take: creating an unconfirmed login, writing
 * the request row, confirming or deleting the login, and the audit row. Server only; never reaches a browser.
 */
function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Account service not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type RequestResult = { ok: true; already: boolean } | { ok: false; error: string };

/**
 * Creates the login unconfirmed (it cannot sign in) and the pending request beside it. A second request for an
 * email already waiting says so instead of creating anything; an email that already has a login is refused.
 */
export async function requestAccess(input: AccessRequestInput): Promise<RequestResult> {
  const service = serviceClient();
  const waiting = await service.from("access_requests").select("id").eq("email", input.email).eq("status", "pending").maybeSingle();
  if (waiting.error) throw waiting.error;
  if (waiting.data) return { ok: true, already: true };
  const created = await service.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: false, user_metadata: { full_name: input.fullName },
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists" || created.error?.status === 422) {
      return { ok: false, error: "อีเมลนี้มีบัญชีอยู่แล้ว เข้าสู่ระบบได้เลย หรือแจ้งผู้ดูแลถ้าลืมรหัสผ่าน" };
    }
    throw created.error ?? new Error("Sign-up failed");
  }
  const row = await service.from("access_requests").insert({
    user_id: created.data.user.id, email: input.email, full_name: input.fullName, team: input.team, note: input.note,
  });
  if (row.error) {
    // No request without its login, and no unconfirmed login without a request an admin can see.
    await service.auth.admin.deleteUser(created.data.user.id).catch(() => {});
    throw row.error;
  }
  return { ok: true, already: false };
}

/** Pending requests, oldest first, and the last decisions. Admins only: RLS returns nothing to anyone else. */
export async function listAccessRequests(): Promise<{ pending: AccessRequestRow[]; recent: AccessRequestRow[] }> {
  const db = await dbUser();
  const fields = "id,email,full_name,team,note,status,role,created_at,decided_at";
  const [pending, recent] = await Promise.all([
    db.from("access_requests").select(fields).eq("status", "pending").order("created_at"),
    db.from("access_requests").select(fields).neq("status", "pending").order("decided_at", { ascending: false }).limit(8),
  ]);
  if (pending.error) throw pending.error;
  if (recent.error) throw recent.error;
  return { pending: (pending.data ?? []) as AccessRequestRow[], recent: (recent.data ?? []) as AccessRequestRow[] };
}

/** How many wait for an admin; null for anyone who may not see them. */
export async function pendingAccessCount(role: Role): Promise<number | null> {
  if (role !== "admin") return null;
  const db = await dbUser();
  const { count, error } = await db.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  return error ? null : count ?? 0;
}

export class AccessDecisionError extends Error {}

/**
 * Approve: the role is written with the admin's own session (RLS: admins only, never for themselves), then the
 * login is confirmed so it can sign in. Reject: the login is deleted so the email is free again. Either way the
 * request is closed and an audit row records who decided. Re-running an approval that stopped half way is safe.
 */
export async function decideAccessRequest(id: string, decision: "approve" | "reject", role: Role): Promise<void> {
  const actor = await requireRole("admin");
  const db = await dbUser();
  const found = await db.from("access_requests").select("id,user_id,email,status").eq("id", id).maybeSingle();
  if (found.error) throw found.error;
  const request = found.data as { id: string; user_id: string | null; email: string; status: string } | null;
  if (!request || request.status !== "pending") throw new AccessDecisionError("คำขอนี้ถูกตัดสินไปแล้ว หรือไม่มีอยู่");
  const service = serviceClient();
  if (decision === "approve") {
    if (!request.user_id) throw new AccessDecisionError("บัญชีของคำขอนี้ไม่มีแล้ว ให้ผู้ขอสมัครใหม่");
    if (request.user_id === actor.userId) throw new AccessDecisionError("อนุมัติคำขอของตัวเองไม่ได้");
    const granted = await db.from("user_roles").upsert({ user_id: request.user_id, role, updated_at: new Date().toISOString() });
    if (granted.error) throw granted.error;
    const confirmed = await service.auth.admin.updateUserById(request.user_id, { email_confirm: true });
    if (confirmed.error) throw confirmed.error;
  } else if (request.user_id) {
    const removed = await service.auth.admin.deleteUser(request.user_id);
    if (removed.error && removed.error.status !== 404) throw removed.error;
  }
  const status = decision === "approve" ? "approved" : "rejected";
  const closed = await db.from("access_requests").update({
    status, role: decision === "approve" ? role : null, decided_at: new Date().toISOString(), decided_by: actor.userId,
  }).eq("id", id).eq("status", "pending");
  if (closed.error) throw closed.error;
  await service.from("audit_logs").insert({
    actor: actor.userId, action: `access_request.${decision}`, entity_type: "access_request", entity_id: id,
    before: { status: "pending", email: request.email }, after: { status, role: decision === "approve" ? role : null },
  });
}
