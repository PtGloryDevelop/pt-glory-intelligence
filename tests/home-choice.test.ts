import test from "node:test";
import assert from "node:assert/strict";
import { HOME_COOKIE, homeCookie, parseHomeChoice } from "../lib/home-choice.ts";

test("home choice accepts only the two known pages and defaults to the overview", () => {
  assert.equal(parseHomeChoice("library"), "library");
  assert.equal(parseHomeChoice("overview"), "overview");
  for (const value of [undefined, "", "LIBRARY", "admin", "/owned-ads", "library;x=1"]) assert.equal(parseHomeChoice(value), "overview");
});

test("the cookie lasts a year for the whole site and is not cross-site", () => {
  assert.equal(HOME_COOKIE, "pg_home");
  assert.equal(homeCookie("library"), "pg_home=library; Path=/; Max-Age=31536000; SameSite=Lax");
});
