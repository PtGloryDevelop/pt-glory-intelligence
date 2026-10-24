import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Admins change a role or take access away from the team list. These pin the rules that keep that safe:
 * admin only, never your own role, never a sign-up still waiting, the login and its work kept, every change audited.
 */

const lib = readFileSync(join("lib", "auth", "team-roles.ts"), "utf8");
const setRole = lib.slice(lib.indexOf("export async function setTeamRole"), lib.indexOf("const KEPT_WORK"));

test("only an admin changes roles, never their own, never for a sign-up still waiting", () => {
  assert.match(lib, /^import "server-only";/);
  assert.match(lib, /await requireRole\("admin"\)/);
  assert.match(lib, /userId === actor\.userId\) throw/);
  assert.match(lib, /email_confirmed_at\) throw/);
});

test("roles are written with the admin's own session, so RLS still decides", () => {
  const write = setRole.slice(setRole.indexOf("const db = await dbUser()"));
  assert.match(write, /db\.from\("user_roles"\)\.upsert/);
  assert.match(write, /db\.from\("user_roles"\)\.delete\(\)/);
  assert.doesNotMatch(setRole, /service\.from\("user_roles"\)/, "the service role would skip the never-your-own-role policy");
  assert.match(setRole, /!written\.data\?\.length\) throw/, "a delete RLS refuses returns no rows, not an error");
});

test("taking access away keeps the login and what it made, and is audited", () => {
  assert.doesNotMatch(setRole, /deleteUser/);
  assert.match(setRole, /action: role \? "user_role\.change" : "user_role\.revoke"/);
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

test("an account is deleted only when no team work would fail the delete or go with it", () => {
  const remove = lib.slice(lib.indexOf("export async function deleteTeamAccount"));
  assert.match(remove, /await requireRole\("admin"\)/);
  assert.match(remove, /userId === actor\.userId\) throw/);
  // The two references that cascade would take the team's work with the login.
  assert.match(lib, /\["collection_requests", "requested_by"\]/);
  assert.match(lib, /\["watch_items", "created_by"\]/);
  assert.match(remove, /counts\.some\(\(result\) => result\.count\)\) throw[\s\S]*?deleteUser/, "the check comes before the delete");
  assert.match(remove, /action: "user\.delete"/);
});
