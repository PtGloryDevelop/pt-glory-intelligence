"use server";

import { headers } from "next/headers";
import { createResetLink, PasswordResetError } from "@/lib/auth/password-reset";
import { AuthorizationError } from "@/lib/auth/role-model";

export type LinkState = { status: "idle" } | { status: "link"; email: string; link: string } | { status: "error"; error: string };

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
