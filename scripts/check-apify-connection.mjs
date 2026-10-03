import pg from "pg";

// Never starts an Actor. --configure saves only the user-selected Actor/build, with an audit.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  const { rows } = await pool.query("select key, value from public.app_settings where key in ('collector.actor', 'collector.actor_build', 'collector.enabled')");
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const actor = process.argv[2] ?? settings.get("collector.actor");
  const build = settings.get("collector.actor_build");
  if (!process.env.APIFY_TOKEN) throw new Error("Apify token is missing");
  const actorConfigured = typeof actor === "string" && /^[\w.-]+~[\w.-]+$/.test(actor);
  const path = actorConfigured ? `acts/${encodeURIComponent(actor)}` : "users/me";
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Apify metadata check returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.data?.id) throw new Error("Apify did not return Actor metadata");
  if (process.argv.includes("--configure")) {
    const version = payload.data.taggedBuilds?.latest?.buildNumber;
    if (!actorConfigured || typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error("Apify Actor has no version that can be pinned");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of [["collector.actor", actor], ["collector.actor_build", version]]) {
        const { rows: existing } = await client.query("select value from public.app_settings where key = $1 for update", [key]);
        const before = existing[0]?.value ?? null;
        if (before === value) continue;
        await client.query("insert into public.app_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
        await client.query("insert into public.audit_logs (actor, action, entity_type, before, after) values (null, 'collector.settings_updated', 'app_setting', $1::jsonb, $2::jsonb)", [JSON.stringify({ key, value: before }), JSON.stringify({ key, value, source: "user_requested_codex_configuration" })]);
      }
      await client.query("COMMIT");
      console.log("User-selected Apify Actor and build configured; paid collection enablement and budgets unchanged");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  console.log({ tokenValid: true, actorAccessible: actorConfigured, latestBuild: payload.data.taggedBuilds?.latest?.buildNumber ?? null, collectorEnabled: settings.get("collector.enabled") === true, buildPinned: typeof build === "string" && build.length > 0, paidRunStarted: false });
} catch (error) {
  // Connection errors can contain credential-bearing URLs; never print them.
  console.error(error.message?.startsWith("Apify") ? error.message : "Read-only connection check failed (database or network)");
  process.exitCode = 1;
} finally {
  await pool.end();
}
