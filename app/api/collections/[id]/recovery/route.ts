import { NextResponse, type NextRequest } from "next/server";
import {
  failCollection, reconcileOriginalStart, releaseUnresolvedReservation, retryCostReconciliation,
  retrySettlement, type Admin,
} from "@/lib/collect/recovery";
import { providerFromSettings } from "@/lib/collect/provider-factory";
import { AuthorizationError } from "@/lib/auth/role-model";
import { requireRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * The admin recovery actions (C11), over HTTP.
 *
 * The route chooses which frozen action to call and nothing else: eligibility,
 * the audit row and the refusal all belong to the recovery module. Reconciling
 * an original start is the only action that reads a provider, and reading is
 * all it can do — none of these can start a run.
 */
const ACTIONS = [
  "retry_settlement", "fail_collection", "reconcile_original_start",
  "retry_cost_reconciliation", "release_unresolved_reservation",
] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let admin: Admin;
  try {
    const actor = await requireRole("admin");
    admin = { id: actor.userId, role: actor.role };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: unknown; reason?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "invalid_request", message: "unknown recovery action" }, { status: 400 });
  }
  const reason = typeof body?.reason === "string" ? body.reason : "";

  try {
    const result = await run(action as Action, id, admin, reason);
    if (result.ok) return NextResponse.json(result);
    return NextResponse.json(
      { error: result.reason, message: result.detail },
      { status: result.reason === "reason_required" ? 400 : 409 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("collection recovery failed", { id, action });
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}

async function run(action: Action, id: string, admin: Admin, reason: string) {
  switch (action) {
    case "retry_settlement": return retrySettlement(id, admin);
    case "fail_collection": return failCollection(id, admin, reason);
    case "retry_cost_reconciliation": return retryCostReconciliation(id, admin);
    case "release_unresolved_reservation": return releaseUnresolvedReservation(id, admin, reason);
    case "reconcile_original_start": {
      const provider = await providerFromSettings();
      if (!provider) {
        return { ok: false as const, reason: "not_eligible" as const, detail: "the collector is not configured" };
      }
      return reconcileOriginalStart(id, admin, provider);
    }
  }
}
