import { NextResponse } from "next/server";
import { readDiagnostics } from "@/lib/collect/admin";
import { AuthorizationError } from "@/lib/auth/role-model";
import { getActor } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * Everything the normal DTO leaves out, for the person who has to act on it.
 *
 * Admin only, checked in the service itself so the boundary does not depend on
 * this file being written correctly.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const diagnostics = await readDiagnostics(await getActor(), id);
    if (!diagnostics) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(diagnostics);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("collection diagnostics failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}
