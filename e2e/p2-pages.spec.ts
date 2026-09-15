import { expect, test, type Browser, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * P2.1 — Page Intelligence.
 *
 * The feature's whole claim is that a page-level number can be opened. So these
 * cases mostly do one thing: read a figure off a summary, click through to the
 * ads behind it, and check the two agree. The rest pin the boundaries that make
 * such a figure meaningful at all — the scope it belongs to, and the coverage it
 * was computed over.
 */

const OUT = join("test-artifacts", "visual", "p2-page-intelligence");
const shot = (name: string) => join(OUT, `${name}.png`);

/** The fixture page: five ads, only two with a readable CTA. */
const FIXTURE_PAGE = "710000000000001";

/**
 * Imports one fixture the way an admin would.
 *
 * Manual import is admin-only since C14 — it is the recovery path, not a way to
 * collect — so this step opens its own admin context. Everything the spec is
 * actually about keeps whatever session it declared.
 */
async function importFixture(browser: Browser, file: string, name: string) {
  const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
  const page = await context.newPage();
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  const datasetId = page.url().split("/").pop()!;
  await context.close();
  return datasetId;
}

/** Every card on screen has decoded, so a capture cannot show half a grid. */
async function evidenceSettled(page: Page) {
  await page.getByTestId("evidence-grid").waitFor();
  await page.locator('[data-testid^="ad-card-"]').first().waitFor();
}

test.describe("P2.1 page intelligence", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetId = "";

  test.beforeAll(async ({ browser }) => {
    datasetId = await importFixture(browser, join(TMP, "pages-mixed.json"), "p2-pages");
  });

  /* ----------------------------------------------------------------- scope */

  test("no scope means no numbers, and the reader is asked to choose", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/pages");
    // Not an error and not an empty state: a research question that has not been
    // asked yet. The alternative — defaulting to everything — would state market-wide
    // aggregates nobody requested.
    await expect(page.getByTestId("scope-chooser")).toBeVisible();
    await expect(page.getByTestId("page-list")).toHaveCount(0);
    await expect(page.getByTestId("scope-all")).toBeVisible();
    await page.screenshot({ path: shot("scope-chooser-1440"), fullPage: true, animations: "disabled" });
  });

  test("a dataset scope says it is a snapshot; a wider one says it is not", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(`/pages?scope=dataset:${datasetId}`);
    await expect(page.getByTestId("scope-basis")).toContainText("รอบเก็บของ Dataset นี้");

    await page.goto("/pages?scope=all");
    await expect(page.getByTestId("scope-basis")).toContainText("ไม่ใช่ snapshot");
  });

  test("a malformed scope is refused rather than widened", async ({ page }) => {
    await page.goto("/pages?scope=dataset:not-a-uuid");
    // Falls back to asking, never to "everything we have".
    await expect(page.getByTestId("scope-chooser")).toBeVisible();

    const response = await page.request.get(
      `/api/pages/${FIXTURE_PAGE}/ads?scope=everything`,
    );
    expect(response.status()).toBe(400);
  });

  /* ------------------------------------------------------------- page list */

  test("the list states each page's three states separately", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages?scope=dataset:${datasetId}`);

    const row = page.getByTestId(`page-row-${FIXTURE_PAGE}`);
    await expect(row).toBeVisible();
    // Three active, one stopped, one unreadable — and the unreadable one is its
    // own badge, never added to inactive.
    await expect(row.locator('[data-status="true"]')).toContainText("3");
    await expect(row.locator('[data-status="false"]')).toContainText("1");
    await expect(row.locator('[data-status="unknown"]')).toContainText("1");

    await page.screenshot({ path: shot("page-list-1440"), fullPage: true, animations: "disabled" });
  });

  test("search and sort run on the server and stay in the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages?scope=dataset:${datasetId}`);

    await page.getByTestId("page-search").fill("ไม่มีเพจชื่อนี้");
    await page.getByTestId("page-search-submit").click();
    await expect(page.getByTestId("pages-empty")).toBeVisible();
    expect(page.url()).toContain("search=");

    await page.goto(`/pages?scope=dataset:${datasetId}`);
    await page.getByTestId("page-sort").selectOption("page_name");
    await expect(page).toHaveURL(/sort=page_name/);
    await expect(page.getByTestId("page-list")).toBeVisible();
  });

  /* ----------------------------------------------------------- page detail */

  test("the detail keeps recently-found and started-recently apart", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);

    await expect(page.getByTestId("kpi-observed")).toContainText("5");
    // Two different questions about time. The helper text on each says which.
    await expect(page.getByTestId("kpi-recent")).toContainText("นับจากวันที่ PT Glory เห็นครั้งแรก");
    await expect(page.getByTestId("kpi-started")).toContainText("นับจากวันที่ Meta ระบุ");

    // The page identity is the page, and the id is a fact rather than the title.
    await expect(page.getByTestId("page-identity")).toHaveText(FIXTURE_PAGE);
    await expect(page.locator("h1")).not.toHaveText(FIXTURE_PAGE);

    await evidenceSettled(page);
    await page.screenshot({ path: shot("page-detail-1440"), fullPage: true, animations: "disabled" });
  });

  test("a distribution over part of the data says so instead of claiming the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);

    // Two of five ads have a readable CTA. The heading must not read as a fact
    // about the page.
    const cta = page.getByTestId("mix-cta-qualifier");
    await expect(cta).toHaveAttribute("data-tier", "low");
    await expect(cta).toContainText("ไม่ใช่ทั้งเพจ");
    await expect(page.getByTestId("mix-cta-denominator")).toContainText("2 / 5");

    // Format is readable on four of five, which is still not enough to speak
    // for the whole page.
    await expect(page.getByTestId("mix-format-denominator")).toContainText("4 / 5");

    // Platform is multi-value, so it is never described as a share of a whole.
    await expect(page.getByTestId("mix-platform-qualifier")).toContainText("เกิน 100% ได้");

    await page.screenshot({ path: shot("partial-coverage-1440"), animations: "disabled" });
  });

  test("the activity chart keeps its two series named and separate", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);

    const chart = page.getByTestId("page-activity");
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("พบครั้งแรก");
    await expect(chart).toContainText("เริ่มแสดง");
    // Five ads started across five different years, all first seen in one run:
    // the two facts cannot share a bucket, which is the point of two series.
    expect(await page.getByTestId("page-activity-bucket").count()).toBeGreaterThan(1);

    await chart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("activity-1440"), animations: "disabled" });
  });

  /* --------------------------------------------------------------- evidence */

  test("every signal count opens the ads it counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);
    await evidenceSettled(page);

    for (const signal of ["evergreen", "reused", "unknown", "inactive"] as const) {
      const tab = page.getByTestId(`signal-${signal}`);
      const claimed = Number((await tab.innerText()).replace(/\D+/g, ""));
      await tab.click();
      await page.getByTestId("signal-tabs").waitFor();

      if (claimed === 0) {
        await expect(page.getByTestId("evidence-empty")).toBeVisible();
        continue;
      }
      await evidenceSettled(page);
      // The number on the tab and the number of rows behind it are the same
      // number. A count that cannot be opened is a claim, not a fact.
      await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
    }

    await page.getByTestId("signal-recent").click();
    await evidenceSettled(page);
    await page.screenshot({ path: shot("recently-found-1440"), animations: "disabled" });

    await page.getByTestId("signal-reused").click();
    await evidenceSettled(page);
    await page.screenshot({ path: shot("most-reused-1440"), animations: "disabled" });
  });

  test("a creative-mix bar drills into the same ads the bar counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);

    // Two of the five ads are IMAGE. Following the bar must land on those two.
    // ...and the "could not read this" bucket is not offered as a filter at all.
    await expect(page.getByTestId("mix-format-evidence-—")).toHaveCount(0);
    await page.getByTestId("mix-format-evidence-IMAGE").click();
    await page.waitForURL(/format=IMAGE/);
    await evidenceSettled(page);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(2);
    await expect(page.getByTestId("evidence-grid")).toBeVisible();

    await page.screenshot({ path: shot("evidence-ads-1440"), animations: "disabled" });
  });

  test("an ad opens in the frozen drawer, pinned to this dataset", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);
    await evidenceSettled(page);

    await page.locator('[data-testid^="open-ad-"]').first().click();
    const drawer = page.getByTestId("ad-drawer");
    await drawer.waitFor();
    // The same drawer as the Explorer, in dataset context — not a second ad
    // detail implementation, and not the master state.
    await expect(page.getByTestId("drawer-context")).toHaveAttribute("data-context", "dataset");
    await expect(page.getByTestId("observation-history")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    // ...and the research state behind it is untouched.
    await expect(page.getByTestId("evidence-grid")).toBeVisible();
  });

  test("an unknown state stays unknown all the way to the evidence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);

    await expect(page.getByTestId("page-states")).toContainText("ไม่ทราบ");
    await page.getByTestId("signal-unknown").click();
    await evidenceSettled(page);
    const card = page.locator('[data-testid^="ad-card-"]').first();
    await expect(card.locator('[data-status="unknown"]')).toBeVisible();
    // The one ad whose state the collector could not read is never shown as
    // Inactive anywhere on the path.
    await expect(card.locator('[data-status="false"]')).toHaveCount(0);
  });

  /* -------------------------------------------------------------- security */

  test("the page ads route refuses a signed-out caller and a malformed id", async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const out = await anonymous.newPage();
    const denied = await out.request.get(`/api/pages/${FIXTURE_PAGE}/ads?scope=all`);
    expect(denied.status()).toBe(401);
    await anonymous.close();

    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const bad = await page.request.get("/api/pages/not-a-page-id/ads?scope=all");
    expect(bad.status()).toBe(400);
    const badSignal = await page.request.get(
      `/api/pages/${FIXTURE_PAGE}/ads?scope=all&signal=winning`,
    );
    // An unrecognised signal is refused, never ignored: ignoring it would return
    // every ad under a heading that promises a subset.
    expect(badSignal.status()).toBe(400);
    await context.close();
  });

  /* ------------------------------------------------------------ responsive */

  test("the surface works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      await page.goto(`/pages?scope=dataset:${datasetId}`);
      await expect(page.getByTestId("page-list")).toBeVisible();
      expect(await overflows(), `page list overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`page-list-${suffix}`), fullPage: true, animations: "disabled" });

      await page.goto(`/pages/${FIXTURE_PAGE}?scope=dataset:${datasetId}`);
      await expect(page.getByTestId("kpi-observed")).toBeVisible();
      await evidenceSettled(page);
      expect(await overflows(), `page detail overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`page-detail-${suffix}`), fullPage: true, animations: "disabled" });

      if (suffix === "375") {
        await page.getByTestId("signal-tabs").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("signals-375"), animations: "disabled" });
        await evidenceSettled(page);
        await page.getByTestId("evidence-grid").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("evidence-ads-375"), animations: "disabled" });
      }
    }
  });
});
