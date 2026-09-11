import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH, CATEGORY_WATCH, TMP } from "./constants.ts";
import { connect } from "../tests/db/helpers.ts";

/**
 * P2.7 — Watchlist V1.
 *
 * The journey is deliberately in this order: save a watch, THEN collect again.
 * A baseline is a promise about time, and the only way to prove the screen
 * keeps it is to create one and then put real data on the other side of it.
 *
 * Nothing here waits for the product to notice anything on its own, because it
 * does not. Every number is computed when a person opens the page.
 */

const OUT = join("test-artifacts", "visual", "p2-watchlist");
const shot = (name: string) => join(OUT, `${name}.png`);

/** This spec's own page, so no other spec can move its counts. */
const PAGE_ID = "750000000000001";
const NEW_AD = "750000000000109";

async function importFixture(page: Page, file: string, name: string) {
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY_WATCH });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
}

/**
 * The second collection, written at the moment it is needed.
 *
 * `generated_at` and the new ad's `start_date` are NOW — later than the
 * baseline saved a few steps earlier. A fixture written before the watch
 * existed would sit on the wrong side of the baseline and every signal would
 * read zero for the right reason and the wrong test.
 */
function writeSecondRun(): string {
  const base = JSON.parse(readFileSync(join(TMP, "watch-old.json"), "utf8"));
  const now = new Date().toISOString();
  const [first, second, third] = base.ads;
  const ads = [
    // Stopped since the baseline: a state change we can only see because we
    // looked again.
    { ...first, is_active: false },
    // Same ad, more copies of it.
    { ...second, collation_count: 7 },
    third,
    // New to us, new to Meta, and carrying a format and a CTA the scope has
    // never shown before.
    {
      ...first, ad_archive_id: NEW_AD, is_active: true,
      display_format: "VIDEO", cta_type: "MESSAGE_PAGE", cta_text: "ทัก",
      collation_count: 3, start_date: now,
      images: [], videos: [], cards: [],
    },
  ];
  const file = join(TMP, "watch-new.json");
  writeFileSync(file, JSON.stringify({
    ...base,
    generated_at: now,
    scope: { ...base.scope, query: "เซรั่มทดสอบ" },
    source_rows: ads.length, unique_ads: ads.length, unique_pages: 1, unresolved_count: 0,
    quality_summary: {
      ...base.quality_summary, resolved_records: ads.length, unresolved_records: 0,
    },
    ads,
    unresolved_ads: [],
  }));
  return file;
}

const count = async (page: Page, signal: string) =>
  Number((await page.getByTestId(`signal-value-${signal}`).innerText()).replace(/[^\d]/g, ""));

test.describe("P2.7 watchlist", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let categoryId = "";
  let watchId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await importFixture(page, join(TMP, "watch-old.json"), "wl-baseline");

    await page.goto("/categories");
    const row = page.locator("tr", { hasText: CATEGORY_WATCH }).first();
    await row.waitFor();
    categoryId = (await row.getAttribute("data-testid"))!.replace("category-row-", "");
    await context.close();
  });

  const scope = () => `category:${categoryId}`;

  /* ----------------------------------------------------------------- empty */

  test("an empty watchlist says what a watch is, and what it is not", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/watchlist");

    await expect(page.getByTestId("watchlist-empty")).toBeVisible();
    // The promise the product cannot keep, refused on the first screen.
    await expect(page.locator("body")).toContainText("ไม่ใช่การเฝ้าดูอัตโนมัติ");
    await expect(page.locator("body")).toContainText("ไม่มีการแจ้งเตือน");
    await expect(page.getByTestId("watchlist-scope-hint")).toBeVisible();

    await page.screenshot({ path: shot("empty-1440"), fullPage: true, animations: "disabled" });
  });

  /* --------------------------------------------------------------- create */

  test("a watch is saved from the page being looked at, in that scope", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${PAGE_ID}?scope=${scope()}`);
    await page.getByTestId("watch-button").click();

    await page.waitForURL(/\/watchlist\/[0-9a-f-]{36}/);
    watchId = page.url().split("/watchlist/")[1].split("?")[0];

    // The scope travelled with the target: this is a watch on one page inside
    // one category, not on the page across everything.
    await expect(page.getByTestId("watch-identity")).toHaveText(PAGE_ID);
    await expect(page.getByTestId("watch-scope")).toContainText("หมวดหมู่");
    await expect(page.getByTestId("watch-baseline")).not.toHaveText("—");

    // Nothing has been collected since the baseline, so every signal is zero —
    // and the current-state panel still shows the page as it stands.
    expect(await count(page, "PAGE_NEWLY_FOUND_AD")).toBe(0);
    expect(await count(page, "PAGE_STARTED_AD")).toBe(0);
    await expect(page.getByTestId("current-observed")).toContainText("3");

    await page.screenshot({ path: shot("detail-baseline-1440"), fullPage: true, animations: "disabled" });
  });

  test("the same page in the same scope is not offered twice", async ({ page }) => {
    await page.goto(`/pages/${PAGE_ID}?scope=${scope()}`);
    // Already saved, so the control is a way back to it rather than a second
    // copy of the same question.
    await expect(page.getByTestId("watch-button-existing")).toBeVisible();
    await expect(page.getByTestId("watch-button")).toHaveCount(0);
  });

  /* -------------------------------------------------------------- signals */

  test("choosing what to track does not move the baseline", async ({ page }) => {
    await page.goto(`/watchlist/${watchId}`);
    const before = await page.getByTestId("watch-baseline").innerText();

    for (const signal of [
      "PAGE_STATUS_OBSERVED_CHANGE", "PAGE_REUSE_CHANGED",
      "PAGE_NEW_FORMAT_OBSERVED", "PAGE_NEW_CTA_OBSERVED",
    ]) {
      await page.getByTestId(`toggle-${signal}`).check();
    }
    await page.getByTestId("save-signals").click();
    await expect(page.getByTestId("signal-row-PAGE_REUSE_CHANGED")).toBeVisible();

    // Two separate decisions: what you watch, and since when.
    await expect(page.getByTestId("watch-baseline")).toHaveText(before);
  });

  test("every row says whether it is an event, a state or a first sighting", async ({ page }) => {
    await page.goto(`/watchlist/${watchId}`);
    const kinds = {
      PAGE_NEWLY_FOUND_AD: "event", PAGE_STARTED_AD: "event",
      PAGE_STATUS_OBSERVED_CHANGE: "state", PAGE_REUSE_CHANGED: "state",
      PAGE_NEW_FORMAT_OBSERVED: "first_observed", PAGE_NEW_CTA_OBSERVED: "first_observed",
    };
    for (const [signal, kind] of Object.entries(kinds)) {
      await expect(page.getByTestId(`signal-row-${signal}`)).toHaveAttribute("data-kind", kind);
    }
    // A state with nothing newer to compare against says so, instead of
    // reporting a zero that reads as "nothing changed".
    await expect(page.getByTestId("signal-note-PAGE_STATUS_OBSERVED_CHANGE"))
      .toContainText("ยังไม่มี observation ใหม่");
    await expect(page.getByTestId("signal-note-PAGE_STATUS_OBSERVED_CHANGE"))
      .toContainText("ไม่ใช่ว่าไม่มีการเปลี่ยนแปลง");

    await page.screenshot({ path: shot("signals-before-1440"), fullPage: true, animations: "disabled" });
  });

  /* ------------------------------------------------- data after the baseline */

  test("a later collection is what makes a signal non-zero", async ({ page }) => {
    await importFixture(page, writeSecondRun(), "wl-after");

    await page.goto(`/watchlist/${watchId}`);
    // One ad first seen by PT Glory after the baseline, and it also started
    // after it — two different clocks that happen to agree here.
    expect(await count(page, "PAGE_NEWLY_FOUND_AD")).toBe(1);
    expect(await count(page, "PAGE_STARTED_AD")).toBe(1);
    // One ad we looked at again and found stopped, and one whose copies moved.
    expect(await count(page, "PAGE_STATUS_OBSERVED_CHANGE")).toBe(1);
    expect(await count(page, "PAGE_REUSE_CHANGED")).toBe(1);
    // ...and the values nothing in this scope carried before.
    await expect(page.getByTestId("signal-values-PAGE_NEW_FORMAT_OBSERVED")).toHaveText("VIDEO");
    await expect(page.getByTestId("signal-values-PAGE_NEW_CTA_OBSERVED")).toHaveText("MESSAGE_PAGE");

    // The state note is gone, because there is now something to compare with.
    await expect(page.getByTestId("signal-note-PAGE_STATUS_OBSERVED_CHANGE")).toHaveCount(0);

    await page.screenshot({ path: shot("signals-after-1440"), fullPage: true, animations: "disabled" });
  });

  test("every count opens exactly the ads it counted", async ({ page }) => {
    for (const signal of [
      "PAGE_NEWLY_FOUND_AD", "PAGE_STARTED_AD", "PAGE_STATUS_OBSERVED_CHANGE",
      "PAGE_REUSE_CHANGED", "PAGE_NEW_FORMAT_OBSERVED", "PAGE_NEW_CTA_OBSERVED",
    ]) {
      await page.goto(`/watchlist/${watchId}`);
      const claimed = await count(page, signal);
      expect(claimed, `${signal} should be non-zero for this fixture`).toBeGreaterThan(0);

      await page.getByTestId(`signal-value-${signal}`).click();
      await page.waitForURL(new RegExp(`signal=${signal}`));
      await page.getByTestId("watch-evidence").waitFor();
      await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
      // The drill-down repeats the definition rather than leaving the reader to
      // remember which clock the number used.
      await expect(page.getByTestId("evidence-source")).toBeVisible();
    }

    await page.goto(`/watchlist/${watchId}?signal=PAGE_NEWLY_FOUND_AD#evidence`);
    await expect(page.getByTestId(`ad-card-${NEW_AD}`)).toBeVisible();
    await page.screenshot({ path: shot("evidence-1440"), fullPage: true, animations: "disabled" });
  });

  test("the selected signal survives a reload", async ({ page }) => {
    await page.goto(`/watchlist/${watchId}?signal=PAGE_REUSE_CHANGED#evidence`);
    const cards = await page.locator('[data-testid^="ad-card-"]').count();
    await page.reload();
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(cards);
  });

  /* ------------------------------------------------------------- baseline */

  test("resetting the baseline says what it costs, then does exactly that", async ({ page }) => {
    /*
     * The baseline is shown to the minute, and this whole journey can run inside
     * one: saved at 11:11:05, reset at 11:11:50, both read "11:11" and the
     * assertion below fails whether or not the reset happened — while the checks
     * that actually prove it never run. Found at D1.2 on a fast machine; it had
     * only ever passed by crossing a minute boundary.
     *
     * So the saved baseline is moved an hour back first, through the guarded
     * fixture connection. The assertion is unchanged. A reset that did nothing
     * would still leave the screen an hour behind, and still fail.
     */
    const client = await connect();
    try {
      await client.query(
        "update public.watch_items set baseline_at = baseline_at - interval '1 hour' where id = $1",
        [watchId],
      );
    } finally {
      await client.end();
    }

    await page.goto(`/watchlist/${watchId}`);
    const before = await page.getByTestId("watch-baseline").innerText();

    await page.getByTestId("reset-baseline").click();
    // No event history exists, so what stops being counted does not come back,
    // and the confirmation says so before anything happens.
    await expect(page.getByTestId("reset-explanation")).toContainText("ไม่ได้เก็บประวัติ");
    await page.screenshot({ path: shot("reset-confirm-1440"), animations: "disabled" });

    await page.getByTestId("confirm-reset").click();
    await expect(page.getByTestId("watch-baseline")).not.toHaveText(before);

    // Everything is now on the old side of the baseline.
    expect(await count(page, "PAGE_NEWLY_FOUND_AD")).toBe(0);
    expect(await count(page, "PAGE_STATUS_OBSERVED_CHANGE")).toBe(0);
    await expect(page.getByTestId("signal-note-PAGE_STATUS_OBSERVED_CHANGE"))
      .toContainText("ยังไม่มี observation ใหม่");
  });

  /* -------------------------------------------------------------- snapshot */

  test("a dataset watch says a baseline cannot move inside a snapshot", async ({ page }) => {
    await page.goto("/datasets");
    const row = page.locator("tr", { hasText: "wl-baseline" }).first();
    await row.waitFor();
    const datasetId = (await row.getAttribute("data-testid"))!.replace("dataset-row-", "");

    await page.goto(`/pages/${PAGE_ID}?scope=dataset:${datasetId}`);
    await page.getByTestId("watch-button").click();
    await page.waitForURL(/\/watchlist\/[0-9a-f-]{36}/);

    await expect(page.getByTestId("watch-snapshot-note")).toBeVisible();
    await expect(page.getByTestId("watch-signals")).toHaveCount(0);
    await page.screenshot({ path: shot("snapshot-1440"), fullPage: true, animations: "disabled" });

    await page.getByTestId("delete-watch").click();
    await page.getByTestId("confirm-delete").click();
    await page.waitForURL(/\/watchlist$/);
  });

  /* -------------------------------------------------------------- category */

  test("a category can be watched too, with its own signal", async ({ page }) => {
    await page.goto(`/categories/${categoryId}`);
    await page.getByTestId("watch-button").click();
    await page.waitForURL(/\/watchlist\/[0-9a-f-]{36}/);
    const id = page.url().split("/watchlist/")[1];

    await expect(page.getByTestId("signal-row-CATEGORY_NEWLY_FOUND_AD")).toBeVisible();
    // Page signals are not shown as zeros on a category watch: a zero would
    // read as an answer to a question nobody asked.
    await expect(page.getByTestId("signal-row-PAGE_STARTED_AD")).toHaveCount(0);
    await expect(page.getByTestId("current-pages")).toBeVisible();
    await page.screenshot({ path: shot("category-1440"), fullPage: true, animations: "disabled" });

    await page.goto("/watchlist");
    await expect(page.getByTestId(`watch-row-${id}`)).toBeVisible();
    await expect(page.getByTestId("watchlist-table")).toBeVisible();
    await page.screenshot({ path: shot("list-1440"), fullPage: true, animations: "disabled" });
  });

  /* -------------------------------------------------------- keyboard, sizes */

  test("the watch is operable without a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/watchlist/${watchId}`);
    // Something non-zero to aim at: the reset above zeroed the signals, so the
    // link that must be reachable is the one to the page itself.
    const link = page.getByRole("link", { name: "เปิดหน้าเพจ" });

    let reached = false;
    for (let step = 0; step < 160 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the page link must be reachable by keyboard").toBe(true);
    expect(await link.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(29, 78, 216)");

    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/pages/${PAGE_ID}`));
  });

  test("the watchlist works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      await page.goto("/watchlist");
      await expect(page.getByTestId("watchlist-table")).toBeVisible();
      expect(await overflows(), `the list overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`list-${suffix}`), fullPage: true, animations: "disabled" });

      await page.goto(`/watchlist/${watchId}`);
      await expect(page.getByTestId("watch-signals")).toBeVisible();
      expect(await overflows(), `the detail overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`detail-${suffix}`), fullPage: true, animations: "disabled" });
    }
  });

  /* ---------------------------------------------------------------- delete */

  test("removing a watch removes the watch and nothing else", async ({ page }) => {
    await page.goto(`/watchlist/${watchId}`);
    await page.getByTestId("delete-watch").click();
    await expect(page.getByTestId("delete-explanation")).toContainText("ไม่ถูกลบ");
    await page.getByTestId("confirm-delete").click();
    await page.waitForURL(/\/watchlist$/);
    await expect(page.getByTestId(`watch-row-${watchId}`)).toHaveCount(0);

    // The data the watch pointed at is untouched: the page still reads the same.
    await page.goto(`/pages/${PAGE_ID}?scope=${scope()}`);
    await expect(page.getByTestId("kpi-observed")).toContainText("4");
    await expect(page.getByTestId("watch-button")).toBeVisible();
  });
});
