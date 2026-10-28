import assert from "node:assert/strict";
import test from "node:test";
import type { RivalBoard } from "../lib/rivals/board.ts";
import { stripPages, stripUrl } from "../lib/rivals/strips.ts";

const page = (page_id: string) => ({ page_id }) as RivalBoard["units"][number]["pages"][number];
const board = {
  units: [
    { id: "u1", name: "U1", keywords: [], hidden: 0, pages: [page("1"), page("2")] },
    { id: "u2", name: "U2", keywords: [], hidden: 0, pages: [page("2"), page("3")] },
  ],
  unitsWithoutKeywords: [{ id: "u9", name: "U9" }],
} as unknown as RivalBoard;

test("all units: every rival page once, in board order", () => {
  assert.equal(stripPages(board, ""), "1,2,3");
});

test("one unit: its pages only; a unit without keywords has none", () => {
  assert.equal(stripPages(board, "u2"), "2,3");
  assert.equal(stripPages(board, "u9"), "");
});

test("at most 60 pages, the catalog route's limit", () => {
  const many = { ...board, units: [{ ...board.units[0], pages: Array.from({ length: 70 }, (_, i) => page(String(i))) }] } as RivalBoard;
  assert.equal(stripPages(many, "").split(",").length, 60);
});

test("the strip URLs the page seeds are the ones the board asks for", () => {
  assert.equal(stripUrl("new", "1,2", 4), "/api/catalog/ads?pages=1,2&period=week&sort=new&limit=4");
  assert.equal(stripUrl("age", "1,2", 24), "/api/catalog/ads?pages=1,2&active=active&sort=age&limit=24");
});
