import { connect, resetTables } from "../tests/db/helpers.ts";
import { assertDestructiveAllowed } from "../scripts/destructive-guard.mjs";
import { CATEGORY } from "./constants.ts";

/**
 * Clears every imported row and re-seeds the one category the journey uses.
 *
 * Spec files share one database, and Playwright orders them by filename, so a
 * test that asserts "no datasets yet" or "this ad has exactly two observations"
 * is only true if it starts from a known floor. User roles are left alone —
 * the signed-in sessions from global setup must survive.
 */
export async function resetData(): Promise<void> {
  // Refuse before opening a connection, so a misconfigured run never even
  // authenticates against the wrong database.
  assertDestructiveAllowed(process.env.DATABASE_URL, "journey data reset");
  const client = await connect();
  try {
    await resetTables(client);
    await client.query("insert into public.categories (name) values ($1)", [CATEGORY]);
  } finally {
    await client.end();
  }
}
