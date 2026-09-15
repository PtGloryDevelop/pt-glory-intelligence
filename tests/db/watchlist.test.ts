import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, createAuthUser, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * Watchlist V1 (migration 0032).
 *
 * The cases that matter are the ones a person cannot check by looking: that a
 * watch belongs to exactly one user and the database enforces it, that a count
 * and its evidence are the same query, and that a state signal with no newer
 * observation reports "we have not looked" rather than "nothing changed".
 *
 * There is no evaluator to test, because there is none to write.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const DAY = 86_400_000;
const RUN_OLD = new Date(Date.now() - 40 * DAY).toISOString();
const RUN_NEW = new Date(Date.now() - 2 * DAY).toISOString();
const BASELINE = new Date(Date.now() - 20 * DAY).toISOString();

const PAGE = "980000000000001";

type AdSpec = {
  id: string; startDate: string; isActive: boolean | null;
  format: string | null; cta: string | null; collation?: number;
};

function runCanonical(collectedAt: string, ads: AdSpec[]): CanonicalImport {
  const canonical = singleAdCanonical({
    collectedAt, pageId: PAGE, adArchiveId: ads[0].id,
  });
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;
  canonical.pageObservations[0].pageName = "เพจติดตาม";

  canonical.ads = [];
  canonical.adObservations = [];
  for (const entry of ads) {
    canonical.ads.push({
      ...ad, adArchiveId: entry.id, startDate: entry.startDate, isActive: entry.isActive,
      displayFormat: entry.format, publisherPlatform: ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...observation, adArchiveId: entry.id, isActive: entry.isActive,
      displayFormat: entry.format, publisherPlatform: ["FACEBOOK"], ctaType: entry.cta,
      collationCount: entry.collation ?? 1,
      provenance: { ...observation.provenance, recordKey: `ad:${entry.id}` },
    });
  }

  const total = canonical.ads.length;
  canonical.run.reported = {
    ...canonical.run.reported, sourceRows: total, uniqueAds: total, uniquePages: 1,
  };
  canonical.run.computed = { sourceRows: total, uniqueAds: total, uniquePages: 1, unresolvedCount: 0 };
  return canonical;
}

/** Known before the baseline. */
const OLD_AD: AdSpec = {
  id: "980000000000101", startDate: "2021-01-01T00:00:00.000Z",
  isActive: true, format: "IMAGE", cta: "LEARN_MORE", collation: 1,
};
/** Appears in the later run, with a format and a CTA nothing carried before. */
const NEW_AD: AdSpec = {
  id: "980000000000102", startDate: new Date(Date.now() - 5 * DAY).toISOString(),
  isActive: true, format: "VIDEO", cta: "MESSAGE_PAGE", collation: 2,
};

test("watchlist v1", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);
  await client.query("delete from public.watch_items");

  const category = await seedCategory(client, "wl-main");
  const otherCategory = await seedCategory(client, "wl-other");

  // Before the baseline: one ad, active, IMAGE, LEARN_MORE.
  const firstRun = await commitImport({
    canonical: runCanonical(RUN_OLD, [OLD_AD]),
    categoryId: category, datasetName: "wl-old", actorId: null,
  });

  // After the baseline: the old ad has stopped and its collation moved, plus a
  // brand new ad carrying a format and CTA never seen in this scope.
  const secondRun = await commitImport({
    canonical: runCanonical(RUN_NEW, [
      { ...OLD_AD, isActive: false, collation: 5 }, NEW_AD,
    ]),
    categoryId: category, datasetName: "wl-new", actorId: null,
  });

  const users = (await client.query("select user_id from public.user_roles limit 2")).rows;
  const owner = users[0]?.user_id;
  assert.ok(owner, "the fixture needs at least one user with a role");

  const createWatch = async (overrides: Record<string, unknown> = {}) => {
    const values = {
      created_by: owner, target_type: "page", target_page_id: PAGE,
      scope_kind: "category", scope_category_id: category,
      tracked_signals: [
        "PAGE_NEWLY_FOUND_AD", "PAGE_STARTED_AD", "PAGE_STATUS_OBSERVED_CHANGE",
        "PAGE_NEW_FORMAT_OBSERVED", "PAGE_NEW_CTA_OBSERVED", "PAGE_REUSE_CHANGED",
      ],
      baseline_at: BASELINE,
      ...overrides,
    };
    const { rows } = await client.query(
      `insert into public.watch_items
         (created_by, target_type, target_page_id, target_category_id,
          scope_kind, scope_dataset_id, scope_category_id, tracked_signals, baseline_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [values.created_by, values.target_type, values.target_page_id ?? null,
       (values as Record<string, unknown>).target_category_id ?? null,
       values.scope_kind, (values as Record<string, unknown>).scope_dataset_id ?? null,
       values.scope_category_id ?? null, values.tracked_signals, values.baseline_at],
    );
    return rows[0].id as string;
  };

  const watchId = await createWatch();

  await t.test("the shape invariants are enforced by the database", async () => {
    // A page target may not also name a category.
    await assert.rejects(
      createWatch({ target_category_id: category }),
      /watch_target_shape/,
    );
    // A category target must scope itself to its own category.
    await assert.rejects(
      client.query(
        `insert into public.watch_items
           (created_by, target_type, target_category_id, scope_kind, scope_category_id, tracked_signals)
         values ($1,'category',$2,'category',$3,$4)`,
        [owner, category, otherCategory, ["CATEGORY_NEWLY_FOUND_AD"]],
      ),
      /watch_category_scope_matches_target/,
    );
    // A dataset scope must carry a dataset.
    await assert.rejects(
      createWatch({ scope_kind: "dataset", scope_category_id: null }),
      /watch_scope_shape/,
    );
    // An unknown signal never reaches a query.
    await assert.rejects(
      createWatch({ tracked_signals: ["PAGE_SPEND"], scope_category_id: otherCategory }),
      /tracked_signals/,
    );
    // A category signal on a page watch is refused too.
    await assert.rejects(
      createWatch({ tracked_signals: ["CATEGORY_NEWLY_FOUND_AD"], scope_category_id: otherCategory }),
      /watch_signals_match_target/,
    );
  });

  await t.test("the same target and scope cannot be watched twice", async () => {
    await assert.rejects(createWatch(), /watch_items_unique/);
    // A different scope is a different question, so it is allowed.
    const other = await createWatch({ scope_kind: "all", scope_category_id: null });
    assert.ok(other);
    await client.query("delete from public.watch_items where id = $1", [other]);
  });

  await t.test("an event signal counts what happened after the baseline", async () => {
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    );
    const value = (signal: string) => Number(rows.find((row) => row.signal === signal)!.value);

    // Only the newer ad was first seen after the baseline; the older one was
    // already known.
    assert.equal(value("PAGE_NEWLY_FOUND_AD"), 1);
    assert.equal(value("PAGE_STARTED_AD"), 1);
  });

  await t.test("a state signal compares two observations, not two moments", async () => {
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    );
    const row = (signal: string) => rows.find((entry) => entry.signal === signal)!;

    // The old ad was active at the baseline and stopped by the newer run.
    assert.equal(Number(row("PAGE_STATUS_OBSERVED_CHANGE").value), 1);
    // ...and its collation moved from 1 to 5.
    assert.equal(Number(row("PAGE_REUSE_CHANGED").value), 1);
    // Both rest on an ad we have actually looked at again.
    assert.ok(Number(row("PAGE_STATUS_OBSERVED_CHANGE").new_observations) > 0);
  });

  await t.test("a first-observed signal names the values as well as counting ads", async () => {
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    );
    const format = rows.find((row) => row.signal === "PAGE_NEW_FORMAT_OBSERVED")!;
    const cta = rows.find((row) => row.signal === "PAGE_NEW_CTA_OBSERVED")!;

    assert.deepEqual(format.new_values, ["VIDEO"]);
    assert.deepEqual(cta.new_values, ["MESSAGE_PAGE"]);
    // The count is ads, because that is what the evidence returns.
    assert.equal(Number(format.value), 1);
    assert.equal(Number(cta.value), 1);
  });

  await t.test("every signal count opens exactly its evidence", async () => {
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    );
    for (const row of rows) {
      const ads = await client.query(
        "select * from public.watchlist_signal_evidence($1, $2, 500, 0)",
        [watchId, row.signal],
      );
      assert.equal(
        ads.rows.length, Number(row.value),
        `${row.signal} claimed ${row.value} and returned ${ads.rows.length}`,
      );
    }
  });

  await t.test("with no collection since the baseline, states report no observation", async () => {
    // A baseline after the newest run: nothing has been collected since, so the
    // comparison has nothing to compare against.
    const future = await createWatch({
      scope_kind: "all", scope_category_id: null,
      baseline_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
    });
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [future],
    );
    for (const row of rows) {
      assert.equal(
        Number(row.new_observations), 0,
        `${row.signal}: nothing was collected after this baseline`,
      );
      // And the state signals must not claim a change from thin air.
      if (row.signal.includes("STATUS") || row.signal.includes("REUSE")) {
        assert.equal(Number(row.value), 0);
      }
    }
    await client.query("delete from public.watch_items where id = $1", [future]);
  });

  await t.test("moving the baseline changes what counts as new", async () => {
    const before = (await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    )).rows.find((row) => row.signal === "PAGE_NEWLY_FOUND_AD")!;
    assert.equal(Number(before.value), 1);

    const stored = (await client.query(
      "select baseline_at from public.watch_items where id = $1", [watchId],
    )).rows[0].baseline_at;

    await client.query("select public.watchlist_reset_baseline($1)", [watchId]);

    const moved = (await client.query(
      "select baseline_at from public.watch_items where id = $1", [watchId],
    )).rows[0].baseline_at;
    // Server time, and strictly later than what was stored.
    assert.ok(new Date(moved).getTime() > new Date(stored).getTime());

    const after = (await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    )).rows.find((row) => row.signal === "PAGE_NEWLY_FOUND_AD")!;
    // Everything is now before the baseline, so nothing is new.
    assert.equal(Number(after.value), 0);

    await client.query(
      "update public.watch_items set baseline_at = $2 where id = $1", [watchId, BASELINE],
    );
  });

  await t.test("editing the signals does not move the baseline", async () => {
    const before = (await client.query(
      "select baseline_at from public.watch_items where id = $1", [watchId],
    )).rows[0].baseline_at;

    await client.query(
      "update public.watch_items set tracked_signals = $2, updated_at = now() where id = $1",
      [watchId, ["PAGE_NEWLY_FOUND_AD"]],
    );

    const after = (await client.query(
      "select baseline_at from public.watch_items where id = $1", [watchId],
    )).rows[0].baseline_at;
    assert.equal(
      new Date(after).getTime(), new Date(before).getTime(),
      "changing what you track is not the same as saying you have seen everything",
    );
  });

  await t.test("a dataset scope stays a snapshot", async () => {
    const snapshot = await createWatch({
      scope_kind: "dataset", scope_dataset_id: firstRun.datasetId, scope_category_id: null,
      baseline_at: BASELINE,
    });
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [snapshot],
    );
    // The dataset holds one run, collected before the baseline. Nothing later
    // can be added to it, so no state has moved and no event falls after.
    for (const row of rows) {
      assert.equal(Number(row.new_observations), 0, `${row.signal}`);
    }
    const ads = await client.query(
      "select count(*)::int n from public.watch_scope_ads($1)", [snapshot],
    );
    // ...and it still knows exactly which ads it is about.
    assert.equal(ads.rows[0].n, 1);
    await client.query("delete from public.watch_items where id = $1", [snapshot]);
  });

  await t.test("a category watch counts the whole category, not one page", async () => {
    const categoryWatch = await createWatch({
      target_type: "category", target_page_id: null, target_category_id: category,
      tracked_signals: ["CATEGORY_NEWLY_FOUND_AD"],
    });
    const { rows } = await client.query(
      "select * from public.watchlist_signal_summary($1)", [categoryWatch],
    );
    // Only the category signal applies; the page signals are not answered with
    // a zero, which would read as "nothing happened".
    assert.deepEqual(rows.map((row) => row.signal), ["CATEGORY_NEWLY_FOUND_AD"]);
    assert.equal(Number(rows[0].value), 1);

    const evidence = await client.query(
      "select * from public.watchlist_signal_evidence($1, 'CATEGORY_NEWLY_FOUND_AD', 500, 0)",
      [categoryWatch],
    );
    assert.equal(evidence.rows.length, 1);
    await client.query("delete from public.watch_items where id = $1", [categoryWatch]);
  });

  await t.test("a watch reads the frozen scope primitive, not its own copy", async () => {
    const mine = await client.query(
      "select ad_ref from public.watch_scope_ads($1) order by ad_ref", [watchId],
    );
    const frozen = await client.query(
      `select s.ad_ref from public.page_scope_ads('category', $1) s
         join public.ads a on a.id = s.ad_ref
         join public.pages p on p.id = a.page_ref
        where p.page_id = $2 order by s.ad_ref`,
      [category, PAGE],
    );
    assert.deepEqual(mine.rows, frozen.rows);
  });

  await t.test("a soft-deleted dataset leaves the watch", async () => {
    const before = (await client.query(
      "select count(*)::int n from public.watch_scope_ads($1)", [watchId],
    )).rows[0].n;
    assert.equal(before, 2);

    await client.query(
      "update public.datasets set deleted_at = now() where collection_run_id = $1",
      [secondRun.collectionRunId],
    );

    const after = await client.query(
      "select count(*)::int n from public.watch_scope_ads($1)", [watchId],
    );
    // Only the ad the surviving dataset still holds remains: a watch shows the
    // scope as it stands, not as it stood when it was saved.
    assert.equal(after.rows[0].n, 1);

    const summary = await client.query(
      "select * from public.watchlist_signal_summary($1)", [watchId],
    );
    for (const row of summary.rows) {
      const ads = await client.query(
        "select * from public.watchlist_signal_evidence($1, $2, 500, 0)", [watchId, row.signal],
      );
      assert.equal(ads.rows.length, Number(row.value), `${row.signal} after soft delete`);
    }

    await client.query(
      "update public.datasets set deleted_at = null where collection_run_id = $1",
      [secondRun.collectionRunId],
    );
  });

  await t.test("one person's watchlist is invisible to another", async () => {
    // Impersonated the way PostgREST does it, so this exercises the same
    // auth.uid() path a real request takes rather than the policy text.
    const asUser = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
      await client.query("BEGIN");
      try {
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
        return await fn();
      } finally {
        await client.query("ROLLBACK");
      }
    };

    const seedUser = async (role: string) => {
      const userId = await createAuthUser(client, `wl-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);
      await client.query(
        "insert into public.user_roles (user_id, role) values ($1, $2)", [userId, role],
      );
      return userId;
    };

    const alice = await seedUser("viewer");
    const bob = await seedUser("analyst");
    const hers = await createWatch({
      created_by: alice, scope_kind: "all", scope_category_id: null,
    });

    // A viewer keeps their own list: a watchlist changes no canonical data, so
    // it is not gated on the analyst write rule the data tables use.
    await asUser(alice, async () => {
      const { rows } = await client.query("select id from public.watch_items");
      assert.deepEqual(rows.map((row) => row.id), [hers]);
      const created = await client.query(
        `insert into public.watch_items
           (created_by, target_type, target_page_id, scope_kind, scope_category_id, tracked_signals)
         values ($1,'page',$2,'category',$3,$4) returning id`,
        [alice, PAGE, category, ["PAGE_STARTED_AD"]],
      );
      assert.ok(created.rows[0].id);
    });

    await asUser(bob, async () => {
      // Not readable...
      const { rows } = await client.query("select id from public.watch_items");
      assert.deepEqual(rows, []);
      // ...and therefore not writable either: the update and the delete match
      // no row rather than being refused, which is the same protection.
      const updated = await client.query(
        "update public.watch_items set tracked_signals = $2 where id = $1 returning id",
        [hers, ["PAGE_STARTED_AD"]],
      );
      assert.equal(updated.rowCount, 0);
      const deleted = await client.query(
        "delete from public.watch_items where id = $1 returning id", [hers],
      );
      assert.equal(deleted.rowCount, 0);
      // Nor can the owner be forged on the way in.
      await client.query("savepoint forge");
      await assert.rejects(
        () => client.query(
          `insert into public.watch_items
             (created_by, target_type, target_page_id, scope_kind, scope_category_id, tracked_signals)
           values ($1,'page',$2,'category',$3,$4)`,
          [alice, PAGE, otherCategory, ["PAGE_STARTED_AD"]],
        ),
        /row-level security/,
      );
      await client.query("rollback to savepoint forge");
      // And Alice's watch resolves to nothing through the read functions.
      const summary = await client.query(
        "select * from public.watchlist_signal_summary($1)", [hers],
      );
      assert.equal(summary.rows.length, 0, "a function must not read past its caller's RLS");
    });

    // Still there after Bob's attempts.
    const survived = await client.query(
      "select count(*)::int n from public.watch_items where id = $1", [hers],
    );
    assert.equal(survived.rows[0].n, 1);
    await client.query("delete from public.watch_items where id = $1", [hers]);
  });

  await t.test("watch_items is owner-only, and the owner cannot be forged", async () => {
    const { rows: policies } = await client.query(
      `select cmd, qual is not null as has_using, with_check is not null as has_check
         from pg_policies where schemaname = 'public' and tablename = 'watch_items'
        order by cmd`,
    );
    assert.equal(policies.length, 4, "select, insert, update and delete are each policed");

    const { rows: rls } = await client.query(
      "select relrowsecurity from pg_class where oid = 'public.watch_items'::regclass",
    );
    assert.equal(rls[0].relrowsecurity, true);

    const { rows: definitions } = await client.query(
      `select cmd, coalesce(qual, '') || coalesce(with_check, '') as body
         from pg_policies where schemaname = 'public' and tablename = 'watch_items'`,
    );
    for (const policy of definitions) {
      assert.match(policy.body, /auth\.uid\(\)/, `${policy.cmd} must compare to the caller`);
    }

    // No anon or PUBLIC grant on the table itself.
    const { rows: grants } = await client.query(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'watch_items'`,
    );
    for (const grant of grants) {
      assert.notEqual(grant.grantee, "anon");
      assert.notEqual(grant.grantee, "PUBLIC");
    }
  });

  await t.test("the watchlist functions keep the read-layer contract", async () => {
    const names = [
      "watch_scope_ads", "watchlist_signal_summary",
      "watchlist_signal_evidence", "watchlist_list", "watchlist_reset_baseline",
    ];
    for (const name of names) {
      const { rows } = await client.query(
        `select p.prosecdef,
                has_function_privilege('anon', p.oid, 'execute')          as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      assert.equal(rows.length, 1, `${name} should exist exactly once`);
      assert.equal(rows[0].prosecdef, false, `${name} must stay SECURITY INVOKER`);
      assert.equal(rows[0].anon, false, `${name} must not be executable by anon`);
      assert.equal(rows[0].authenticated, true, `${name} must stay executable by authenticated`);
      assert.ok(
        (rows[0].proconfig ?? []).some((entry: string) => entry.startsWith("search_path=")),
        `${name} must pin its search_path`,
      );
    }
  });

  await client.query("delete from public.watch_items");
  await client.end();
  await closePool();
});
