import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { ACCOUNTS, AUTH, CATEGORY } from "./constants.ts";
import { assertDestructiveAllowed } from "../scripts/destructive-guard.mjs";

/**
 * C15 — the whole collection path, in a real browser against the real server.
 *
 * The provider is the deterministic fake (`COLLECTOR_FAKE_PROVIDER=1`), so a run
 * costs nothing and returns the same twelve ads every time. Everything else is
 * the product: admission, the state machine, the settlement gate, the import and
 * the scheduler all run exactly as they would in front of a real collector.
 *
 * The claim this suite exists to defend: however many times a person reloads,
 * leaves, or comes back, their collection is started once and paid for once.
 */

const ANALYST = { storageState: join(AUTH, "analyst.json") };
const ADMIN = { storageState: join(AUTH, "admin.json") };
const VIEWER = { storageState: join(AUTH, "viewer.json") };

/**
 * A complete, valid collector configuration.
 *
 * Written from the test rather than seeded by setup, because several cases here
 * are about what a person is told when one of these values is wrong, and each of
 * them puts this back afterwards.
 */
const SETTINGS: Record<string, unknown> = {
  "collector.enabled": true,
  "collector.actor": "ptglory~fake-collector",
  "collector.actor_build": "0.0.0",
  "collector.countries": ["TH"],
  "collector.monthly_budget_usd": 20,
  "collector.max_charge_per_run_usd": 0.5,
  "collector.billing_cycle_anchor": "2026-09-01",
  "collector.billing_cycle_length_months": 1,
  "collector.max_records_per_run": 500,
  "collector.max_export_bytes": 25000000,
  "collector.run_timeout_minutes": 10,
  "collector.max_concurrent": 5,
  "collector.lease_seconds": 120,
  // One second, so the settlement gate's two readings are a wait a test can
  // afford. The gate itself is untouched: it still demands two of them.
  "collector.result_settle_seconds": 1,
  "collector.result_settle_window_minutes": 15,
  "collector.reconcile_window_minutes": 30,
  "collector.reconcile_page_size": 20,
  "collector.cost_settle_minutes": 15,
  "collector.cost_final_window_hours": 6,
  "collector.tick_batch": 5,
};

/**
 * Every database touch in this file goes through here, and every one of them
 * writes: settings, seeded recovery rows, scheduling. That makes this suite
 * destructive by the project's own definition, so it asks the guard first.
 */
async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  assertDestructiveAllowed(process.env.DATABASE_URL, "the C15 collection browser suite");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const setSettings = (values: Record<string, unknown>) => withDb(async (client) => {
  for (const [key, value] of Object.entries(values)) {
    await client.query(
      `insert into public.app_settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
});

/** What the database says actually happened, which is the only honest counter. */
const evidence = (id: string) => withDb(async (client) => {
  const { rows } = await client.query<{
    status: string; provider_run_id: string | null; start_attempted_at: Date | null;
    attempt: number; collection_run_id: string | null; dataset_id: string | null;
    requested_by: string; cost_status: string; provider_item_count: number | null;
  }>(
    `select status, provider_run_id, start_attempted_at, attempt, collection_run_id,
            dataset_id, requested_by, cost_status, provider_item_count
       from public.collection_requests where id = $1`,
    [id],
  );
  return rows[0];
});

const countRequests = () => withDb(async (client) => {
  const { rows } = await client.query<{ n: string }>(
    "select count(*)::text as n from public.collection_requests",
  );
  return Number(rows[0].n);
});

const userId = (email: string) => withDb(async (client) => {
  const { rows } = await client.query<{ id: string }>(
    "select id from auth.users where email = $1",
    [email],
  );
  return rows[0].id;
});

const categoryId = () => withDb(async (client) => {
  const { rows } = await client.query<{ id: string }>(
    "select id from public.categories where name = $1",
    [CATEGORY],
  );
  return rows[0].id;
});

/**
 * One scheduler tick, exactly as the cron sends it.
 *
 * The browser never calls this — it is machine-authenticated — so the test acts
 * as the scheduler, which is the whole point of the "close the page" case.
 */
async function tick(page: Page) {
  const token = process.env.COLLECTION_ADVANCE_TOKEN;
  expect(token, "COLLECTION_ADVANCE_TOKEN must be configured for this project").toBeTruthy();
  const response = await page.request.post("/api/collections/advance", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(202);
}

/**
 * Drives one collection to a terminal state.
 *
 * Two liberties are taken with the clock and nothing else. The wait before each
 * tick is real, because the settlement gate requires two readings separated in
 * time and skipping it would be testing a different gate. Bringing the row's own
 * `next_check_at` forward only says "the next scheduled tick has arrived" — the
 * machine's backoff climbs into minutes and a browser test cannot sit through
 * it. Every transition, claim, lease and gate is the product's own.
 */
async function runToCompletion(page: Page, id: string) {
  for (let round = 0; round < 40; round += 1) {
    const state = await evidence(id);
    if (state.status === "succeeded" || state.status === "failed") return state;
    await page.waitForTimeout(1200);
    await withDb((client) => client.query(
      "update public.collection_requests set next_check_at = now() where id = $1",
      [id],
    ));
    await tick(page);
  }
  throw new Error(`collection ${id} never finished: ${JSON.stringify(await evidence(id))}`);
}

async function fillForm(page: Page, keyword: string) {
  await page.goto("/collect");
  await page.getByTestId("keyword").fill(keyword);
  await page.getByTestId("category-select").selectOption({ label: CATEGORY });
  await page.getByTestId("max-records").fill("20");
}

const idFromUrl = (page: Page) => page.url().split("/collect/")[1];

/** What one region of the page actually renders — not Next's own payload. */
const regionHtml = (page: Page, testId: string) => page.getByTestId(testId).innerHTML();

const usd = (text: string | null) => Number((text ?? "").replace(/[^\d.]/g, ""));

/**
 * The collector settings are global, and so is the database this runs against.
 *
 * A suite that writes them and walks away changes what every other suite sees —
 * the DB tests read the same rows and several of them are about a setting being
 * absent. So this one puts the table back exactly as it found it.
 */
async function snapshotCollectorSettings(): Promise<() => Promise<void>> {
  const before = await withDb(async (client) => {
    const { rows } = await client.query<{ key: string; value: unknown }>(
      "select key, value from public.app_settings where key like 'collector.%'",
    );
    return rows;
  });
  return () => withDb(async (client) => {
    await client.query("delete from public.app_settings where key like 'collector.%'");
    for (const row of before) {
      await client.query(
        "insert into public.app_settings (key, value) values ($1, $2::jsonb)",
        [row.key, JSON.stringify(row.value)],
      );
    }
  });
}

let restoreSettings: (() => Promise<void>) | null = null;

test.beforeAll(async () => {
  restoreSettings = await snapshotCollectorSettings();
  await setSettings(SETTINGS);
});

test.afterAll(async () => {
  await restoreSettings?.();
});

// --- the analyst's whole path ------------------------------------------------------

test.describe("an analyst collects data without ever meeting the collector", () => {
  test.describe.configure({ mode: "serial" });
  test.use(ANALYST);

  test("the menu leads to a form that asks only product questions", async ({ page }) => {
    await page.goto("/datasets");
    await page.getByRole("link", { name: "เก็บข้อมูลใหม่" }).click();
    await expect(page).toHaveURL(/\/collect$/);
    await expect(page.getByTestId("collect-form")).toBeVisible();

    const form = (await regionHtml(page, "collect-form")).toLowerCase();
    for (const word of ["apify", "actor", "token", "proxy", "dataset_id"]) {
      expect(form, `the form must not mention ${word}`).not.toContain(word);
    }
  });

  test("the form insists on a category and respects the configured cap", async ({ page }) => {
    await page.goto("/collect");
    await page.getByTestId("keyword").fill("วิตามินซี");
    // No category chosen yet.
    await expect(page.getByTestId("collect-submit")).toBeDisabled();
    await expect(page.getByTestId("collect-invalid")).toContainText("หมวดหมู่");

    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await expect(page.getByTestId("collect-submit")).toBeEnabled();

    // Above the configured maximum it will not submit either, and it says the number.
    await page.getByTestId("max-records").fill("5000");
    await expect(page.getByTestId("collect-submit")).toBeDisabled();
    await expect(page.getByTestId("collect-invalid")).toContainText("500");

    // The dataset name is suggested from what was typed, and stays editable.
    await page.getByTestId("max-records").fill("20");
    await expect(page.getByTestId("dataset-name")).toHaveValue(/^วิตามินซี · ไทย · /);
    await page.getByTestId("dataset-name").fill("รอบทดสอบ C15");
    await expect(page.getByTestId("dataset-name")).toHaveValue("รอบทดสอบ C15");
  });

  test("one submission makes one collection, and the progress view says so", async ({ page }) => {
    const before = await countRequests();
    await fillForm(page, "วิตามินรวม");
    await page.getByTestId("collect-submit").click();

    await page.waitForURL(/\/collect\/[0-9a-f-]{36}/);
    const id = idFromUrl(page);
    expect(await countRequests()).toBe(before + 1);

    await expect(page.getByTestId("collect-progress")).toBeVisible();
    await expect(page.getByTestId("status-label")).toHaveText(/รอคิวเก็บข้อมูล|กำลังเก็บข้อมูล/);

    // Nothing on the progress page names the machinery.
    const progress = (await regionHtml(page, "collect-progress")).toLowerCase();
    for (const word of ["apify", "fake-run", "fake-ds", "provider_", "error_class"]) {
      expect(progress, `progress must not contain ${word}`).not.toContain(word);
    }

    const state = await evidence(id);
    expect(state.requested_by).toBe(await userId(ACCOUNTS.analyst));
    expect(state.cost_status).toBe("reserved");
    await runToCompletion(page, id);
  });

  test("twenty refreshes never buy a second collection", async ({ page }) => {
    await fillForm(page, "คอลลาเจน");
    await page.getByTestId("collect-submit").click();
    await page.waitForURL(/\/collect\/[0-9a-f-]{36}/);
    const id = idFromUrl(page);

    // One scheduled tick attaches the one provider run; then the page is
    // reloaded twenty times, which is what a person waiting actually does.
    await tick(page);
    await expect.poll(async () => (await evidence(id)).provider_run_id).not.toBeNull();
    const attached = await evidence(id);
    expect(attached.attempt).toBe(1);

    for (let i = 0; i < 20; i += 1) {
      await page.reload();
      await expect(page.getByTestId("collect-progress")).toBeVisible();
    }

    const after = await evidence(id);
    expect(after.provider_run_id).toBe(attached.provider_run_id);
    expect(after.start_attempted_at).toEqual(attached.start_attempted_at);
    // The counter that would move if any read had started anything.
    expect(after.attempt).toBe(1);
    // And no reload submitted the form again.
    const twins = await withDb((client) => client.query<{ n: string }>(
      "select count(*)::text as n from public.collection_requests where params->>'keyword' = $1",
      ["คอลลาเจน"],
    ));
    expect(Number(twins.rows[0].n)).toBe(1);
    await runToCompletion(page, id);
  });

  test("closing the page does not stop the work, and the result opens a Dataset", async ({ page, browser }) => {
    await fillForm(page, "เซรั่มทดสอบ");
    await page.getByTestId("collect-submit").click();
    await page.waitForURL(/\/collect\/[0-9a-f-]{36}/);
    const id = idFromUrl(page);

    // The person closes the browser while the collection is still running.
    const context = await browser.newContext(ANALYST);
    const later = await context.newPage();
    await page.close();

    const state = await runToCompletion(later, id);
    expect(state.status).toBe("succeeded");
    expect(state.collection_run_id, "one canonical run was committed").toBeTruthy();
    expect(state.dataset_id).toBeTruthy();
    expect(state.provider_item_count).toBe(12);

    // Coming back later shows the finished collection and a way into the data.
    await later.goto(`/collect/${id}`);
    await expect(later.getByTestId("status-label")).toHaveText("เสร็จสิ้น");
    await expect(later.getByTestId("count-ads")).toHaveText("12");
    await later.getByTestId("open-dataset").click();
    await expect(later).toHaveURL(/\/competitors\?dataset=[0-9a-f-]{36}/);
    await context.close();
  });

  test("the same key submitted twice returns the same collection", async ({ page }) => {
    // What a retry after a lost answer really is: the key the page was given,
    // sent a second time. The first call creates; the second recognises.
    const body = {
      keyword: "ครีมกันแดดทดสอบ",
      country: "TH",
      activeStatus: "active",
      maxRecords: 20,
      categoryId: await categoryId(),
      datasetName: "รอบส่งซ้ำ C15",
      requestKey: randomUUID(),
    };
    const before = await countRequests();

    const first = await page.request.post("/api/collections", { data: body });
    expect(first.status()).toBe(201);
    const second = await page.request.post("/api/collections", { data: body });
    expect(second.status()).toBe(200);

    const id = (await first.json()).id;
    expect((await second.json()).id).toBe(id);
    expect(await countRequests()).toBe(before + 1);
    await runToCompletion(page, id);
  });

  /**
   * The four finished screens that a fake run cannot produce on demand.
   *
   * A deterministic provider always returns the same twelve ads, so zero, a
   * partial result and an admin review would never appear — and those are
   * exactly the states a person is most likely to misread. The rows are seeded
   * in the shapes the machine itself writes, and what is asserted is the page.
   */
  test("a finished collection says which kind of finished it is", async ({ page }) => {
    const [owner, category] = await Promise.all([userId(ACCOUNTS.analyst), categoryId()]);
    const seed = (fields: Record<string, unknown>) => withDb(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.collection_requests
           (requested_by, request_key, params, category_id, dataset_name, source_url,
            status, finished_at, start_attempted_at, cost_status, cost_reserved_usd,
            result, stop_reason, requires_admin, error_class)
         values ($1, gen_random_uuid()::text, $2::jsonb, $3, $4,
                 'https://www.facebook.com/ads/library/?q=x',
                 $5, now(), now(), 'unreported', '0.100000',
                 $6::jsonb, $7, $8, $9)
         returning id`,
        [
          owner,
          JSON.stringify({ keyword: String(fields.name), country: "TH", active_status: "active", max_records: 10 }),
          category, fields.name, fields.status, JSON.stringify(fields.result ?? null),
          fields.stopReason ?? null, fields.requiresAdmin ?? false, fields.errorClass ?? null,
        ],
      );
      return rows[0].id;
    });

    // Nothing matched: a complete answer, and no dataset to open.
    const zero = await seed({ name: "รอบผลศูนย์", status: "succeeded", result: { ads: 0, pages: 0, quarantined: 0 } });
    await page.goto(`/collect/${zero}`);
    await expect(page.getByTestId("zero-result")).toHaveText("ไม่พบโฆษณาตามเงื่อนไขนี้");
    await expect(page.getByTestId("open-dataset")).toHaveCount(0);

    // Stopped at the ceiling the person set: a result, with its limit stated.
    const partial = await seed({
      name: "รอบไม่ครบ", status: "succeeded",
      result: { ads: 10, pages: 3, quarantined: 0 }, stopReason: "limit_reached",
    });
    await page.goto(`/collect/${partial}`);
    await expect(page.getByTestId("partial-notice")).toContainText("เก็บครบตามจำนวนสูงสุดที่ตั้งไว้");
    await expect(page.getByTestId("count-ads")).toHaveText("10");

    // Failed: offered a fresh attempt, never a silent restart of the paid one.
    const failed = await seed({ name: "รอบล้มเหลว", status: "failed", errorClass: "provider_start_failed" });
    await page.goto(`/collect/${failed}`);
    await expect(page.getByTestId("collect-failed")).toBeVisible();
    await expect(page.getByTestId("retry-collect")).toHaveAttribute("href", "/collect");

    // Uncertain: a person waits for an admin and is told not to ask again.
    const uncertain = await seed({
      name: "รอบไม่แน่ชัด", status: "failed",
      errorClass: "provider_result_unsettled", requiresAdmin: true,
    });
    await page.goto(`/collect/${uncertain}`);
    await expect(page.getByTestId("status-label")).toHaveText("รอผู้ดูแลระบบตรวจสอบ");
    await expect(page.getByTestId("needs-admin-note")).toContainText("ไม่ต้องส่งคำขอใหม่");

    // None of these four screens names the machinery either.
    for (const id of [zero, partial, failed, uncertain]) {
      await page.goto(`/collect/${id}`);
      const shown = (await regionHtml(page, "collect-progress")).toLowerCase();
      for (const word of ["apify", "provider_", "error_class"]) {
        expect(shown, `${id} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  test("an analyst has no way to reach the file import any more", async ({ page }) => {
    const response = await page.goto("/import");
    expect(response!.status()).toBe(403);
  });
});

// --- refusals, in the product's own words ------------------------------------------

test.describe("a refused collection explains itself without naming the machinery", () => {
  test.describe.configure({ mode: "serial" });
  test.use(ANALYST);

  test.afterEach(async () => {
    await setSettings(SETTINGS);
  });

  test("a spent budget says the round is used up", async ({ page }) => {
    await setSettings({ "collector.monthly_budget_usd": 0 });
    await fillForm(page, "งบเต็มทดสอบ");
    await page.getByTestId("collect-submit").click();
    await expect(page.getByTestId("collect-problem")).toContainText("รอบนี้เก็บข้อมูลได้ครบ");
    await expect(page).toHaveURL(/\/collect$/);
  });

  test("an unconfigured collector says to ask an admin", async ({ page }) => {
    await fillForm(page, "ยังไม่ตั้งค่าทดสอบ");
    // Unset after the form rendered: the person is holding a form that looks
    // valid and the server refuses anyway, which is the case worth proving.
    await setSettings({ "collector.max_records_per_run": null });
    await page.getByTestId("collect-submit").click();
    await expect(page.getByTestId("collect-problem")).toContainText("ติดต่อผู้ดูแลระบบ");
  });

  test("a collector already at its limit says to wait", async ({ page }) => {
    const [owner, category] = await Promise.all([userId(ACCOUNTS.analyst), categoryId()]);
    const { rows } = await withDb((client) => client.query<{ id: string }>(
      `insert into public.collection_requests
         (requested_by, request_key, params, category_id, dataset_name, source_url,
          status, cost_status, cost_reserved_usd)
       values ($1, gen_random_uuid()::text, $2::jsonb, $3, 'รอบที่ถือคิวไว้',
               'https://www.facebook.com/ads/library/?q=x', 'queued', 'reserved', '0.500000')
       returning id`,
      [
        owner,
        JSON.stringify({ keyword: "คิวเต็ม", country: "TH", active_status: "active", max_records: 10 }),
        category,
      ],
    ));
    await setSettings({ "collector.max_concurrent": 1 });

    await fillForm(page, "คิวเต็มทดสอบ");
    await page.getByTestId("collect-submit").click();
    await expect(page.getByTestId("collect-problem")).toContainText("กรุณารอให้เสร็จก่อน");

    await withDb((client) => client.query(
      `update public.collection_requests
          set status = 'failed', error_class = 'provider_start_failed', finished_at = now()
        where id = $1`,
      [rows[0].id],
    ));
  });

  test("a collector that is switched off does not offer a form at all", async ({ page }) => {
    await setSettings({ "collector.enabled": false });
    await page.goto("/collect");
    await expect(page.getByTestId("collector-disabled")).toBeVisible();
    await expect(page.getByTestId("collect-form")).toHaveCount(0);
  });
});

// --- who may see any of this -------------------------------------------------------

test.describe("a viewer is not offered collection at all", () => {
  test.use(VIEWER);

  test("no menu entry, and both pages refuse", async ({ page }) => {
    const html = await (await page.goto("/datasets"))!.text();
    const open = html.indexOf('data-testid="app-sidebar"');
    const sidebar = html.slice(open, html.indexOf("</aside>", open));
    for (const label of ["เก็บข้อมูลใหม่", "ค่าเก็บข้อมูล", "นำเข้าไฟล์ (กู้คืนระบบ)"]) {
      expect(sidebar, label).not.toContain(label);
    }

    expect((await page.goto("/collect"))!.status()).toBe(403);
    expect((await page.goto("/collector"))!.status()).toBe(403);
    // And the API says the same, so a hidden menu is not what protects anything.
    expect((await page.request.get("/api/collections")).status()).toBe(403);
  });
});

test.describe("an analyst cannot reach the collector's operating figures", () => {
  test.use(ANALYST);

  test("the admin page and its APIs refuse", async ({ page }) => {
    expect((await page.goto("/collector"))!.status()).toBe(403);
    expect((await page.request.get("/api/collector/usage")).status()).toBe(403);
    const patch = await page.request.patch("/api/collector/settings", { data: { tick_batch: 9 } });
    expect(patch.status()).toBe(403);
  });
});

// --- the admin's page ---------------------------------------------------------------

test.describe("an admin sees what collecting costs and what is waiting", () => {
  test.describe.configure({ mode: "serial" });
  test.use(ADMIN);

  test("usage separates held money from settled cost, and says which is which", async ({ page }) => {
    await page.goto("/collector");
    await expect(page.getByTestId("collector-usage")).toBeVisible();
    await expect(page.getByTestId("usage-window")).toContainText("เวลากรุงเทพฯ");
    await expect(page.getByTestId("usage-held")).toContainText("USD");
    await expect(page.getByTestId("usage-final")).toContainText("USD");

    const usage = await regionHtml(page, "collector-usage");
    expect(usage).toContain("ยังไม่ใช่ค่าใช้จ่ายจริง");
    expect(usage).toContain("ไม่ใช่ค่าโฆษณา");
  });

  test("releasing a held reservation needs a reason, and changes only the hold", async ({ page }) => {
    // An unresolved unknown start: the only case the release applies to.
    const [owner, category] = await Promise.all([userId(ACCOUNTS.admin), categoryId()]);
    const { rows } = await withDb((client) => client.query<{ id: string }>(
      `insert into public.collection_requests
         (requested_by, request_key, params, category_id, dataset_name, source_url,
          status, error_class, finished_at, start_attempted_at, cost_status, cost_reserved_usd)
       values ($1, gen_random_uuid()::text, $2::jsonb, $3, 'รอบค้างทดสอบ',
               'https://www.facebook.com/ads/library/?q=x',
               'failed', 'provider_start_unknown', now(), now(), 'unreported', '0.400000')
       returning id`,
      [
        owner,
        JSON.stringify({ keyword: "รอบค้างทดสอบ", country: "TH", active_status: "active", max_records: 10 }),
        category,
      ],
    ));
    const id = rows[0].id;

    await page.goto("/collector");
    const heldBefore = usd(await page.getByTestId("usage-held").textContent());
    const availableBefore = usd(await page.getByTestId("usage-available").textContent());
    const finalBefore = await page.getByTestId("usage-final").textContent();

    await page.getByTestId(`action-release_unresolved_reservation-${id}`).click();
    await expect(page.getByTestId("release-warning")).toContainText("ไม่ได้แปลว่าผู้ให้บริการไม่คิดเงิน");
    // Nothing is sent without a reason.
    await expect(page.getByTestId("recovery-confirm-submit")).toBeDisabled();

    await page.getByTestId("recovery-reason").fill("ไม่พบหลักฐานว่ามีรอบที่เสียเงิน");
    await page.getByTestId("recovery-confirm-submit").click();
    // The page reloads itself once the action has succeeded.
    await expect(page.getByTestId(`action-release_unresolved_reservation-${id}`)).toHaveCount(0);

    // The hold is gone, the budget is free again, settled cost is untouched.
    expect(usd(await page.getByTestId("usage-held").textContent())).toBeCloseTo(heldBefore - 0.4, 6);
    expect(usd(await page.getByTestId("usage-available").textContent()))
      .toBeCloseTo(availableBefore + 0.4, 6);
    expect(await page.getByTestId("usage-final").textContent()).toBe(finalBefore);

    const after = await withDb(async (client) => {
      const { rows: read } = await client.query<{
        reservation_released_at: Date | null; reservation_release_reason: string | null;
        cost_status: string; cost_reserved_usd: string; cost_final_usd: string | null;
      }>(
        `select reservation_released_at, reservation_release_reason, cost_status,
                cost_reserved_usd, cost_final_usd
           from public.collection_requests where id = $1`,
        [id],
      );
      return read[0];
    });
    expect(after.reservation_released_at).not.toBeNull();
    expect(after.reservation_release_reason).toBe("ไม่พบหลักฐานว่ามีรอบที่เสียเงิน");
    // What a release does not do: change the cost, or claim nothing was charged.
    expect(after.cost_status).toBe("unreported");
    expect(after.cost_reserved_usd).toBe("0.400000");
    expect(after.cost_final_usd).toBeNull();
  });

  test("an admin keeps the recovery import, and may collect normally too", async ({ page }) => {
    expect((await page.goto("/import"))!.status()).toBe(200);
    expect((await page.goto("/collect"))!.status()).toBe(200);
    await expect(page.getByTestId("collect-form")).toBeVisible();
  });
});
