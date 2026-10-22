/**
 * Sign-up form rules. Pure: no Next.js or Supabase, so the checks are unit-tested without a request.
 */

export type AccessRequestInput = { email: string; password: string; team: string | null };
export type AccessRequestCheck = { ok: true; value: AccessRequestInput } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value: unknown) => (typeof value === "string" ? value : "").trim();

/** Reads the sign-up form: email, the password twice, an optional team. The email is stored lower-case, so one person cannot hold two pending requests by case. */
export function checkAccessRequest(form: { get(name: string): unknown }): AccessRequestCheck {
  const email = text(form.get("email")).toLowerCase();
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const confirm = typeof form.get("confirm") === "string" ? String(form.get("confirm")) : "";
  const team = text(form.get("team")) || null;
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "อีเมลไม่ถูกต้อง" };
  // 72 bytes is where the password hash stops reading; a longer password would be silently cut.
  if (password.length < 8) return { ok: false, error: "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร" };
  if (new TextEncoder().encode(password).length > 72) return { ok: false, error: "รหัสผ่านยาวเกินไป" };
  if (password !== confirm) return { ok: false, error: "ยืนยันรหัสผ่านไม่ตรงกัน" };
  if (team && team.length > 60) return { ok: false, error: "ชื่อทีมยาวเกิน 60 ตัวอักษร" };
  return { ok: true, value: { email, password, team } };
}

/** At most `limit` attempts per key per window. In memory, per server instance: a brake on scripted sign-ups, not a wall. */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(now);
    if (hits.size > 5000) hits.clear();
    hits.set(key, recent);
    return true;
  };
}
