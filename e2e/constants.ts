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
export const PASSWORD = "e2e-journey-pw-2026";
export const ACCOUNTS = { analyst: "e2e-analyst@example.test", viewer: "e2e-viewer@example.test" };
