import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY_COMPARE, TMP } from "./constants.ts";

/**
 * P2.4 — Page vs Page.
 *
 * Compare adds no definition, so the cases below test the two things that could
 * still go wrong: that both sides are always read under one identical scope and
 * period, and that every compared number opens exactly the ads it counted on
 * exactly the side that claimed it.
 */

const OUT = join("test-artifacts", "visual", "p2-compare");
const shot = (name: string) => join(OUT, `${name}.png`);

/** The pages the category fixtures carry: A has six ads, B has three. */
const PAGE_A = "730000000000001";
const PAGE_B = "730000000000002";

async function importFixture(page: Page, file: string, name: string) {
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY_COMPARE });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  return page.url().split("/").pop()!;
}

const read = async (locator: ReturnType<Page["locator"]>) =>
  Number((await locator.innerText()).replace(/[^\d]/g, ""));

test.describe("P2.4 page compare", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let categoryId = "";
  let firstDataset = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    // Its own category, so no other spec can move these numbers.
    firstDataset = await importFixture(page, join(TMP, "category-run-a.json"), "cmp-run-one");
    await importFixture(page, join(TMP, "category-run-b.json"), "cmp-run-two");

    await page.goto("/categories");
    const row = page.locator("tr", { hasText: CATEGORY_COMPARE }).first();
    await row.waitFor();
    categoryId = (await row.getAttribute("data-testid"))!.replace("category-row-", "");
    await context.close();
  });

  const scope = () => `category:${categoryId}`;
  const compare = (extra = "") =>
    `/compare?scope=${scope()}&a=${PAGE_A}&b=${PAGE_B}${extra}`;

  /* -------------------------------------------------------------- chooser */

  test("the chooser asks for one scope and two pages, in that order", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/compare");

    await expect(page.getByTestId("compare-chooser")).toBeVisible();
    // Pages cannot be chosen before the scope they live in.
    await expect(page.getByTestId("compare-a")).toBeDisabled();
    await expect(page.getByTestId("compare-go")).toBeDisabled();
    await page.screenshot({ path: shot("chooser-1440"), fullPage: true, animations: "disabled" });

    await page.getByTestId("compare-scope").selectOption(scope());
    await page.waitForURL(/scope=category/);
    await expect(page.getByTestId("compare-a")).toBeEnabled();

    await page.getByTestId("compare-a").selectOption(PAGE_A);
    await page.getByTestId("compare-b").selectOption(PAGE_B);
    await page.getByTestId("compare-go").click();

    await page.waitForURL(/a=.*b=/);
    await expect(page.getByTestId("compare-matrix")).toBeVisible();
  });

  test("the same page on both sides is refused, not rendered", async ({ page }) => {
    await page.goto(`/compare?scope=${scope()}&a=${PAGE_A}&b=${PAGE_A}`);
    await expect(page.getByTestId("compare-refused-same-page")).toBeVisible();
    await expect(page.getByTestId("compare-matrix")).toHaveCount(0);
  });

  test("a page outside the scope is refused, never shown as zero", async ({ page }) => {
    // A page that exists elsewhere in the product but not in this category.
    await page.goto(`/compare?scope=${scope()}&a=${PAGE_A}&b=710000000000001`);
    const refusal = page.getByTestId("compare-refused-missing");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("ไม่ใช่ว่าพบ 0");
    await expect(page.getByTestId("compare-matrix")).toHaveCount(0);
  });

  test("a malformed page id falls back to the chooser", async ({ page }) => {
    await page.goto(`/compare?scope=${scope()}&a=${PAGE_A}&b=not-a-page`);
    await expect(page.getByTestId("compare-chooser")).toBeVisible();
  });

  /* --------------------------------------------------------------- matrix */

  test("the matrix aligns both sides and states arithmetic deltas", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    const matrix = page.getByTestId("compare-matrix");
    await expect(matrix).toBeVisible();

    // Six ads against three, and the delta is a subtraction stated as one.
    const a = await read(page.getByTestId("cell-observed-a"));
    const b = await read(page.getByTestId("cell-observed-b"));
    expect(a).toBe(6);
    expect(b).toBe(3);
    await expect(page.getByTestId("delta-observed")).toHaveText(`A มากกว่า ${a - b} รายการ`);

    // Recently found and started recently stay two rows.
    await expect(page.getByTestId("row-recent")).toContainText("เราเห็นครั้งแรก");
    await expect(page.getByTestId("row-started_recently")).toContainText("Meta");

    // Nothing anywhere calls a side a winner.
    for (const word of ["ชนะ", "เหนือกว่า", "ดีกว่า", "Market Share", "Top Performing"]) {
      await expect(page.locator("body")).not.toContainText(word);
    }

    await page.screenshot({ path: shot("summary-1440"), fullPage: true, animations: "disabled" });
  });

  test("swap exchanges the sides and keeps everything else", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare("&recentDays=7&clock=first_seen&range=90d"));

    const before = await read(page.getByTestId("cell-observed-a"));
    await page.getByTestId("compare-swap").click();
    await page.waitForURL(new RegExp(`a=${PAGE_B}`));

    // The sides changed places; the research state did not.
    expect(await read(page.getByTestId("cell-observed-b"))).toBe(before);
    expect(page.url()).toContain("recentDays=7");
    expect(page.url()).toContain("clock=first_seen");
    expect(page.url()).toContain("range=90d");
  });

  test("the scope caveat is stated once, and the scope is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());
    await expect(page.getByTestId("scope-label")).toContainText("หมวดหมู่");
    const basis = page.getByTestId("scope-basis");
    await expect(basis).toHaveCount(1);
    await expect(basis).toContainText("ไม่ใช่ snapshot");
    await page.screenshot({ path: shot("category-context-1440"), animations: "disabled" });
  });

  test("a dataset scope compares that dataset's own observations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/compare?scope=dataset:${firstDataset}&a=${PAGE_A}&b=${PAGE_B}`);

    await expect(page.getByTestId("scope-basis")).toContainText("รอบเก็บของ Dataset นี้");
    // The first run saw five ads for A; the later run added one. Dataset scope
    // still answers with five.
    expect(await read(page.getByTestId("cell-observed-a"))).toBe(5);
    await page.screenshot({ path: shot("dataset-snapshot-1440"), fullPage: true, animations: "disabled" });
  });

  /* ------------------------------------------------------------- evidence */

  test("every matrix cell opens exactly the ads it counted, per side", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    for (const metric of ["recent", "evergreen", "reused", "unknown", "active"] as const) {
      for (const side of ["a", "b"] as const) {
        await page.goto(compare());
        const cell = page.getByTestId(`cell-${metric}-${side}`);
        const claimed = await read(cell);
        if (claimed === 0) continue;

        await cell.click();
        await page.waitForURL(new RegExp(`metric=${metric}`));
        await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
        // The heading names the side it is showing.
        await expect(page.getByTestId(`evidence-${side}`)).toBeVisible();
      }
    }

    await page.goto(compare("&metric=recent&side=a"));
    await page.getByTestId("evidence-a").waitFor();
    await page.screenshot({ path: shot("evidence-a-1440"), animations: "disabled" });

    await page.goto(compare("&metric=evergreen&side=b"));
    await page.getByTestId("evidence-source").waitFor();
    await page.screenshot({ path: shot("evergreen-reuse-1440"), animations: "disabled" });
  });

  test("an ad from either side opens the frozen drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const side of ["a", "b"] as const) {
      await page.goto(compare(`&metric=observed&side=${side}`));
      await page.getByTestId(`evidence-${side}`).waitFor();
      await page.locator('[data-testid^="open-ad-"]').first().click();
      await page.getByTestId("ad-drawer").waitFor();
      // A category spans runs, so the drawer opens in master context.
      await expect(page.getByTestId("drawer-context")).toHaveAttribute("data-context", "master");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    }
  });

  /* ---------------------------------------------------------------- mix */

  test("each side keeps its own coverage, and the weaker one sets the wording", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    const cta = page.getByTestId("mix-cta");
    await cta.scrollIntoViewIfNeeded();
    // A reads a CTA on three of six; B on two of three. Two denominators, shown.
    await expect(page.getByTestId("mix-cta-coverage")).toContainText("A อ่านค่าได้ 3 / 6");
    await expect(page.getByTestId("mix-cta-coverage")).toContainText("B อ่านค่าได้ 2 / 3");
    await expect(page.getByTestId("mix-cta-qualifier")).toContainText("ความครอบคลุมสองฝั่งไม่เท่ากัน");

    await page.screenshot({ path: shot("cta-asymmetric-1440"), animations: "disabled" });
  });

  test("a format bucket opens exactly that side's ads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    await page.getByTestId("mix-format").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("format-1440"), animations: "disabled" });

    const link = page.locator('[data-testid^="mix-format-evidence-a-"]').first();
    const claimed = await read(link);
    await link.click();
    await page.waitForURL(/dim=format/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
  });

  test("platform is multi-value and never a share of a whole", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    const platform = page.getByTestId("mix-platform-qualifier");
    await platform.scrollIntoViewIfNeeded();
    await expect(platform).toContainText("เกิน 100% ได้");
    await expect(platform).toContainText("ไม่ใช่สัดส่วนที่แบ่งกัน");
    await page.screenshot({ path: shot("platform-1440"), animations: "disabled" });
  });

  /* ------------------------------------------------------------ timeline */

  test("one clock at a time, the same one for both sides", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    const chart = page.getByTestId("compare-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("compare-chart-clock")).toContainText("เริ่มแสดง");
    await expect(page.getByTestId("compare-chart-clock")).toContainText("Meta");
    await page.screenshot({ path: shot("timeline-started-1440"), animations: "disabled" });

    await page.getByTestId("clock-first_seen").click();
    await page.waitForURL(/clock=first_seen/);
    await expect(page.getByTestId("compare-chart-clock")).toContainText("PT Glory พบครั้งแรก");
    await page.screenshot({ path: shot("timeline-first-seen-1440"), animations: "disabled" });
  });

  test("a timeline bucket opens exactly that side's ads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    const bucket = page.locator('[data-testid^="compare-bucket-a-"]').first();
    const claimed = await read(bucket);
    await bucket.click();
    await page.waitForURL(/bucket=/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
    await expect(page.getByTestId("evidence-source")).toContainText("Meta");
  });

  test("the whole research state survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare("&clock=first_seen&range=90d&metric=evergreen&side=a"));
    const heading = await page.getByTestId("evidence-source").innerText();
    const cards = await page.locator('[data-testid^="ad-card-"]').count();

    await page.reload();
    await expect(page.getByTestId("evidence-source")).toHaveText(heading);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(cards);
    await expect(page.getByTestId("clock-first_seen")).toBeVisible();
  });

  /* -------------------------------------------------------- entry point */

  test("Page Detail offers compare and keeps its scope", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/pages/${PAGE_A}?scope=${scope()}`);
    await page.getByTestId("compare-with").click();
    await page.waitForURL(/\/compare/);
    // The scope and the page came with it; only the second side is missing.
    expect(page.url()).toContain(`scope=category:${categoryId}`);
    expect(page.url()).toContain(`a=${PAGE_A}`);
    await expect(page.getByTestId("compare-chooser")).toBeVisible();
  });

  /* ----------------------------------------------------- accessibility */

  test("the comparison is operable and readable without a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(compare());

    // The swap control says what it does, not just "swap".
    await expect(page.getByTestId("compare-swap"))
      .toHaveAttribute("aria-label", /สลับด้าน/);

    // The chart's drawing is decoration; its numbers are a real table.
    await expect(page.locator('[data-testid="compare-chart"] svg'))
      .toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("compare-chart-buckets")).toBeVisible();

    /*
     * Reached by Tab, not by a script calling focus().
     *
     * :focus-visible is the state a keyboard user is actually in, and a
     * programmatic focus after a click is not it — so tabbing is both the
     * honest reachability test and the only way to see the real ring.
     */
    // A row whose count is non-zero on this side: a zero is rendered as plain
    // text rather than a link, because there is nothing behind it to open.
    const cell = page.getByTestId("cell-recent-a");
    let reached = false;
    for (let step = 0; step < 160 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await cell.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the matrix cell must be reachable by keyboard").toBe(true);
    expect(await cell.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    expect(await cell.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(29, 78, 216)");

    await page.keyboard.press("Enter");
    await page.waitForURL(/metric=recent/);
    await expect(page.getByTestId("evidence-a")).toBeVisible();
  });

  /* ------------------------------------------------------------ responsive */

  test("compare works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      if (suffix === "375") {
        await page.goto("/compare");
        await expect(page.getByTestId("compare-chooser")).toBeVisible();
        expect(await overflows(), `chooser overflows at ${width}px`).toBe(false);
        await page.screenshot({ path: shot("chooser-375"), fullPage: true, animations: "disabled" });
      }

      await page.goto(compare());
      await expect(page.getByTestId("compare-matrix")).toBeVisible();
      expect(await overflows(), `compare overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`summary-${suffix}`), fullPage: true, animations: "disabled" });

      await page.getByTestId("compare-chart").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`timeline-${suffix}`), animations: "disabled" });

      await page.getByTestId("mix-format").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`mix-${suffix}`), animations: "disabled" });

      await page.goto(compare("&metric=observed&side=a"));
      await page.getByTestId("evidence-a").waitFor();
      expect(await overflows(), `evidence overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`evidence-a-${suffix}`), animations: "disabled" });

      if (suffix === "375") {
        await page.goto(compare("&metric=observed&side=b"));
        await page.getByTestId("evidence-b").waitFor();
        await page.screenshot({ path: shot("evidence-b-375"), animations: "disabled" });
      }
    }
  });
});
