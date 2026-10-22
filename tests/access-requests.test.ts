import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { checkAccessRequest, createLimiter } from "../lib/auth/access-request-model.ts";

/**
 * Sign-up: anyone may ask, an admin approves. These pin the form rules, the brake on scripted sign-ups,
 * and that the decision path stays admin-only and server-side.
 */

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });
// Generated, never typed: the security suite refuses password literals in test files.
const secret = randomUUID(), tooShort = secret.slice(0, 5), thaiLong = "ก".repeat(30);
const good = { full_name: "  สมชาย   ใจดี ", email: " Somchai@PTGlory.co ", password: secret, confirm: secret, team: " ทีมยิงแอด U24 ", note: "" };

test("a complete form is read clean: one-spaced name, lower-case email, empty optionals as null", () => {
  const checked = checkAccessRequest(form(good));
  assert.deepEqual(checked, { ok: true, value: { fullName: "สมชาย ใจดี", email: "somchai@ptglory.co", password: secret, team: "ทีมยิงแอด U24", note: null } });
});

test("each broken field says what to fix", () => {
  const error = (fields: Record<string, string>) => { const checked = checkAccessRequest(form({ ...good, ...fields })); return checked.ok ? null : checked.error; };
  assert.match(error({ full_name: "ก" })!, /ชื่อ/);
  assert.match(error({ email: "not-an-email" })!, /อีเมล/);
  assert.match(error({ password: tooShort, confirm: tooShort })!, /8 ตัวอักษร/);
  assert.match(error({ confirm: `${secret}x` })!, /ไม่ตรงกัน/);
  assert.match(error({ password: thaiLong, confirm: thaiLong })!, /ยาวเกินไป/, "Thai is 3 bytes a letter: 30 letters pass 72 bytes");
  assert.match(error({ note: "x".repeat(301) })!, /300/);
});

test("the limiter lets a few through per key, then waits for the window", () => {
  const allow = createLimiter(2, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 10), true);
  assert.equal(allow("a", 20), false);
  assert.equal(allow("b", 20), true, "another address is counted apart");
  assert.equal(allow("a", 1011), true, "the first try has left the window");
});

test("only admins decide, the decision runs on the server, and sign-up never grants a role", () => {
  const lib = readFileSync(join("lib", "auth", "access-requests.ts"), "utf8");
  assert.match(lib, /^import "server-only";/);
  assert.match(lib, /decideAccessRequest[\s\S]*?await requireRole\("admin"\)/);
  assert.match(lib, /email_confirm: false/, "a signed-up login cannot sign in before approval");
  const signup = lib.slice(lib.indexOf("export async function requestAccess"), lib.indexOf("export async function listAccessRequests"));
  assert.doesNotMatch(signup, /user_roles/);
  const migration = readFileSync(join("supabase", "migrations", "0071_access_requests.sql"), "utf8");
  assert.match(migration, /revoke all on public\.access_requests from public, anon, authenticated;/);
  assert.match(migration, /grant select, update on public\.access_requests to authenticated;/);
});
