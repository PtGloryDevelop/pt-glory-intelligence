import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { badRequest, readRoute } from "@/lib/read/guard";
import { getActor, satisfies } from "@/lib/auth/roles";
import { categoryName } from "@/lib/categories/name";
import { createCategory } from "@/lib/categories/write";

export const runtime = "nodejs";

/** Creates a research category. The insert policy (analyst/admin) is the real gate. */
export async function POST(request: NextRequest) {
  return readRoute(async () => {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!satisfies(actor.role, "analyst")) return NextResponse.json({ error: "ต้องมีสิทธิ์ Analyst ขึ้นไป" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const name = categoryName(body?.name);
    if (!name.ok) return badRequest(name.reason);

    const created = await createCategory(name.value, actor.userId);
    if (!created.ok) return NextResponse.json({ error: created.message }, { status: created.status });
    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}
