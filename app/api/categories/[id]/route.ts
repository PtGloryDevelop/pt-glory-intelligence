import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor, satisfies, type Role } from "@/lib/auth/roles";
import { isUuid } from "@/lib/read/request";
import { categoryName } from "@/lib/categories/name";
import { deleteCategory, renameCategory } from "@/lib/categories/write";

export const runtime = "nodejs";

async function gate(required: Role) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!satisfies(actor.role, required)) {
    return NextResponse.json({ error: required === "admin" ? "ลบหมวดหมู่ได้เฉพาะ Admin" : "ต้องมีสิทธิ์ Analyst ขึ้นไป" }, { status: 403 });
  }
  return null;
}

/** Renames a category. Datasets keep pointing at the same id, so nothing else moves. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const refused = await gate("analyst");
    if (refused) return refused;
    if (!isUuid(id)) return badRequest("category id must be a UUID");
    const body = await request.json().catch(() => null);
    const name = categoryName(body?.name);
    if (!name.ok) return badRequest(name.reason);
    const result = await renameCategory(id, name.value);
    return result.ok ? NextResponse.json({ id }) : NextResponse.json({ error: result.message }, { status: result.status });
  });
}

/** Deletes an empty category (admin only, matching the 0016 delete policy). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readRoute(async () => {
    const refused = await gate("admin");
    if (refused) return refused;
    if (!isUuid(id)) return badRequest("category id must be a UUID");
    const result = await deleteCategory(id);
    return result.ok ? NextResponse.json({ id }) : NextResponse.json({ error: result.message }, { status: result.status });
  });
}
