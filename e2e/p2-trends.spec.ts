import { expect, test, type Browser, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY_TRENDS, TMP } from "./constants.ts";

/**
 * P2.5 — Trends.
 *
 * The cases below are mostly about one distinction: an event belongs to a
 * window, a state is only true as of an instant. A screen that blurred the two
 * would look entirely reasonable and be entirely wrong, so every row states
 * which kind it is and the evidence behind it is read the matching way.
 */

const OUT = join("test-artifacts", "visual", "p2-trends");
const shot = (name: string) => join(OUT, `${name}.png`);

/** The trends fixtures: page A gains an ad between the two collections. */
const PAGE_A = "740000000000001";

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
  await page.getByTestId("category-select").selectOption({ label: CATEGORY_TRENDS });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  await context.close();
}

const read = async (locator: ReturnType<Page["locator"]>) =>
  Number((await locator.innerText()).replace(/[^\d]/g, ""));

test.describe("P2.5 trends", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let categoryId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    // 45 days ago and 2 days ago: one collection in each comparison window.
    await importFixture(browser, join(TMP, "trends-old.json"), "tr-old");
    await importFixture(browser, join(TMP, "trends-new.json"), "tr-new");

    await page.goto("/categories");
    const row = page.locator("tr", { hasText: CATEGORY_TRENDS }).first();
    await row.waitFor();
    categoryId = (await row.getAttribute("data-testid"))!.replace("category-row-", "");
    await context.close();
  });

  const trends = (extra = "") => `/trends?scope=category:${categoryId}${extra}`;

  /* -------------------------------------------------------------- chooser */

  test("the chooser asks for a scope before showing any change", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/trends");
    await expect(page.getByTestId("trend-chooser")).toBeVisible();
    await expect(page.getByTestId("trend-summary")).toHaveCount(0);
    // A trend is a comparison of observed data, and the page says so before the
    // reader has picked anything.
    await expect(page.locator("body")).toContainText("ไม่ใช่การพยากรณ์");
    await page.screenshot({ path: shot("chooser-1440"), fullPage: true, animations: "disabled" });

    await page.getByTestId("trend-scope").selectOption(`category:${categoryId}`);
    await page.waitForURL(/scope=category/);
    await expect(page.getByTestId("trend-summary")).toBeVisible();
  });

  /* -------------------------------------------------------------- summary */

  test("the two windows are equal, adjacent and stated", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    await expect(page.getByTestId("current-period")).toBeVisible();
    await expect(page.getByTestId("previous-period")).toBeVisible();
    // One collection landed in each window, which is what makes the comparison
    // meaningful rather than a comparison with nothing.
    await expect(page.getByTestId("current-runs")).toHaveText("1");
    await expect(page.getByTestId("previous-runs")).toHaveText("1");
    await expect(page.locator("body")).toContainText("ความยาวเท่ากันเสมอ");

    await page.screenshot({ path: shot("category-summary-1440"), fullPage: true, animations: "disabled" });
  });

  test("every row says whether it is an event or a state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    await expect(page.getByTestId("kind-first_seen")).toHaveText("เหตุการณ์ในช่วง");
    await expect(page.getByTestId("kind-started")).toHaveText("เหตุการณ์ในช่วง");
    for (const metric of ["observed", "active", "evergreen", "reused", "unknown"] as const) {
      await expect(page.getByTestId(`kind-${metric}`)).toHaveText("สถานะ ณ ปลายช่วง");
    }
    // The two clocks stay two rows.
    await expect(page.getByTestId("row-first_seen")).toContainText("PT Glory");
    await expect(page.getByTestId("row-started")).toContainText("Meta");
  });

  test("a state differs between the two reference points", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    // The later collection saw one ad stopped and one unreadable, so the two
    // reference points cannot report the same thing.
    const activeCurrent = await read(page.getByTestId("cell-active-current"));
    const activePrevious = await read(page.getByTestId("cell-active-previous"));
    expect(activeCurrent).not.toBe(activePrevious);
    // The later run could not read one more state than the earlier one — and
    // "ไม่ทราบ" is its own answer at both reference points, never folded into
    // inactive at either.
    const unknownCurrent = await read(page.getByTestId("cell-unknown-current"));
    const unknownPrevious = await read(page.getByTestId("cell-unknown-previous"));
    expect(unknownCurrent).toBeGreaterThan(unknownPrevious);
  });

  test("a change is arithmetic, with an arrow and no verdict", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    const delta = page.getByTestId("delta-observed");
    await expect(delta).toContainText("ในข้อมูลที่เราพบ");
    // Direction is carried by a mark as well as by words.
    await expect(delta).toContainText(/[▲▼—]/);

    /*
     * Whole words only. "โต" on its own is a fragment of ordinary Thai, and
     * "พยากรณ์" appears on this page as the disclaimer "ไม่ใช่การพยากรณ์" — a
     * page-wide substring scan cannot tell a claim from its denial, so the
     * vocabulary itself is guarded in the unit tests and this checks the
     * phrases that have no innocent reading.
     */
    for (const word of [
      "เติบโต", "ครองตลาด", "ส่วนแบ่งตลาด", "Market Share", "Top Performing", "momentum",
    ]) {
      await expect(page.locator("body")).not.toContainText(word);
    }
  });

  test("changing the period changes both windows together", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());
    await page.getByTestId("days-7").click();
    await page.waitForURL(/days=7/);
    await expect(page.locator("body")).toContainText("เทียบ 7 วันล่าสุด กับ 7 วันก่อนหน้า");
    // Seven days back reaches neither collection's previous window, and the
    // screen says that rather than showing a fall to zero.
    await expect(page.getByTestId("comparability")).toBeVisible();
  });

  /* ------------------------------------------------------- reconciliation */

  test("every event count opens exactly the ads in that window", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    for (const metric of ["first_seen", "started"] as const) {
      for (const period of ["current", "previous"] as const) {
        await page.goto(trends());
        const cell = page.getByTestId(`cell-${metric}-${period}`);
        const claimed = await read(cell);
        if (claimed === 0) continue;
        await cell.click();
        await page.waitForURL(new RegExp(`metric=${metric}`));
        await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
        await expect(page.getByTestId(`evidence-${period}`)).toBeVisible();
      }
    }

    await page.goto(trends("&metric=first_seen&period=current"));
    await page.getByTestId("evidence-current").waitFor();
    await page.screenshot({ path: shot("first-found-1440"), animations: "disabled" });

    await page.goto(trends("&metric=started&period=current"));
    await page.getByTestId("evidence-source").waitFor();
    await page.screenshot({ path: shot("started-1440"), animations: "disabled" });
  });

  test("every state count opens the ads as they were at that instant", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    for (const metric of ["observed", "active", "evergreen", "reused"] as const) {
      for (const period of ["current", "previous"] as const) {
        await page.goto(trends());
        const cell = page.getByTestId(`cell-${metric}-${period}`);
        const claimed = await read(cell);
        if (claimed === 0) continue;
        await cell.click();
        await page.waitForURL(new RegExp(`metric=${metric}`));
        await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
        // The heading says which instant is being reconstructed.
        await expect(page.getByTestId("evidence-source")).toContainText("สถานะ ณ");
      }
    }

    await page.goto(trends("&metric=evergreen&period=previous"));
    await page.getByTestId("evidence-source").waitFor();
    await page.screenshot({ path: shot("selected-evidence-1440"), animations: "disabled" });
  });

  /* -------------------------------------------------------- page ranking */

  test("pages are ranked by arithmetic delta, in both directions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    const ranking = page.getByTestId("trend-pages");
    await ranking.scrollIntoViewIfNeeded();
    await expect(ranking).toBeVisible();
    await expect(page.locator("body")).toContainText("ตามจำนวนที่เราพบ");
    await page.screenshot({ path: shot("page-increase-1440"), animations: "disabled" });

    await page.getByTestId("direction-decrease").click();
    await page.waitForURL(/direction=decrease/);
    await expect(page.getByTestId("trend-pages")).toBeVisible();
    await page.screenshot({ path: shot("page-decrease-1440"), animations: "disabled" });
  });

  test("a page in the ranking opens its own trend, in the same scope", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());
    await page.getByTestId("trend-pages").locator("tbody tr").first().locator("a").first().click();
    await page.waitForURL(/page=/);
    // The data scope came with it; the entity changed. Decoded, because the
    // link is built with URLSearchParams and the colon is percent-encoded.
    expect(decodeURIComponent(page.url())).toContain(`scope=category:${categoryId}`);
    await expect(page.getByTestId("entity")).toContainText("เพจ");
    await expect(page.getByTestId("trend-summary")).toBeVisible();
    // A page trend does not rank pages against each other.
    await expect(page.getByTestId("trend-pages")).toHaveCount(0);

    await page.screenshot({ path: shot("page-summary-1440"), fullPage: true, animations: "disabled" });
  });

  test("a page outside the scope is refused, never rendered as zero", async ({ page }) => {
    await page.goto(trends("&page=710000000000001"));
    const refusal = page.getByTestId("trends-page-missing");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("ไม่ใช่ว่าพบ 0");
  });

  /* -------------------------------------------------------------- mix */

  test("the mix compares two reference views, each with its own coverage", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    const format = page.getByTestId("mix-format");
    await format.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("mix-format-coverage")).toContainText("ช่วงนี้");
    await expect(page.getByTestId("mix-format-coverage")).toContainText("ช่วงก่อน");
    await page.screenshot({ path: shot("format-change-1440"), animations: "disabled" });

    // A share moves in percentage points, and the unit is written out.
    const points = page.locator('[data-testid^="mix-format-points-"]').first();
    await expect(points).toContainText(/pp|ไม่เปลี่ยน/);

    const cta = page.getByTestId("mix-cta-qualifier");
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toContainText("ความครอบคลุมสองช่วงไม่เท่ากัน");
    await page.screenshot({ path: shot("cta-coverage-1440"), animations: "disabled" });

    const platform = page.getByTestId("mix-platform-qualifier");
    await platform.scrollIntoViewIfNeeded();
    await expect(platform).toContainText("เกิน 100% ได้");
    await page.screenshot({ path: shot("platform-change-1440"), animations: "disabled" });
  });

  test("a mix bucket opens exactly that period's ads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    const link = page.locator('[data-testid^="mix-format-evidence-current-"]').first();
    const claimed = await read(link);
    await link.click();
    await page.waitForURL(/dim=format/);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(claimed);
    await expect(page.getByTestId("evidence-source")).toContainText("สถานะ ณ");
  });

  /* --------------------------------------------------- contributing data */

  test("each period shows the runs it was built from", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    const current = page.getByTestId("context-current");
    await current.scrollIntoViewIfNeeded();
    await expect(current).toContainText("ครีมกันแดดทดสอบ");
    await expect(page.getByTestId("context-previous")).toContainText("กันแดดทดสอบ");
    // Two different queries, so the comparability caveat is real.
    await expect(page.getByTestId("comparability")).toHaveAttribute("data-verdict", "mixed");
    await expect(page.getByTestId("comparability")).toContainText("อาจสะท้อนวิธีเก็บ");

    await page.screenshot({ path: shot("contributing-1440"), fullPage: true, animations: "disabled" });
  });

  test("a period with no collection says so instead of showing zero activity", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Seven days: the older collection is far outside both windows.
    await page.goto(trends("&days=7"));
    const comparability = page.getByTestId("comparability");
    await expect(comparability).toHaveAttribute("data-verdict", "insufficient");
    await expect(comparability).toContainText(/ไม่ได้แปลว่าไม่มีโฆษณา|ยังไม่ได้เก็บ/);
    await expect(page.getByTestId("context-previous")).toContainText("ไม่เท่ากับ");
  });

  /* -------------------------------------------------------- interaction */

  test("an ad from a trend opens the frozen drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends("&metric=observed&period=current"));
    await page.getByTestId("evidence-current").waitFor();
    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    await expect(page.getByTestId("drawer-context")).toHaveAttribute("data-context", "master");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
  });

  test("the research state survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends("&days=14&metric=evergreen&period=previous"));
    const heading = await page.getByTestId("evidence-source").innerText();
    const cards = await page.locator('[data-testid^="ad-card-"]').count();
    await page.reload();
    await expect(page.getByTestId("evidence-source")).toHaveText(heading);
    await expect(page.locator('[data-testid^="ad-card-"]')).toHaveCount(cards);
  });

  test("the surface is operable and readable without a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends());

    // Reached by Tab, not by a script calling focus(): :focus-visible is the
    // state a keyboard user is actually in.
    const cell = page.getByTestId("cell-observed-current");
    let reached = false;
    for (let step = 0; step < 160 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await cell.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "a summary cell must be reachable by keyboard").toBe(true);
    expect(await cell.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(29, 78, 216)");

    await page.keyboard.press("Enter");
    await page.waitForURL(/metric=observed/);
    await expect(page.getByTestId("evidence-current")).toBeVisible();
  });

  /* ------------------------------------------------------------ responsive */

  test("trends work on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      if (suffix === "375") {
        await page.goto("/trends");
        await expect(page.getByTestId("trend-chooser")).toBeVisible();
        expect(await overflows(), `chooser overflows at ${width}px`).toBe(false);
        await page.screenshot({ path: shot("chooser-375"), fullPage: true, animations: "disabled" });
      }

      await page.goto(trends());
      await expect(page.getByTestId("trend-summary")).toBeVisible();
      expect(await overflows(), `trends overflow at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`summary-${suffix}`), fullPage: true, animations: "disabled" });

      await page.getByTestId("mix-format").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`mix-${suffix}`), animations: "disabled" });

      if (suffix === "375") {
        await page.getByTestId("trend-pages").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("page-ranking-375"), animations: "disabled" });
      }

      await page.goto(trends("&metric=observed&period=current"));
      await page.getByTestId("evidence-current").waitFor();
      expect(await overflows(), `evidence overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`evidence-${suffix}`), animations: "disabled" });
    }
  });

  test("a page trend renders its own evidence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(trends(`&page=${PAGE_A}&metric=observed&period=current`));
    await page.getByTestId("evidence-current").waitFor();
    await expect(page.getByTestId("entity")).toContainText("เพจ");
    await page.screenshot({ path: shot("page-evidence-1440"), animations: "disabled" });
  });
});
