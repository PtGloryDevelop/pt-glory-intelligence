import assert from "node:assert/strict";
import test from "node:test";
import { ROLES, isRole, satisfies, AuthorizationError } from "../lib/auth/role-model.ts";

test("role list is exactly the three approved roles", () => {
  assert.deepEqual([...ROLES], ["viewer", "analyst", "admin"]);
});

test("isRole rejects anything outside the enum", () => {
  for (const role of ROLES) assert.equal(isRole(role), true);
  for (const value of ["superadmin", "", null, undefined, 1, {}]) {
    assert.equal(isRole(value), false);
  }
});

test("higher rank satisfies lower requirements", () => {
  assert.equal(satisfies("admin", "viewer"), true);
  assert.equal(satisfies("admin", "analyst"), true);
  assert.equal(satisfies("analyst", "analyst"), true);
  assert.equal(satisfies("analyst", "viewer"), true);
  assert.equal(satisfies("viewer", "viewer"), true);
});

test("lower rank never satisfies a higher requirement", () => {
  assert.equal(satisfies("viewer", "analyst"), false);
  assert.equal(satisfies("viewer", "admin"), false);
  assert.equal(satisfies("analyst", "admin"), false);
});

test("AuthorizationError carries the HTTP status", () => {
  assert.equal(new AuthorizationError(401, "x").status, 401);
  assert.equal(new AuthorizationError(403, "x").status, 403);
});
