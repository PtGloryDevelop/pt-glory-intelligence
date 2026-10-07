import { dbUser } from "../db/user.ts";

/**
 * Create, rename and delete research categories.
 *
 * Writes go through the user's own client, so the 0016 policies decide who may
 * do what: analyst/admin insert and update, admin alone deletes.
 *
 * Delete is a hard delete and only succeeds on an empty category. Datasets and
 * collection requests reference it without a cascade, so Postgres refuses
 * (23503) rather than leave datasets pointing at nothing.
 * Watch items reference it ON DELETE CASCADE (0032) and are per-user under RLS, so the
 * admin cannot see them first; the confirm dialog says they go too.
 */

export type CategoryWrite = { ok: true; id: string } | { ok: false; status: number; message: string };

const denied = (code?: string) => code === "42501";
// ponytail: a soft-deleted row still owns its unique name; restoring it is out of scope.
const duplicate = { ok: false, status: 409, message: "มีหมวดหมู่ชื่อนี้อยู่แล้ว (รวมหมวดที่เคยถูกซ่อน)" } as const;

export async function createCategory(name: string, actorId: string): Promise<CategoryWrite> {
  const supabase = await dbUser();
  const { data, error } = await supabase.from("categories").insert({ name, created_by: actorId }).select("id").single();
  if (error) {
    if (denied(error.code)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    if (error.code === "23505") return duplicate;
    return { ok: false, status: 400, message: "สร้างหมวดหมู่ไม่สำเร็จ" };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function renameCategory(id: string, name: string): Promise<CategoryWrite> {
  const supabase = await dbUser();
  const { data, error } = await supabase.from("categories").update({ name }).eq("id", id).select("id");
  if (error) {
    if (denied(error.code)) return { ok: false, status: 403, message: "ต้องมีสิทธิ์ Analyst ขึ้นไป" };
    if (error.code === "23505") return duplicate;
    return { ok: false, status: 400, message: "แก้ชื่อหมวดหมู่ไม่สำเร็จ" };
  }
  // RLS hides rows the caller may not update; zero rows is "not yours / not there".
  if (!data?.length) return { ok: false, status: 404, message: "ไม่พบหมวดหมู่นี้ หรือไม่มีสิทธิ์แก้" };
  return { ok: true, id };
}

export async function deleteCategory(id: string): Promise<CategoryWrite> {
  const supabase = await dbUser();
  const { data, error } = await supabase.from("categories").delete().eq("id", id).select("id");
  if (error) {
    if (denied(error.code)) return { ok: false, status: 403, message: "ลบหมวดหมู่ได้เฉพาะ Admin" };
    if (error.code === "23503") return { ok: false, status: 409, message: "ลบไม่ได้ เพราะยังมี Dataset หรือคำขอเก็บข้อมูลอยู่ในหมวดนี้" };
    return { ok: false, status: 400, message: "ลบหมวดหมู่ไม่สำเร็จ" };
  }
  if (!data?.length) return { ok: false, status: 404, message: "ไม่พบหมวดหมู่นี้ หรือลบได้เฉพาะ Admin" };
  return { ok: true, id };
}
