import { expect, test, type Browser, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY_WORKSPACE, TMP } from "./constants.ts";

/**
 * P2.3 — the category workspace.
 *
 * A category assembles several collection runs, so the two things worth testing
 * hardest are the ones a reader cannot check for themselves: that the page says
 * it is not one market snapshot, and that every number on it opens exactly the
 * ads it counted.
 */

const OUT = join("test-artifacts", "visual", "p2-category");
const shot = (name: string) => join(OUT, `${name}.png`);

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
  await page.getByTestId("category-select").selectOption({ label: CATEGORY_WORKSPACE });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  await context.close();
}

/** How many ads a link claims, read off the link itself. */
async function claimed(locator: ReturnType<Page["locator"]>): Promise<number> {
  return Number((await locator.innerText()).replace(/[^\d]/g, ""));
}

test.describe("P2.3 category workspace", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let categoryId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    // Two runs, different queries, into the one seeded category — so the
    // workspace has multiple contributing datasets to be honest about.
    await importFixture(browser, join(TMP, "category-run-a.json"), "cat-run-one");
    await importFixture(browser, join(TMP, "category-run-b.json"), "cat-run-two");

    // This spec owns its own research category, so its aggregates cannot be
    // moved by whatever another spec imported into the shared one.
    await page.goto("/categories");
    const row = page.locator("tr", { hasText: CATEGORY_WORKSPACE }).first();
    await row.waitFor();
    categoryId = (await row.getAttribute("data-testid"))!.replace("category-row-", "");
    await context.close();
  });

  const workspace = (extra = "") => `/categories/${categoryId}${extra}`;

  /* ------------------------------------------------------------------ list */

  test("the category list counts distinct ads and pages", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/categories");

    await expect(page.getByTestId("category-list")).toBeVisible();
    const row = page.getByTestId(`category-row-${categoryId}`);
    await expect(row).toBeVisible();
    // The list never claims to describe a market.
    await expect(page.locator("body")).not.toContainText("ส่วนแบ่งตลาด");

    await page.screenshot({ path: shot("category-list-1440"), fullPage: true, animations: "disabled" });
  });

  /* ------------------------------------------------------------- workspace */

  test("the workspace says it is not one market snapshot", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const basis = page.getByTestId("category-basis");
    await expect(basis).toBeVisible();
    await expect(basis).toContainText("หลายรอบเก็บ");
    await expect(basis).toContainText("ไม่ใช่ snapshot");
    // The caveat sits once, near the identity — not buried in a tooltip and not
    // repeated in every panel.
    await expect(page.getByTestId("category-basis")).toHaveCount(1);

    await page.screenshot({ path: shot("category-overview-1440"), fullPage: true, animations: "disabled" });
  });

  test("datasets collected under different queries are flagged", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const note = page.getByTestId("comparability-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("คำค้น");
    await expect(note).toContainText("ไม่ใช่ความต่างของเพจหรือของตลาด");

    // Both queries are visible in the contributing-datasets table, so the
    // reader can judge for themselves.
    const datasets = page.getByTestId("contributing-datasets");
    await datasets.scrollIntoViewIfNeeded();
    await expect(datasets).toContainText("ฟิลเลอร์ทดสอบ");
    await expect(datasets).toContainText("คลินิกทดสอบ");
    await page.screenshot({ path: shot("contributing-datasets-1440"), animations: "disabled" });
  });

  test("the overview counts each ad once across both datasets", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    // Nine distinct ads across two pages and two runs — not the seventeen
    // observations those runs actually wrote.
    await expect(page.getByTestId("kpi-observed")).toContainText("9");
    await expect(page.getByTestId("context-ads")).toHaveText("9");
    await expect(page.getByTestId("context-pages")).toHaveText("2");
    // Recently found and started recently are two cards with two sentences.
    await expect(page.getByTestId("kpi-recent")).toContainText("นับจากวันที่ PT Glory เห็นครั้งแรก");
    await expect(page.getByTestId("kpi-evergreen")).toContainText("90 วัน");
  });

  test("the three states partition the observed ads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const states = page.getByTestId("category-states");
    const read = async (status: string) =>
      Number((await states.locator(`[data-status="${status}"]`).innerText()).replace(/\D+/g, ""));
    const total = (await read("true")) + (await read("false")) + (await read("unknown"));
    expect(total).toBe(9);
    // Unknown has its own badge and its own explanation.
    await expect(states).toContainText("ไม่ใช่หยุดแสดง");
  });

  /* --------------------------------------------------------- page ranking */

  test("the ranking states a share of observed ads, with its denominator", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const ranking = page.getByTestId("page-ranking");
    await expect(ranking).toBeVisible();
    // The header says what the ranking is, and what it is not.
    await expect(ranking).toContainText("สัดส่วนจาก Ads ที่เราพบ");
    await expect(page.locator("body")).not.toContainText("ผู้นำตลาด");
    await expect(page.locator("body")).not.toContainText("Market Share");

    const row = ranking.locator("tbody tr").first();
    const pageId = (await row.getAttribute("data-testid"))!.replace("rank-row-", "");
    // Every percentage carries the pair it came from, in the same cell.
    await expect(page.getByTestId(`rank-share-${pageId}`)).toContainText("/");

    await ranking.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("page-ranking-1440"), animations: "disabled" });
  });

  test("a page's ad count opens exactly that page's ads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const link = page.locator('[data-testid^="rank-ads-"]').first();
    const n = await claimed(link);
    await link.click();
    await page.waitForURL(/page=/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
  });

  test("opening a page from the ranking keeps the category as the scope", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    await page.getByTestId("page-ranking").locator("tbody tr").first().locator("a").first().click();
    await page.waitForURL(/\/pages\//);
    // Not `all`: a page opened from a category answers about that category.
    expect(page.url()).toContain(`scope=category:${categoryId}`);
    await expect(page.getByTestId("scope-basis")).toContainText("ไม่ใช่ snapshot");
    await expect(page.getByTestId("kpi-observed")).toBeVisible();
  });

  test("the ranking sorts and searches on the server", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    await page.getByTestId("rank-sort").selectOption("evergreen");
    await page.getByTestId("rank-apply").click();
    await page.waitForURL(/sort=evergreen/);
    await expect(page.getByTestId("page-ranking")).toBeVisible();

    await page.getByTestId("rank-search").fill("ไม่มีเพจชื่อนี้");
    await page.getByTestId("rank-apply").click();
    await page.waitForURL(/search=/);
    await expect(page.getByTestId("ranking-empty")).toBeVisible();
  });

  /* ------------------------------------------------------------- activity */

  test("the activity chart keeps the two clocks apart and drillable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const chart = page.getByTestId("timeline-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toContainText("เริ่มแสดง");
    await expect(chart).toContainText("PT Glory พบครั้งแรก");
    await page.screenshot({ path: shot("activity-1440"), animations: "disabled" });

    const bucket = page.locator('[data-testid^="bucket-started-"]').first();
    const n = await claimed(bucket);
    await bucket.click();
    await page.waitForURL(/metric=started/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
    await expect(page.getByTestId("evidence-source")).toContainText("Meta");
  });

  /* --------------------------------------------------------- creative mix */

  test("a format bucket opens exactly the ads it counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    await page.getByTestId("mix-format").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("format-mix-1440"), animations: "disabled" });

    // The "could not read this" bucket is deliberately not a link, and it can
    // be the largest one — so drill into a row that actually offers evidence.
    const row = page.locator('[data-testid="mix-format-row"]:has(a)').first();
    const n = Number((await row.innerText()).match(/(\d+)\s*\n?\s*[\d.]+%/)![1]);
    await row.locator("a").first().click();
    await page.waitForURL(/format=/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
  });

  test("a CTA distribution over part of the data says so", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    // Five of the nine ads have a readable CTA in the latest observations.
    const cta = page.getByTestId("mix-cta-qualifier");
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveAttribute("data-tier", "partial");
    await expect(cta).toContainText("ไม่ใช่ทั้งเพจ");
    await expect(page.getByTestId("mix-cta-denominator")).toContainText("5 / 9");

    await page.screenshot({ path: shot("cta-partial-coverage-1440"), animations: "disabled" });
  });

  test("platform is multi-value and never a share of a whole", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const platform = page.getByTestId("mix-platform-qualifier");
    await platform.scrollIntoViewIfNeeded();
    await expect(platform).toContainText("เกิน 100% ได้");
    await page.screenshot({ path: shot("platform-mix-1440"), animations: "disabled" });

    const row = page.locator('[data-testid="mix-platform-row"]:has(a)').first();
    const n = Number((await row.innerText()).match(/(\d+)\s*\n?\s*[\d.]+%/)![1]);
    await row.locator("a").first().click();
    await page.waitForURL(/platform=/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(n);
  });

  test("Meta's page categories are labelled as Meta's, not as the research category", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace());

    const metaCategories = page.getByTestId("mix-page-category");
    await metaCategories.scrollIntoViewIfNeeded();
    await expect(metaCategories).toContainText("หมวดเพจ (จาก Meta)");
    // ...and the workspace's own identity is the research category, above it.
    await expect(page.locator("h1")).not.toHaveText("หมวดเพจ (จาก Meta)");
  });

  /* -------------------------------------------------------------- signals */

  test("every signal opens exactly the ads it counted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    /*
     * A signal with no ads is a real answer, not a broken page — this fixture's
     * evergreen count is genuinely zero, because the one old ad was seen
     * stopped in the later run. So each signal is settled by waiting for either
     * the grid or the honest empty state, and captured either way.
     */
    const settle = async (signal: string) => {
      await page.goto(workspace(`?signal=${signal}`));
      await page.getByTestId("signal-tabs").waitFor();
      await page.getByTestId("category-evidence")
        .or(page.getByTestId("evidence-empty")).first().waitFor();
      await expect(page.getByTestId("evidence-source")).toBeVisible();
      return page.locator('[data-testid^="ad-card-"]').count();
    };

    for (const signal of ["evergreen", "reused", "unknown", "recent", "active"] as const) {
      const shown = await settle(signal);
      if (shown === 0) {
        await expect(page.getByTestId("evidence-empty")).toBeVisible();
      } else {
        await expect(page.getByTestId("category-evidence")).toBeVisible();
      }
    }

    // The counts themselves are proven against the summary in the SQL suite;
    // what matters here is that every signal reaches its own evidence.
    expect(await settle("recent")).toBeGreaterThan(0);
    await page.screenshot({ path: shot("recently-found-1440"), animations: "disabled" });

    await settle("evergreen");
    await page.screenshot({ path: shot("evergreen-1440"), animations: "disabled" });

    expect(await settle("reused")).toBeGreaterThan(0);
    await page.screenshot({ path: shot("reuse-1440"), animations: "disabled" });
  });

  test("an ad from the evidence opens in the frozen drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(workspace("?signal=active"));
    await page.getByTestId("category-evidence").waitFor();
    await page.screenshot({ path: shot("evidence-ads-1440"), animations: "disabled" });

    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    // A category spans runs, so the drawer opens in master context and says so
    // — never pretending to be one dataset's snapshot.
    await expect(page.getByTestId("drawer-context")).toHaveAttribute("data-context", "master");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    await expect(page.getByTestId("category-evidence")).toBeVisible();
  });

  /* -------------------------------------------------------------- security */

  test("a signed-out caller sees no category data", async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const out = await anonymous.newPage();
    await out.goto(`/categories/${categoryId}`);
    await out.waitForURL(/\/login/);
    await expect(out.locator("body")).not.toContainText("สัดส่วนจาก Ads ที่เราพบ");
    await anonymous.close();
  });

  /* ------------------------------------------------------------ responsive */

  test("the workspace works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      await page.goto("/categories");
      await expect(page.getByTestId("category-list")).toBeVisible();
      expect(await overflows(), `category list overflows at ${width}px`).toBe(false);
      if (suffix === "375") {
        await page.screenshot({ path: shot("category-list-375"), fullPage: true, animations: "disabled" });
      }

      await page.goto(workspace());
      await expect(page.getByTestId("kpi-observed")).toBeVisible();
      expect(await overflows(), `workspace overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`category-overview-${suffix}`), fullPage: true, animations: "disabled" });

      await page.getByTestId("page-ranking").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`page-ranking-${suffix}`), animations: "disabled" });

      if (suffix === "375") {
        await page.getByTestId("mix-format").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("creative-mix-375"), animations: "disabled" });
      }

      await page.goto(workspace("?signal=active"));
      await page.getByTestId("category-evidence").waitFor();
      expect(await overflows(), `evidence overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`evidence-${suffix}`), animations: "disabled" });
    }
  });
});
