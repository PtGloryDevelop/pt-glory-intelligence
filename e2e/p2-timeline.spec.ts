import { expect, test, type Browser, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * P2.2 — the page timeline.
 *
 * The invariant under test everywhere below is reconciliation: a number on the
 * chart or in the run table opens exactly the ads it counted, never
 * approximately. The rest of the cases hold the three clocks apart, because a
 * timeline that quietly substitutes one for another looks entirely plausible
 * and is entirely wrong.
 */

const OUT = join("test-artifacts", "visual", "p2-timeline");
const shot = (name: string) => join(OUT, `${name}.png`);

/** The timeline pair has its own page, so no other spec adds runs to its history. */
const FIXTURE_PAGE = "720000000000001";

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

/** How many ads a link claims, read off the link itself. */
async function claimed(locator: ReturnType<Page["locator"]>): Promise<number> {
  return Number((await locator.innerText()).replace(/\D+/g, ""));
}

test.describe("P2.2 page timeline", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let firstDataset = "";
  const scopeAll = "all";

  test.beforeAll(async ({ browser }) => {
    // Two runs of the same page, a few days apart, under different queries.
    firstDataset = await importFixture(browser, join(TMP, "pages-timeline-a.json"), "tl-first");
    await importFixture(browser, join(TMP, "pages-timeline-b.json"), "tl-second");
  });

  const timeline = (scope: string, extra = "") =>
    `/pages/${FIXTURE_PAGE}?scope=${scope}&view=timeline${extra}`;

  /* ------------------------------------------------------------- structure */

  test("the timeline is a view of the page, reached from it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${FIXTURE_PAGE}?scope=${scopeAll}`);

    // Overview owns the KPIs; the timeline does not repeat them.
    await expect(page.getByTestId("kpi-observed")).toBeVisible();
    await page.getByTestId("tab-timeline").click();
    await page.waitForURL(/view=timeline/);
    await expect(page.getByTestId("kpi-observed")).toHaveCount(0);

    // The page identity and its scope caveat belong to both views.
    await expect(page.getByTestId("page-identity")).toHaveText(FIXTURE_PAGE);
    await expect(page.getByTestId("scope-basis")).toBeVisible();
    await expect(page.getByTestId("timeline-chart")).toBeVisible();

    await page.screenshot({ path: shot("timeline-1440"), fullPage: true, animations: "disabled" });
  });

  test("each series says which clock it counts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const chart = page.getByTestId("timeline-chart");
    await expect(chart).toContainText("เริ่มแสดง");
    await expect(chart).toContainText("PT Glory พบครั้งแรก");
    // The first-seen series must say it is global, because it is: the ad may
    // have been seen in a run outside this scope.
    await expect(page.locator("body")).toContainText("ทุกรอบเก็บ");
    // ...and nothing anywhere claims the advertiser did something.
    await expect(page.locator("body")).not.toContainText("เข้าตลาด");
    await expect(page.locator("body")).not.toContainText("เร่งยิง");
  });

  test("range and grain are deterministic and live in the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));
    // The default hides nothing, and a long span is weekly.
    await expect(page.getByTestId("timeline-period")).toContainText("ทั้งหมด");
    await expect(page.getByTestId("timeline-period")).toContainText("รายสัปดาห์");

    await page.getByTestId("range-90d").click();
    await page.waitForURL(/range=90d/);
    // 90 days is short enough to read daily, so the grain follows the span.
    await expect(page.getByTestId("timeline-period")).toContainText("รายวัน");

    await page.getByTestId("grain-week").click();
    await page.waitForURL(/grain=week/);
    await expect(page.getByTestId("timeline-period")).toContainText("รายสัปดาห์");
  });

  /* -------------------------------------------------------- reconciliation */

  test("a started bucket opens exactly the ads it counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const bucket = page.locator('[data-testid^="bucket-started-"]').first();
    const n = await claimed(bucket);
    expect(n).toBeGreaterThan(0);
    await bucket.click();
    await page.waitForURL(/metric=started/);

    await expect(page.getByTestId("bucket-evidence")).toBeVisible();
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
    // The heading names the clock, so the rows cannot be read as the other one.
    await expect(page.getByTestId("selection-source")).toContainText("Meta");

    await page.screenshot({ path: shot("started-bucket-1440"), animations: "disabled" });
  });

  test("a first-seen bucket opens exactly the ads it counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const bucket = page.locator('[data-testid^="bucket-first-seen-"]').first();
    const n = await claimed(bucket);
    await bucket.click();
    await page.waitForURL(/metric=first_seen/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
    await expect(page.getByTestId("selection-source")).toContainText("PT Glory");

    await page.screenshot({ path: shot("first-seen-bucket-1440"), animations: "disabled" });
  });

  test("a run's observed count opens exactly the ads that run saw", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const runs = page.getByTestId("run-history");
    await expect(runs).toBeVisible();
    await expect(runs.locator("tbody tr")).toHaveCount(2);
    await page.screenshot({ path: shot("collection-runs-1440"), animations: "disabled" });

    const observed = page.locator('[data-testid^="run-observed-"]').first();
    const n = await claimed(observed);
    await observed.click();
    await page.waitForURL(/metric=run/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);

    await page.screenshot({ path: shot("selected-run-1440"), animations: "disabled" });
  });

  test("each state in a run opens exactly that state, unknown included", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const row = page.getByTestId("run-history").locator("tbody tr").first();
    const runId = (await row.getAttribute("data-testid"))!.replace("run-row-", "");

    for (const state of ["active", "inactive", "unknown"] as const) {
      await page.goto(timeline(scopeAll));
      const link = page.getByTestId(`run-${state}-${runId}`);
      const n = await claimed(link);
      await link.click();
      await page.waitForURL(new RegExp(`status=${state}`));

      if (n === 0) {
        await expect(page.getByTestId("bucket-empty")).toBeVisible();
        continue;
      }
      await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
      // The state shown is the one that run read, said plainly.
      await expect(page.getByTestId("selection-source")).toContainText("ไม่ใช่สถานะปัจจุบัน");
    }

    await page.screenshot({ path: shot("status-by-run-1440"), animations: "disabled" });
  });

  test("a status seen at one moment is not the ad's status now", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const rows = page.getByTestId("run-history").locator("tbody tr");
    // The later run saw one ad stop and one become unreadable; the earlier one
    // saw neither. Same ads, two moments, two answers.
    const newest = rows.first();
    const oldest = rows.last();
    const activeNewest = await claimed(newest.locator('[data-testid^="run-active-"]'));
    const activeOldest = await claimed(oldest.locator('[data-testid^="run-active-"]'));
    expect(activeOldest).not.toBe(activeNewest);

    // Unknown is never folded into inactive at any point on the timeline.
    const unknownNewest = await claimed(newest.locator('[data-testid^="run-unknown-"]'));
    expect(unknownNewest).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------ comparability */

  test("runs collected under different queries are flagged, not smoothed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    const note = page.getByTestId("comparability-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("คำค้น");
    await expect(note).toContainText("ไม่ใช่การเปลี่ยนแปลงของเพจ");
    // Both queries are on screen, so the reader can judge for themselves.
    await expect(page.getByTestId("run-history")).toContainText("คอลลาเจนทดสอบ");
  });

  test("a dataset scope has one run, and still spans years of start dates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(`dataset:${firstDataset}`));

    await expect(page.getByTestId("scope-basis")).toContainText("รอบเก็บของ Dataset นี้");
    await expect(page.getByTestId("run-history").locator("tbody tr")).toHaveCount(1);
    // One collection point is the honest answer for one run — and the ads in it
    // still started years apart, because that is a property of the ads.
    const buckets = await page.getByTestId("timeline-bucket").count();
    expect(buckets).toBeGreaterThan(1);
    await expect(page.getByTestId("comparability-note")).toHaveCount(0);

    await page.screenshot({ path: shot("dataset-scope-1440"), fullPage: true, animations: "disabled" });
  });

  /* ------------------------------------------------------------- coverage */

  test("a run's mix carries that run's own coverage", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));
    await page.locator('[data-testid^="run-observed-"]').first().click();
    await page.waitForURL(/metric=run/);

    // Three of the six ads that run saw had a readable CTA, so the wording is
    // scoped to those three rather than to the page.
    const cta = page.getByTestId("run-mix-cta-qualifier");
    await expect(cta).toHaveAttribute("data-tier", "partial");
    await expect(cta).toContainText("ไม่ใช่ทั้งเพจ");
    await expect(page.getByTestId("run-mix-cta-denominator")).toContainText("3 / 6");
    await expect(page.getByTestId("run-mix-platform-qualifier")).toContainText("เกิน 100% ได้");

    await page.screenshot({ path: shot("partial-coverage-bucket-1440"), animations: "disabled" });
  });

  /* ------------------------------------------------------------- evidence */

  test("an ad from a bucket opens in the frozen drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(`dataset:${firstDataset}`));
    await page.locator('[data-testid^="bucket-started-"]').first().click();
    await page.getByTestId("bucket-evidence").waitFor();

    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    await expect(page.getByTestId("drawer-context")).toHaveAttribute("data-context", "dataset");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    // The selection behind it survives, because it is in the URL.
    await expect(page.getByTestId("bucket-evidence")).toBeVisible();
  });

  test("the selection survives a reload, because it is the address", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));
    await page.locator('[data-testid^="bucket-started-"]').first().click();
    await page.waitForURL(/bucket=/);

    const heading = await page.getByTestId("selection-source").innerText();
    const count = await page.locator('[data-testid^="ad-card-"]').count();
    await page.reload();
    await expect(page.getByTestId("selection-source")).toHaveText(heading);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(count);
  });

  /* ------------------------------------------------------- accessibility */

  test("every bucket is readable and operable without a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(timeline(scopeAll));

    // The drawing is decoration; the numbers exist as real DOM.
    await expect(page.locator('[data-testid="timeline-chart"] svg')).toHaveAttribute("aria-hidden", "true");
    const table = page.getByTestId("timeline-chart-buckets");
    await expect(table).toBeVisible();
    await expect(table.locator("th[scope='col']")).toHaveCount(3);

    // A bucket link takes focus and a visible ring, and Enter opens it.
    const bucket = page.locator('[data-testid^="bucket-started-"]').first();
    await bucket.focus();
    const ring = await bucket.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(ring).toBe("rgb(29, 78, 216)");
    await page.keyboard.press("Enter");
    await page.waitForURL(/metric=started/);
    await expect(page.getByTestId("bucket-evidence")).toBeVisible();
  });

  /* ------------------------------------------------------------ responsive */

  test("the timeline works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(timeline(scopeAll));
      await expect(page.getByTestId("timeline-chart")).toBeVisible();
      expect(await overflows(), `timeline overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`timeline-${suffix}`), fullPage: true, animations: "disabled" });

      const bucket = page.locator('[data-testid^="bucket-started-"]').first();
      const n = await claimed(bucket);
      await bucket.click();
      await page.waitForURL(/metric=started/);
      await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
      expect(await overflows(), `bucket evidence overflows at ${width}px`).toBe(false);

      if (suffix === "375") {
        await page.screenshot({ path: shot("selected-bucket-375"), animations: "disabled" });
        await page.getByTestId("bucket-evidence").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("evidence-375"), animations: "disabled" });
      } else {
        await page.goto(timeline(scopeAll));
        await page.locator('[data-testid^="run-observed-"]').first().click();
        await page.waitForURL(/metric=run/);
        await page.screenshot({ path: shot("selected-run-768"), fullPage: true, animations: "disabled" });
      }
    }
  });
});
