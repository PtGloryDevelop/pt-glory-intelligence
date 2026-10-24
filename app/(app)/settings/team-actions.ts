"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createResetLink, PasswordResetError } from "@/lib/auth/password-reset";
import { AuthorizationError, isRole, type Role } from "@/lib/auth/role-model";
import { setTeamRole, TeamRoleError } from "@/lib/auth/team-roles";

export type LinkState = { status: "idle" } | { status: "link"; email: string; link: string } | { status: "error"; error: string };
export type RoleState = { status: "idle" } | { status: "saved"; role: Role | null } | { status: "error"; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the link to this admin's screen only; it is never put in a URL, a log or the page's address. */
export async function makeResetLink(_previous: LinkState, form: FormData): Promise<LinkState> {
  const userId = String(form.get("user_id") ?? "");
  if (!UUID.test(userId)) return { status: "error", error: "บัญชีไม่ถูกต้อง" };
  const request = await headers();
  const host = request.get("host") ?? "";
  const proto = request.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  try {
    return { status: "link", ...(await createResetLink(userId, `${proto}://${host}`)) };
  } catch (error) {
    if (error instanceof PasswordResetError || error instanceof AuthorizationError) return { status: "error", error: error.message };
    console.error("Reset link failed", (error as { code?: string }).code ?? (error as Error).name);
    return { status: "error", error: "สร้างลิงก์ไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/** "none" takes access away. The admin check, the self rule and the audit row are in setTeamRole. */
export async function changeRole(_previous: RoleState, form: FormData): Promise<RoleState> {
  const userId = String(form.get("user_id") ?? ""), value = String(form.get("role") ?? "");
  if (!UUID.test(userId)) return { status: "error", error: "บัญชีไม่ถูกต้อง" };
  const role = value === "none" ? null : isRole(value) ? value : undefined;
  if (role === undefined) return { status: "error", error: "สิทธิ์ไม่ถูกต้อง" };
  try {
    await setTeamRole(userId, role);
  } catch (error) {
    if (error instanceof TeamRoleError || error instanceof AuthorizationError) return { status: "error", error: error.message };
    console.error("Role change failed", (error as { code?: string }).code ?? (error as Error).name);
    return { status: "error", error: "เปลี่ยนสิทธิ์ไม่สำเร็จ ลองอีกครั้ง" };
  }
  revalidatePath("/settings");
  return { status: "saved", role };
}
