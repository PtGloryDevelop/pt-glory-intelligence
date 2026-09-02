import { NextResponse } from "next/server";
import { AuthorizationError } from "../auth/role-model.ts";
import { requireRole } from "../auth/roles.ts";

/**
 * One shape for every read route: authorize first, then run, and never let a
 * database error reach the client.
 *
 * RLS already stops a signed-out caller from seeing rows, but that produces a
 * 404 for what is really a 401 and does the work first. Checking the role up
 * front makes the boundary explicit and cheap.
 */
export async function readRoute<T>(
  run: () => Promise<T | NextResponse>,
): Promise<NextResponse> {
  try {
    await requireRole("viewer");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const result = await run();
    return result instanceof NextResponse ? result : NextResponse.json(result);
  } catch (error) {
    // Postgres and PostgREST errors name types, columns and sometimes the
    // connection. The caller gets a status; the detail stays in the server log.
    console.error("read route failed", error);
    return NextResponse.json({ error: "request failed" }, { status: 500 });
  }
}

export const badRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

export const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
