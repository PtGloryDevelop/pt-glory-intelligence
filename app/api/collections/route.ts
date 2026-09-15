import { after, NextResponse, type NextRequest } from "next/server";
import { admitCollection } from "@/lib/collect/admission";
import { malformedBody, parseStartInput, refusalResponse } from "@/lib/collect/dto";
import { listCollections, readCollection } from "@/lib/collect/read";
import { advance } from "@/lib/collect/machine";
import { providerFromSettings } from "@/lib/collect/provider-factory";
import { AuthorizationError } from "@/lib/auth/role-model";
import { requireRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * The one way a person asks for a collection.
 *
 * It ends at admission. Admission — under its advisory lock — is what checks the
 * settings, the category, the country, the record cap, the concurrency limit and
 * the budget, and what reserves the ceiling; this route neither repeats that
 * arithmetic nor writes a request row of its own.
 *
 * The response does not wait for the provider. The first advance runs after the
 * response through `after()`, exactly once, and everything from there belongs to
 * the background progression (C12).
 */
export async function POST(request: NextRequest) {
  let actor;
  try {
    // Analyst or above. A viewer may read the product; they may not spend money.
    actor = await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  const input = parseStartInput(body);
  if (!input.ok) {
    // Not a collection request at all: nothing was judged and nothing locked.
    // Every decision admission makes is a 409 by reason instead.
    const malformed = malformedBody(input.message);
    return NextResponse.json(
      { error: malformed.code, message: malformed.message, detail: malformed.detail },
      { status: malformed.status },
    );
  }

  let admitted;
  try {
    admitted = await admitCollection({ ...input.value, requestedBy: actor.userId });
  } catch (error) {
    console.error("collection admission failed", error);
    return NextResponse.json({ error: "unavailable", message: "ไม่สามารถเริ่มเก็บข้อมูลได้ในขณะนี้" }, { status: 503 });
  }

  if (!admitted.ok) {
    const refusal = refusalResponse(admitted.refusal);
    // admitted.detail is server-side reasoning and stays in the log.
    console.info("collection refused", { refusal: admitted.refusal, detail: admitted.detail });
    return NextResponse.json({ error: refusal.code, message: refusal.message }, { status: refusal.status });
  }

  const dto = await readCollection(admitted.requestId);
  if (!dto) {
    return NextResponse.json({ error: "unavailable", message: "ไม่สามารถอ่านสถานะคำขอได้" }, { status: 503 });
  }

  // One bounded step, after the answer. A new request starts its run here; a
  // reused one is already past that point and the machine's own claim decides.
  if (!admitted.reused) after(() => firstAdvance(admitted.requestId));

  // A repeat of the same submission is the same collection, not a new one.
  return NextResponse.json(dto, { status: admitted.reused ? 200 : 201 });
}

/** The caller's own collections. RLS decides which rows exist for them. */
export async function GET() {
  try {
    await requireRole("analyst");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  try {
    return NextResponse.json({ collections: await listCollections() });
  } catch (error) {
    console.error("collection list failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}

/**
 * The first advance, outside the response.
 *
 * Configuration problems are logged, never raised at the person who asked: the
 * request is already admitted and the scheduler will pick it up regardless.
 */
async function firstAdvance(requestId: string): Promise<void> {
  try {
    const provider = await providerFromSettings();
    if (!provider) {
      console.error("first advance skipped: the collector is not configured");
      return;
    }
    await advance(requestId, { provider });
  } catch (error) {
    // The scheduler owns every retry. A failure here is never the user's problem.
    console.error("first advance failed", { requestId, error: error instanceof Error ? error.name : "unknown" });
  }
}
