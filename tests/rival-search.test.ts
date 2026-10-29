import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pickRivalsHref } from "../lib/collect/url.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("a finished round opens ส่องแอด on its own words, quotes taken off", () => {
  assert.equal(pickRivalsHref('"Velxis"'), "/competitors?view=all&search=Velxis");
  assert.equal(pickRivalsHref("ชาแม่จิรา"), `/competitors?view=all&search=${encodeURIComponent("ชาแม่จิรา")}`);
  assert.equal(pickRivalsHref("natto prime"), "/competitors?view=all&search=natto+prime");
});

test("words that cannot be a ส่องแอด search give no link", () => {
  assert.equal(pickRivalsHref(null), null);
  assert.equal(pickRivalsHref('"x"'), null);
  assert.equal(pickRivalsHref("ก".repeat(61)), null);
});

test("a page the team decided on stays on the board without a keyword match", () => {
  const board = read("lib/rivals/board.ts");
  // Decided pages missing from the keyword matches are read by id, and a unit with only decisions is listed.
  assert.match(board, /rpc\('rival_pages_by_id'/);
  assert.match(board, /if\(!byUnit\.has\(row\.unit_id\)\)byUnit\.set/);
  // A missing function degrades to the keyword-only board instead of failing it.
  assert.doesNotMatch(board, /throw new Error\('Rival pages unavailable'\)/);
});

test("the search's pages are for analysts and the function is not public", () => {
  assert.match(read("app/api/rivals/search/route.ts"), /requireRole\('analyst'\)/);
  const up = read("supabase/migrations/0076_rival_pages_by_id.sql");
  assert.match(up, /revoke all on function public\.rival_pages_by_id\(text\[\]\) from public, anon/);
  assert.match(up, /grant execute on function public\.rival_pages_by_id\(text\[\]\) to authenticated/);
  assert.doesNotMatch(up, /security definer/i, "runs as the caller, under RLS");
  assert.match(read("supabase/migrations/0076_rival_pages_by_id.down.sql"), /drop function if exists public\.rival_pages_by_id/);
});

test("the board no longer offers a page-tracking button nothing reads", () => {
  const ui = read("app/(app)/competitors/rival-board.tsx");
  assert.doesNotMatch(ui, /action:'track'/);
  assert.doesNotMatch(ui, /ระบบเก็บแอดใหม่อยู่/);
  // Pages set aside can be taken back from the board.
  assert.match(ui, /hiddenPages\.map/);
});
