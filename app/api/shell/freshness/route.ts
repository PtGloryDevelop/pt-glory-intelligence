import { NextResponse } from "next/server";
import { AuthorizationError, requireRole } from "@/lib/auth/roles";
import { getFreshness } from "@/lib/shell/freshness";

/** The shell's data chips, re-read on navigation (a layout is not re-rendered on client navigation). */
export async function GET() {
  try {
    const actor = await requireRole("viewer");
    return NextResponse.json(await getFreshness(actor.role), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
