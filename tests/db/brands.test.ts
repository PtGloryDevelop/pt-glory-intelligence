import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * Brand mapping (migration 0033).
 *
 * The cases that matter are about time and about who is allowed to decide. A
 * mapping is an interval, so the tests move a Page and then ask what was true
 * before the move — the answer has to be the old Brand, or every future
 * Brand-level number will quietly rewrite history.
 *
 * Nothing here tests a suggestion, because nothing suggests anything.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const PAGE_A = "770000000000001";
const PAGE_B = "770000000000002";

test("brand mapping", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);
  await client.query("delete from public.brand_page_mappings");
  await client.query("delete from public.brands");

  const category = await seedCategory(client, "brand-map");
  for (const [page, ad] of [[PAGE_A, "770000000000101"], [PAGE_B, "770000000000102"]] as const) {
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        pageId: page, adArchiveId: ad,
      }),
      categoryId: category, datasetName: `brand-${page}`, actorId: null,
    });
  }

  const roleOf = async (role: string) => {
    const { rows } = await client.query(
      "select user_id from public.user_roles where role = $1 limit 1", [role],
    );
    if (rows[0]) return rows[0].user_id as string;
    const created = await client.query(
      "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
      [`brand-${role}-${Date.now()}@example.test`],
    );
    await client.query(
      "insert into public.user_roles (user_id, role) values ($1, $2)", [created.rows[0].id, role],
    );
    return created.rows[0].id as string;
  };
  const analyst = await roleOf("analyst");
  const viewer = await roleOf("viewer");
  const admin = await roleOf("admin");

  /** Runs as a real signed-in caller: role switch plus the JWT claim PostgREST sets. */
  async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query("BEGIN");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      const value = await fn();
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  async function refused(userId: string, sql: string, params: unknown[], pattern: RegExp) {
    await client.query("BEGIN");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await assert.rejects(() => client.query(sql, params), pattern);
    } finally {
      await client.query("ROLLBACK");
    }
  }

  /**
   * A privileged statement expected to be refused.
   *
   * A failed statement poisons its transaction, so the attempt is wrapped in one
   * of its own rather than left to break whatever runs next.
   */
  async function rejects(sql: string, params: unknown[], pattern: RegExp) {
    await client.query("BEGIN");
    try {
      await assert.rejects(() => client.query(sql, params), pattern);
    } finally {
      await client.query("ROLLBACK");
    }
  }

  const brandA = (await client.query(
    "insert into public.brands (name) values ('Glory  Thailand') returning id",
  )).rows[0].id as string;
  const brandB = (await client.query(
    "insert into public.brands (name) values ('Second Brand') returning id",
  )).rows[0].id as string;
  const archived = (await client.query(
    "insert into public.brands (name, status) values ('Retired Brand', 'archived') returning id",
  )).rows[0].id as string;

  await t.test("a brand name is unique in its normalized form, and only there", async () => {
    await rejects(
      "insert into public.brands (name) values ('  glory   THAILAND ')", [],
      /brands_normalized_name_unique/,
    );

    // Anything less than an equal normalized name is a different Brand, and the
    // database says nothing about whether they are the same company.
    const near = await client.query(
      "insert into public.brands (name) values ('Glory Thailand Co') returning id",
    );
    assert.ok(near.rows[0].id);
    await client.query("delete from public.brands where id = $1", [near.rows[0].id]);
  });

  await t.test("only an analyst or admin may decide a mapping", async () => {
    await refused(
      viewer, "select public.brand_map_page($1, $2, null, 'viewer')", [brandA, PAGE_A],
      /analyst/,
    );
    // ...and not by writing the table directly either.
    await refused(
      viewer,
      "insert into public.brand_page_mappings (brand_id, page_id) values ($1, $2)",
      [brandA, PAGE_A],
      /row-level security/,
    );
    // A viewer still reads the grouping.
    await as(viewer, async () => {
      const { rows } = await client.query("select count(*)::int n from public.brands");
      assert.ok(rows[0].n >= 3);
    });
    // An admin may decide too.
    await as(admin, async () => {
      const { rows } = await client.query(
        "select public.brand_map_page($1,$2,'admin can',$3) id", [brandA, PAGE_B, "admin@x"],
      );
      assert.ok(rows[0].id);
    });
  });

  await t.test("anon holds nothing", async () => {
    // Two independent refusals: the grant stops anon before RLS is even asked,
    // on the table and on the read function alike.
    for (const sql of [
      "select count(*) from public.brands",
      "select * from public.brand_list(null,'all',10,0)",
      "select * from public.unmapped_pages('all',null,null,'observed_ads',10,0)",
    ]) {
      await client.query("BEGIN");
      try {
        await client.query("set local role anon");
        await assert.rejects(() => client.query(sql), /permission denied/);
      } finally {
        await client.query("ROLLBACK");
      }
    }
  });

  await t.test("one brand holds many pages; one page holds one brand", async () => {
    await as(analyst, async () => {
      await client.query("select public.brand_map_page($1,$2,'first',$3)", [brandA, PAGE_A, "a@x"]);
    });

    const active = await client.query(
      `select count(*)::int n from public.brand_mapping_at(now()) where brand_id = $1`, [brandA],
    );
    assert.equal(active.rows[0].n, 2, "brand A holds both pages");

    const perPage = await client.query(
      `select page_id, count(*)::int n from public.brand_mapping_at(now())
        group by page_id having count(*) > 1`,
    );
    assert.equal(perPage.rows.length, 0, "no page has two brands at one instant");
  });

  await t.test("a second active mapping cannot be inserted at all", async () => {
    // Not "the application avoids it" — the database refuses it.
    await rejects(
      "insert into public.brand_page_mappings (brand_id, page_id) values ($1, $2)",
      [brandB, PAGE_A],
      /brand_page_mappings_no_overlap/,
    );

    // Nor may an interval end before it began.
    await rejects(
      `insert into public.brand_page_mappings (brand_id, page_id, valid_from, valid_to)
       values ($1, $2, now(), now() - interval '1 day')`,
      [brandB, PAGE_B],
      /brand_mapping_period/,
    );
  });

  await t.test("a move is atomic, and leaves the old decision on the record", async () => {
    // The database's clock, not this machine's: the two are not the same, and a
    // few milliseconds of skew would make this assert the opposite of the point.
    const before = (await client.query("select clock_timestamp() as t")).rows[0].t as Date;
    await new Promise((resolve) => setTimeout(resolve, 20));

    await as(analyst, async () => {
      await client.query("select public.brand_map_page($1,$2,'moved to B',$3)", [brandB, PAGE_A, "a@x"]);
    });

    const now = await client.query(
      "select brand_id from public.brand_mapping_at(now()) where page_id = $1", [PAGE_A],
    );
    assert.equal(now.rows.length, 1);
    assert.equal(now.rows[0].brand_id, brandB);

    // THE point of the temporal model: before the move, the Page was in A, and
    // it still is when you ask about then.
    const then = await client.query(
      "select brand_id from public.brand_mapping_at($1) where page_id = $2",
      [before.toISOString(), PAGE_A],
    );
    assert.equal(then.rows.length, 1);
    assert.equal(then.rows[0].brand_id, brandA, "history must not follow the page to its new brand");

    const history = await client.query(
      "select brand_id, is_current, note from public.brand_mapping_history(null,$1,100)", [PAGE_A],
    );
    assert.equal(history.rows.length, 2);
    assert.equal(history.rows[0].is_current, true);
    assert.equal(history.rows[0].brand_id, brandB);
    assert.equal(history.rows[1].brand_id, brandA);
    assert.equal(history.rows[1].note, "first", "the closed decision keeps its reason");
  });

  await t.test("mapping a page to the brand it is already in changes nothing", async () => {
    const before = await client.query(
      "select id, valid_from from public.brand_page_mappings where page_id = $1 and valid_to is null",
      [PAGE_A],
    );
    await as(analyst, async () => {
      await client.query("select public.brand_map_page($1,$2,null,$3)", [brandB, PAGE_A, "a@x"]);
    });
    const after = await client.query(
      "select id, valid_from from public.brand_page_mappings where page_id = $1 and valid_to is null",
      [PAGE_A],
    );
    // A no-op, not a new row: re-recording the same decision would put a false
    // date on it and add a mapping nobody made.
    assert.equal(after.rows[0].id, before.rows[0].id);
    assert.equal(
      new Date(after.rows[0].valid_from).getTime(),
      new Date(before.rows[0].valid_from).getTime(),
    );
  });

  await t.test("an archived brand keeps its history and takes no new pages", async () => {
    await refused(
      analyst, "select public.brand_map_page($1,$2,null,'a')", [archived, PAGE_A],
      /archived/,
    );

    // Archiving a brand that holds pages does not detach them...
    await client.query("update public.brands set status = 'archived' where id = $1", [brandA]);
    const held = await client.query(
      "select count(*)::int n from public.brand_mapping_at(now()) where brand_id = $1", [brandA],
    );
    assert.equal(held.rows[0].n, 1, "PAGE_B stays where it was");
    // ...but nothing new may join it.
    await refused(
      analyst, "select public.brand_map_page($1,$2,null,'a')", [brandA, PAGE_A],
      /archived/,
    );
    await client.query("update public.brands set status = 'active' where id = $1", [brandA]);
  });

  await t.test("a brand with history cannot be deleted out from under it", async () => {
    await rejects(
      "delete from public.brands where id = $1", [brandA], /foreign key|violates/i,
    );
  });

  await t.test("unmapping keeps every row and returns the page to the queue", async () => {
    const historyBefore = (await client.query(
      "select count(*)::int n from public.brand_mapping_history(null,$1,100)", [PAGE_A],
    )).rows[0].n;

    await as(analyst, async () => {
      const { rows } = await client.query(
        "select public.brand_unmap_page($1,$2) ok", [PAGE_A, "a@x"],
      );
      assert.equal(rows[0].ok, true);
    });

    const current = await client.query(
      "select count(*)::int n from public.brand_mapping_at(now()) where page_id = $1", [PAGE_A],
    );
    assert.equal(current.rows[0].n, 0);

    const historyAfter = (await client.query(
      "select count(*)::int n from public.brand_mapping_history(null,$1,100)", [PAGE_A],
    )).rows[0].n;
    assert.equal(historyAfter, historyBefore, "unmapping deletes nothing");

    const queue = await client.query(
      "select page_id from public.unmapped_pages('all',null,null,'observed_ads',30,0)",
    );
    assert.deepEqual(queue.rows.map((row) => row.page_id), [PAGE_A]);

    // Unmapping again is honest about having changed nothing.
    await as(analyst, async () => {
      const { rows } = await client.query("select public.brand_unmap_page($1,null) ok", [PAGE_A]);
      assert.equal(rows[0].ok, false);
    });
  });

  await t.test("the queue counts pages, not phantom rows", async () => {
    const empty = await client.query(
      "insert into public.brands (name) values ('No Pages Yet') returning id",
    );
    const { rows } = await client.query(
      "select id, active_pages, mapped_pages_ever from public.brand_list(null,'all',50,0)",
    );
    const row = rows.find((entry) => entry.id === empty.rows[0].id)!;
    // A brand with no mappings has none — a left join must not report one.
    assert.equal(Number(row.active_pages), 0);
    assert.equal(Number(row.mapped_pages_ever), 0);
    await client.query("delete from public.brands where id = $1", [empty.rows[0].id]);
  });

  await t.test("brand totals count ads once, whichever page they arrived through", async () => {
    await as(analyst, async () => {
      await client.query("select public.brand_map_page($1,$2,null,'a')", [brandA, PAGE_A]);
    });
    const detail = await client.query(
      "select active_pages, pages_in_scope, observed_ads from public.brand_detail($1,'all',null)",
      [brandA],
    );
    assert.equal(Number(detail.rows[0].active_pages), 2);

    const distinct = await client.query(
      `select count(distinct a.id)::int n
         from public.brand_mapping_at(now()) m
         join public.pages p on p.page_id = m.page_id
         join public.ads a on a.page_ref = p.id
        where m.brand_id = $1`,
      [brandA],
    );
    assert.equal(
      Number(detail.rows[0].observed_ads), distinct.rows[0].n,
      "one ad reached through two pages or two datasets is still one ad",
    );

    const pages = await client.query(
      "select page_id, observed_ads from public.brand_pages($1,'all',null)", [brandA],
    );
    assert.equal(pages.rows.length, 2);
    // Per-page counts sum to the brand total here because these fixtures share
    // no ads; the brand total is distinct regardless.
    const summed = pages.rows.reduce((total, row) => total + Number(row.observed_ads), 0);
    assert.equal(summed, Number(detail.rows[0].observed_ads));
  });

  await t.test("a dataset scope narrows the count without changing membership", async () => {
    const dataset = (await client.query(
      "select id from public.datasets order by created_at limit 1",
    )).rows[0].id;
    const scoped = await client.query(
      "select active_pages, pages_in_scope, observed_ads from public.brand_detail($1,'dataset',$2)",
      [brandA, dataset],
    );
    // Membership is editorial and scope-free; only the ad numbers narrow.
    assert.equal(Number(scoped.rows[0].active_pages), 2);
    assert.equal(Number(scoped.rows[0].pages_in_scope), 1);
    assert.equal(Number(scoped.rows[0].observed_ads), 1);
  });

  await t.test("renaming a brand moves nothing", async () => {
    const before = await client.query(
      "select id from public.brand_page_mappings where brand_id = $1 order by id", [brandA],
    );
    await as(analyst, async () => {
      await client.query(
        "update public.brands set name = 'Glory Thailand (renamed)' where id = $1", [brandA],
      );
    });
    const after = await client.query(
      "select id from public.brand_page_mappings where brand_id = $1 order by id", [brandA],
    );
    assert.deepEqual(after.rows, before.rows, "identity is the uuid, not the name");

    const detail = await client.query("select name from public.brand_detail($1,'all',null)", [brandA]);
    assert.equal(detail.rows[0].name, "Glory Thailand (renamed)");
  });

  await t.test("a soft-deleted dataset leaves the brand's numbers, not its mappings", async () => {
    const dataset = (await client.query(
      "select id from public.datasets order by created_at limit 1",
    )).rows[0].id;
    const before = await client.query(
      "select observed_ads from public.brand_detail($1,'all',null)", [brandA],
    );
    await client.query("update public.datasets set deleted_at = now() where id = $1", [dataset]);

    const after = await client.query(
      "select active_pages, observed_ads from public.brand_detail($1,'all',null)", [brandA],
    );
    assert.equal(
      Number(after.rows[0].observed_ads), Number(before.rows[0].observed_ads) - 1,
      "the removed dataset's ad leaves the count",
    );
    // The editorial decision is untouched: it was never about that dataset.
    assert.equal(Number(after.rows[0].active_pages), 2);

    await client.query("update public.datasets set deleted_at = null where id = $1", [dataset]);
  });

  await t.test("the brand functions keep the read-layer contract", async () => {
    const names = [
      "brand_normalized_name", "brand_mapping_at", "page_brand", "brand_list",
      "brand_detail", "brand_pages", "brand_mapping_history", "unmapped_pages",
      "brand_map_page", "brand_unmap_page",
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

  await t.test("the editorial tables are policed like shared data, not personal state", async () => {
    for (const table of ["brands", "brand_page_mappings"]) {
      const { rows } = await client.query(
        `select cmd, coalesce(qual,'') || coalesce(with_check,'') as body
           from pg_policies where schemaname = 'public' and tablename = $1 order by cmd`,
        [table],
      );
      assert.equal(rows.length, 4, `${table}: select, insert, update and delete are each policed`);
      for (const policy of rows) {
        // Never the Watchlist's own-row rule: this is data everyone shares.
        assert.ok(!/auth\.uid\(\)/.test(policy.body), `${table} ${policy.cmd} must not be own-row`);
        assert.match(policy.body, /current_user_role/, `${table} ${policy.cmd} must check the role`);
      }
      const enabled = await client.query(
        "select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`],
      );
      assert.equal(enabled.rows[0].relrowsecurity, true);

      const grants = await client.query(
        `select grantee from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1`, [table],
      );
      for (const grant of grants.rows) {
        assert.notEqual(grant.grantee, "anon");
        assert.notEqual(grant.grantee, "PUBLIC");
      }
    }
  });

  await client.query("delete from public.brand_page_mappings");
  await client.query("delete from public.brands");
  await client.end();
  await closePool();
});
