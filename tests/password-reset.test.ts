import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { checkNewPassword, readEmail } from "../lib/auth/access-request-model.ts";

/**
 * Forgot password: the person leaves an email, an admin makes a one-time link and sends it to them.
 * These pin the shared password rule and the three things that keep the flow safe.
 */

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });
const secret = randomUUID();

test("a new password follows the sign-up rule: 8 characters, typed twice the same", () => {
  assert.deepEqual(checkNewPassword(form({ password: secret, confirm: secret })), { ok: true, value: secret });
  assert.equal(checkNewPassword(form({ password: secret.slice(0, 7), confirm: secret.slice(0, 7) })).ok, false);
  assert.equal(checkNewPassword(form({ password: secret, confirm: `${secret}x` })).ok, false);
});

test("emails are read the way they are stored", () => {
  assert.equal(readEmail("  Someone@PTGlory.co "), "someone@ptglory.co");
  assert.equal(readEmail("no-at-sign"), null);
  assert.equal(readEmail(42), null);
});

test("only admins make links, only for approved accounts, and nothing is emailed", () => {
  const lib = readFileSync(join("lib", "auth", "password-reset.ts"), "utf8");
  assert.match(lib, /^import "server-only";/);
  const make = lib.slice(lib.indexOf("export async function createResetLink"));
  assert.match(make, /await requireRole\("admin"\)/);
  assert.match(make, /user_roles[\s\S]*?if \(!role\.data\) throw/, "a pending sign-up never gets a link");
  assert.doesNotMatch(lib, /resetPasswordForEmail|inviteUserByEmail/);
  const ask = lib.slice(lib.indexOf("export async function requestPasswordReset"), lib.indexOf("export async function listTeam"));
  assert.match(ask, /if \(!role\.data\) return;/, "a request is stored only for an approved account");
});

test("opening the link spends nothing; submitting the new password does", () => {
  const page = readFileSync(join("app", "reset-password", "page.tsx"), "utf8");
  assert.doesNotMatch(page, /verifyOtp|exchangeCode/, "a chat app's preview opens the page; it must not use the token up");
  const action = readFileSync(join("app", "reset-password", "actions.ts"), "utf8");
  assert.match(action, /checkNewPassword[\s\S]*?verifyOtp\(\{ type: "recovery", token_hash: token \}\)[\s\S]*?updateUser/, "the password is checked before the token is spent");
});

test("signing out ends this device's session only", () => {
  const action = readFileSync(join("app", "(app)", "sign-out.ts"), "utf8");
  assert.match(action, /signOut\(\{ scope: "local" \}\)/, "the default scope signs the account out on every device");
});
