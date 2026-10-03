import assert from "node:assert/strict";
import test from "node:test";
import { connect, createAuthUser } from "./helpers.ts";
import { parseOwnedAdImport } from "../../lib/owned-ads/import.ts";

test("owned reports enforce financial role, attribution and row integrity in PostgreSQL", {
  skip: process.env.DATABASE_URL ? false : "local DATABASE_URL required",
}, async () => {
  const client = await connect(); // Existing guard refuses every cloud database.
  await client.query("begin");
  try {
    const analyst = await createAuthUser(client, `owned-analyst-${Date.now()}@example.test`);
    const viewer = await createAuthUser(client, `owned-viewer-${Date.now()}@example.test`);
    await client.query("insert into public.user_roles(user_id, role) values ($1, 'analyst'), ($2, 'viewer')", [analyst, viewer]);
    const parsed = parseOwnedAdImport({ name: "test", account_name: "test", date_start: "2026-09-01", date_end: "2026-09-28", currency: "THB", csv: "ad_id,ad_name,campaign_name,spend\n123,test,test,100" });
    const rows = JSON.stringify(parsed.rows);
    const insert = "insert into public.owned_ad_reports(name,account_name,currency,date_start,date_end,created_by,rows) values ('test','test','THB','2026-09-01','2026-09-28',$1,$2::jsonb) returning id";
    async function as(userId: string) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    }
    await as(analyst);
    const id = (await client.query(insert, [analyst, rows])).rows[0].id;
    assert.equal((await client.query("select id from public.owned_ad_reports where id=$1", [id])).rowCount, 1);
    for (const invalid of [[{ ...parsed.rows[0], spend: -1 }], [parsed.rows[0], parsed.rows[0]], [{}]]) {
      await client.query("savepoint invalid_report");
      await assert.rejects(client.query(insert, [analyst, JSON.stringify(invalid)]), { code: "23514" });
      await client.query("rollback to savepoint invalid_report");
    }
    await as(viewer);
    assert.equal((await client.query("select id from public.owned_ad_reports where id=$1", [id])).rowCount, 0);
    await client.query("savepoint forbidden_report");
    await assert.rejects(client.query(insert, [viewer, rows]), { code: "42501" });
    await client.query("rollback to savepoint forbidden_report");
    await client.query("set local role anon");
    await assert.rejects(client.query("select * from public.owned_ad_reports"), { code: "42501" });
  } finally { await client.query("rollback"); await client.end(); }
});
