/** Category name rule, shared by the form and the API. Pure, so it is testable and client-safe. */
export const MAX_CATEGORY_NAME = 120;

export function categoryName(raw: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "ต้องระบุชื่อหมวดหมู่" };
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length > MAX_CATEGORY_NAME) return { ok: false, reason: `ชื่อหมวดหมู่ยาวเกิน ${MAX_CATEGORY_NAME} ตัวอักษร` };
  return { ok: true, value };
}
