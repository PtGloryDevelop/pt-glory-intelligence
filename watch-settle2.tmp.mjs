import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const stamp = () => new Date().toISOString().slice(11, 19);
const deadline = Date.now() + 55 * 60 * 1000;
let last = null;
while (Date.now() < deadline) {
  const { rows } = await c.query(
    "select archive_status, count(*)::int n from public.media_assets group by 1");
  const m = Object.fromEntries(rows.map((r) => [r.archive_status, r.n]));
  const key = JSON.stringify(m);
  if (key !== last) { console.log(`${stamp()} ${key}`); last = key; }
  if ((m.pending ?? 0) === 0) { console.log(`${stamp()} SETTLED`); break; }
  await new Promise((r) => setTimeout(r, 30000));
}
await c.end();
