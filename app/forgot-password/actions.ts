"use server";

import { headers } from "next/headers";
import { createLimiter, readEmail } from "@/lib/auth/access-request-model";
import { requestPasswordReset } from "@/lib/auth/password-reset";

export type ForgotState = { status: "idle" } | { status: "error"; error: string; email: string } | { status: "sent" };

// ponytail: five requests an hour from one address, per server instance.
const allow = createLimiter(5, 60 * 60_000);

/** Public. The answer is the same whether or not the email has an account, so the form cannot be used to find out who does. */
export async function submitForgot(_previous: ForgotState, form: FormData): Promise<ForgotState> {
  const raw = String(form.get("email") ?? "");
  if (String(form.get("website") ?? "")) return { status: "sent" };
  const email = readEmail(raw);
  if (!email) return { status: "error", error: "อีเมลไม่ถูกต้อง", email: raw };
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(address)) return { status: "error", error: "ส่งคำขอบ่อยเกินไป ลองใหม่ในอีกสักครู่", email: raw };
  try { await requestPasswordReset(email); }
  catch (error) {
    console.error("Password reset request failed", (error as { code?: string }).code ?? (error as Error).name);
    return { status: "error", error: "ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง", email: raw };
  }
  return { status: "sent" };
}
