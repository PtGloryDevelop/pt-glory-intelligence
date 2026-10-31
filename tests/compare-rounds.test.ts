import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cleanNote, readAnswer, readNoteDraft } from "../lib/ai/rounds-shared.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("an answer keeps its text and only the ads that exist in the round", () => {
  assert.deepEqual(readAnswer({ answer: " ลองย้ายราคาขึ้นภาพปก ", ads: [0, 1, 1, 7, -1, 0.5, "1"] }, 2), { answer: "ลองย้ายราคาขึ้นภาพปก", ads: [0, 1] });
  assert.deepEqual(readAnswer({ answer: "ตอบ" }, 2), { answer: "ตอบ", ads: [] }, "citing no ad is allowed");
  assert.equal(readAnswer({ answer: "   ", ads: [0] }, 2), null, "an empty answer is no answer");
  assert.equal(readAnswer("ตอบ", 2), null);
  assert.equal(readAnswer({ answer: "ก".repeat(5000) }, 2)?.answer.length, 3000, "cut to what is kept");
});

test("a note draft needs a title and what was seen; at most four things to try", () => {
  assert.deepEqual(readNoteDraft({ title: "U18 vs Velxis", seen: "คู่แข่งใส่ราคาบนปก", next: ["ทำปกใหม่", "", 3, "ทดสอบพาดหัว", "a", "b", "c"] }),
    { title: "U18 vs Velxis", seen: "คู่แข่งใส่ราคาบนปก", next: ["ทำปกใหม่", "ทดสอบพาดหัว", "a", "b"] });
  assert.equal(readNoteDraft({ title: "x", next: [] }), null);
});

test("a saved note is checked field by field", () => {
  assert.deepEqual(cleanNote({ title: " รอบ 1 ", seen: "เห็น", next: [{ text: " ลอง ", done: true }, { text: "" }, { text: "อีก", done: "yes" }, null] }),
    { title: "รอบ 1", seen: "เห็น", next: [{ text: "ลอง", done: true }, { text: "อีก", done: false }] });
  assert.equal(cleanNote({ title: "", seen: "เห็น" }), null);
  assert.equal(cleanNote(null), null);
  assert.equal(cleanNote({ title: "t", seen: "s", next: Array.from({ length: 30 }, () => ({ text: "x" })) })?.next.length, 10);
});

test("the talk is held to the comparison's facts and the FDA rules", () => {
  const rounds = read("lib/ai/rounds.ts");
  for (const rule of ["ห้ามเดาหรืออ้างตัวเลขเหล่านี้ของคู่แข่ง", "ห้ามแต่งตัวเลขที่ไม่มีใน facts", "กฎ อย. เข้มที่สุด", "คุยได้เฉพาะแอดในรอบนี้"]) {
    assert.ok(read("lib/ai/round-prompts.ts").includes(rule), `the chat prompt says: ${rule}`);
  }
  // Every call spends within the shared caps, and is recorded with its cost.
  assert.match(rounds, /await withinBudget\(estimateUsd\(\.\.\.EST_ASK\)\)/);
  assert.match(rounds, /await withinBudget\(estimateUsd\(\.\.\.EST_NOTE\)\)/);
  assert.match(read("lib/ai/compare.ts"), /from\('compare_messages'\)\.select\('usd,created_at'\)/, "the talk counts toward the caps");
});

test("rounds are for analysts, and the tables are not public", () => {
  for (const path of ["app/api/compare/rounds/route.ts", "app/api/compare/rounds/[id]/route.ts", "app/api/compare/rounds/[id]/messages/route.ts", "app/api/compare/rounds/[id]/note/route.ts"]) {
    assert.match(read(path), /await requireRole\('analyst'\)/, path);
  }
  const up = read("supabase/migrations/0077_compare_rounds.sql");
  assert.match(up, /revoke all on table public\.compare_rounds, public\.compare_messages from public, anon/);
  assert.match(up, /current_user_role\(\) in \('analyst', 'admin'\)/);
  assert.doesNotMatch(up, /for delete/, "a round is kept: nobody deletes from the API");
  assert.match(read("supabase/migrations/0077_compare_rounds.down.sql"), /drop table if exists public\.compare_messages;\s*drop table if exists public\.compare_rounds;/);
});
