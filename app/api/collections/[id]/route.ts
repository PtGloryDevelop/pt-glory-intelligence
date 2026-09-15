import { after, NextResponse } from "next/server";
import { readCollection } from "@/lib/collect/read";
import { advance } from "@/lib/collect/machine";
import { providerFromSettings } from "@/lib/collect/provider-factory";
import { AuthorizationError } from "@/lib/auth/role-model";
import { requireRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * One collection, as the person who asked for it sees it.
 *
 * The progress page polls this. Each poll may nudge the work along by one
 * bounded step, which is what makes a page that is open feel alive without a
 * second orchestration path — but a nudge can never start a run: `queued` is
 * excluded, and the machine's own start marker is committed before any provider
 * call regardless.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { id } = await context.params;
  let dto;
  try {
    dto = await readCollection(id);
  } catch (error) {
    console.error("collection read failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
  // Not visible and not existing are the same answer: a person learns nothing
  // about somebody else's collection by asking for its id.
  if (!dto) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Poll-only, structurally: the nudge claims with `allowStart: false`, so the
  // claim's own SQL cannot select a queued request — the one state whose
  // transition performs the paid start. Nothing here reads a status and decides
  // afterwards, because that gap is exactly where a race would start a run.
  after(() => nudge(id));
  return NextResponse.json(dto);
}

async function nudge(requestId: string): Promise<void> {
  try {
    const provider = await providerFromSettings();
    if (!provider) return;
    await advance(requestId, { provider, allowStart: false });
  } catch (error) {
    console.error("collection nudge failed", { requestId, error: error instanceof Error ? error.name : "unknown" });
  }
}
