import { join } from "node:path";

export const TMP = join("e2e", ".tmp");
export const AUTH = join("e2e", ".auth");
export const CATEGORY = "อาหารเสริม (E2E)";
/** A second research category, owned by the category-workspace spec alone. */
export const CATEGORY_WORKSPACE = "คลินิกความงาม (E2E)";
/** A third category, owned by the compare spec alone. */
export const CATEGORY_COMPARE = "อาหารคลีน (E2E)";
/** A fourth category, owned by the trends spec alone. */
export const CATEGORY_TRENDS = "ครีมกันแดด (E2E)";
/** A fifth category, owned by the watchlist spec alone. */
export const CATEGORY_WATCH = "วิตามินผิว (E2E)";
/** A sixth category, owned by the brand-mapping spec alone. */
export const CATEGORY_BRAND = "กาแฟลดน้ำหนัก (E2E)";
/**
 * The three signed-in roles the suite exercises.
 *
 * Admin joined in C14, when manual import became recovery infrastructure: the
 * specs that import a fixture through the UI now do that one step as an admin,
 * and keep their analyst and viewer sessions for everything they are actually
 * asserting about those roles.
 */
export const ACCOUNTS = {
  analyst: "e2e-analyst@example.test",
  viewer: "e2e-viewer@example.test",
  admin: "e2e-admin@example.test",
};
