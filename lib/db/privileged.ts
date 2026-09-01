import "server-only";
import { Pool, type PoolClient } from "pg";

/**
 * Write path. A direct Postgres connection that BYPASSES RLS.
 *
 * Callers MUST have passed requireRole() before reaching this module. RLS is not
 * a safety net here — the Node-side check is the only authorization boundary.
 *
 * Never import this from a read path.
 */

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
    pool = new Pool({
      connectionString,
      // Supabase transaction-mode pooler does not support prepared statements.
      statement_timeout: 60_000,
      max: 4,
    });
  }
  return pool;
}

/**
 * Runs `fn` inside one real Postgres transaction.
 *
 * The whole point: a single client is checked out and used for BEGIN, every
 * statement, and COMMIT/ROLLBACK. Separate `pool.query()` calls can land on
 * different connections, which would leave BEGIN in one session and the writes
 * in another — ROLLBACK would then do nothing.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; releasing it below discards it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Test-only: closes the pool so the process can exit. */
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
