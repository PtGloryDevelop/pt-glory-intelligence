import { NextResponse, type NextRequest } from "next/server";
import { updateCollectorSettings } from "@/lib/collect/admin";
import { AuthorizationError } from "@/lib/auth/role-model";
import { getActor } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * Collector settings. Admin only, allowlisted, and audited per key.
 *
 * Every budget, window and cap the collector obeys is configuration, not code,
 * and every change to it is recorded with the person who made it.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const result = await updateCollectorSettings(await getActor(), body);
    if (!result.ok) {
      return NextResponse.json({ error: "invalid_request", message: result.message }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("collector settings update failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}
