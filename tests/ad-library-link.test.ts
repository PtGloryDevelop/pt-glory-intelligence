import assert from "node:assert/strict";
import test from "node:test";
import { adLibraryAdUrl } from "../lib/collect/url.ts";

test("an ad's Ad Library page is built from its numeric archive id", () => {
  assert.equal(adLibraryAdUrl("1109163008481911"), "https://www.facebook.com/ads/library/?id=1109163008481911");
});

test("anything but a numeric archive id gives no link", () => {
  for (const value of ["", "abc", "123&q=x", "12 34", "1".repeat(33)]) assert.equal(adLibraryAdUrl(value), null);
});
