"use server";

import { headers } from "next/headers";
import { checkAccessRequest, createLimiter } from "@/lib/auth/access-request-model";
import { requestAccess } from "@/lib/auth/access-requests";

export type SignupState =
  | { status: "idle" }
  | { status: "error"; error: string; values: { email: string; team: string } }
  | { status: "sent"; already: boolean };

// ponytail: five sign-ups an hour from one address, per server instance; enough for a team, a brake on a script.
const allow = createLimiter(5, 60 * 60_000);

/** Public: anyone may ask. What they get is an unconfirmed login that cannot sign in until an admin approves it. */
export async function submitSignup(_previous: SignupState, form: FormData): Promise<SignupState> {
  const values = { email: String(form.get("email") ?? ""), team: String(form.get("team") ?? "") };
  // A field people never see; a bot that fills it is told it worked and nothing is created.
  if (String(form.get("website") ?? "")) return { status: "sent", already: false };
  const checked = checkAccessRequest(form);
  if (!checked.ok) return { status: "error", error: checked.error, values };
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(address)) return { status: "error", error: "ส่งคำขอบ่อยเกินไป ลองใหม่ในอีกสักครู่", values };
  try {
    const result = await requestAccess(checked.value);
    if (!result.ok) return { status: "error", error: result.error, values };
    return { status: "sent", already: result.already };
  } catch (error) {
    console.error("Sign-up failed", (error as { code?: string }).code ?? (error as Error).name);
    return { status: "error", error: "ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง", values };
  }
}
