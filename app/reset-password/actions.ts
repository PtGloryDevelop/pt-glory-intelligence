"use server";

import { redirect } from "next/navigation";
import { dbUser } from "@/lib/db/user";
import { checkNewPassword } from "@/lib/auth/access-request-model";

export type ResetState = { status: "idle" } | { status: "error"; error: string; spent: boolean };

const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Sets the new password from the one-time link. The token is spent here, on submit, never when the page opens:
 * a chat app's link preview fetches the page and would otherwise use it up before the person sees it.
 */
export async function setNewPassword(_previous: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get("token_hash") ?? "");
  if (!TOKEN.test(token)) return { status: "error", error: "ลิงก์ไม่ถูกต้อง ขอลิงก์ใหม่จากผู้ดูแล", spent: true };
  const password = checkNewPassword(form);
  if (!password.ok) return { status: "error", error: password.error, spent: false };
  const supabase = await dbUser();
  const verified = await supabase.auth.verifyOtp({ type: "recovery", token_hash: token });
  if (verified.error) return { status: "error", error: "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่จากผู้ดูแล", spent: true };
  const updated = await supabase.auth.updateUser({ password: password.value });
  if (updated.error) {
    console.error("Password update failed", updated.error.code ?? updated.error.name);
    // The link is spent but the person is signed in now; the home page lets them carry on with the old password.
    return { status: "error", error: updated.error.code === "same_password" ? "รหัสใหม่ซ้ำกับรหัสเดิม ใช้รหัสเดิมเข้าสู่ระบบได้เลย" : "ตั้งรหัสผ่านไม่สำเร็จ ขอลิงก์ใหม่จากผู้ดูแล", spent: true };
  }
  redirect("/");
}
