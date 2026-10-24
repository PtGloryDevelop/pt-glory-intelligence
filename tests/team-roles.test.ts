import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Admins change a role or take access away from the team list. These pin the rules that keep that safe:
 * admin only, never your own role, never a sign-up still waiting, the login and its work kept, every change audited.
 */

const lib = readFileSync(join("lib", "auth", "team-roles.ts"), "utf8");

test("only an admin changes roles, never their own, never for a sign-up still waiting", () => {
  assert.match(lib, /^import "server-only";/);
  assert.match(lib, /await requireRole\("admin"\)/);
  assert.match(lib, /userId === actor\.userId\) throw/);
  assert.match(lib, /email_confirmed_at\) throw/);
});

test("roles are written with the admin's own session, so RLS still decides", () => {
  const write = lib.slice(lib.indexOf("const db = await dbUser()"));
  assert.match(write, /db\.from\("user_roles"\)\.upsert/);
  assert.match(write, /db\.from\("user_roles"\)\.delete\(\)/);
  assert.doesNotMatch(lib, /service\.from\("user_roles"\)/, "the service role would skip the never-your-own-role policy");
  assert.match(lib, /!written\.data\?\.length\) throw/, "a delete RLS refuses returns no rows, not an error");
});

test("taking access away keeps the login and what it made, and is audited", () => {
  assert.doesNotMatch(lib, /deleteUser/);
  assert.match(lib, /action: role \? "user_role\.change" : "user_role\.revoke"/);
});

test("the team list leaves out waiting sign-ups and offers no role control on your own row", () => {
  const list = readFileSync(join("lib", "auth", "password-reset.ts"), "utf8");
  const listTeam = list.slice(list.indexOf("export async function listTeam"), list.indexOf("export async function createResetLink"));
  assert.match(listTeam, /roleOf\.has\(login\.id\) \|\| login\.email_confirmed_at/);
  assert.match(listTeam, /self: login\.id === actor\.userId/);
  const page = readFileSync(join("app", "(app)", "settings", "team-accounts.tsx"), "utf8");
  assert.match(page, /member\.self \? null : <RoleControl/);
  assert.match(page, /member\.role \? <ResetLinkButton/, "no new-password link for an account without access");
});
