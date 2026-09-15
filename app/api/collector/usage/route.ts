import { NextResponse } from "next/server";
import { readCollectorUsage } from "@/lib/collect/admin";
import { AuthorizationError } from "@/lib/auth/role-model";
import { getActor } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * What the collector has committed this billing window. Admin only.
 *
 * Held amounts are reservations and are reported as such; `containsProvisional`
 * says plainly when a figure rests on a provider number that has not settled.
 * Nothing here is described as spend.
 */
export async function GET() {
  try {
    return NextResponse.json(await readCollectorUsage(await getActor()));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("collector usage failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}
