import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * Layout invariants that a screenshot shows but no functional test would catch.
 *
 * The case that motivated this: PageHeader's `.text` used `flex: 1 1 320px` as a
 * minimum column width. That is only meaningful while the header is a row — the
 * mobile rule flips it to a column, where flex-basis applies to the block axis,
 * so 320px became reserved HEIGHT and the title block rendered four times taller
 * than its content on a phone.
 */

const WIDTHS = [375, 768, 1280, 1440];

test.describe("page header geometry", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible();
    await page.getByTestId("dataset-name").fill("e2e-layout");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    datasetUrl = page.url();
    await context.close();
  });

  for (const width of WIDTHS) {
    test(`the header reserves no empty height at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(datasetUrl);

      const box = await page.evaluate(() => {
        const header = document.querySelector("header");
        const text = header!.firstElementChild!;
        const rule = text.querySelector("span[aria-hidden]")!;
        return {
          text: text.getBoundingClientRect().height,
          // Distance from the accent rule — the last thing in the block on this
          // page — to the bottom of the block. Anything large is dead space.
          slack: text.getBoundingClientRect().bottom - rule.getBoundingClientRect().bottom,
        };
      });

      expect(box.slack, "empty reserved space below the header content").toBeLessThan(24);
      expect(box.text, "header text block should be content-sized").toBeLessThan(200);
    });
  }

  test("the header and the context bar stay in document order on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(datasetUrl);
    const header = await page.locator("header").boundingBox();
    const context = await page.getByTestId("context-bar").boundingBox();
    expect(context!.y).toBeGreaterThan(header!.y + header!.height - 1);
    // The gap between them is the declared section margin, not a surprise.
    expect(context!.y - (header!.y + header!.height)).toBeLessThan(48);
  });
});

/**
 * The shell's topbar appears below 900px as a sticky layer at top:0 with
 * z-index 30. Any second sticky layer at the same offset slides underneath it.
 */
test.describe("sticky layers never overlap", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.goto("/datasets");
    const href = await page.locator('[data-testid="dataset-list"] tbody a').first().getAttribute("href");
    datasetUrl = href!;
    await context.close();
  });

  for (const width of [640, 641, 768, 899, 900, 901, 1280, 1440]) {
    test(`explorer toolbar does not hide under the shell topbar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(datasetUrl);
      await page.getByTestId("filter-toolbar").waitFor();

      const state = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-testid="filter-toolbar"]')!;
        const topbar = [...document.querySelectorAll("div")].find(
          (el) => getComputedStyle(el).position === "sticky"
            && el.querySelector('button[aria-label="เปิดเมนู"]'),
        );
        return {
          toolbarSticky: getComputedStyle(toolbar).position === "sticky",
          topbarVisible: Boolean(topbar) && getComputedStyle(topbar!).display !== "none",
        };
      });

      // Exactly one sticky layer may claim top: 0. Where the shell topbar is
      // present the toolbar returns to normal flow; where it is absent the
      // toolbar keeps its sticky behaviour.
      expect(
        state.toolbarSticky && state.topbarVisible,
        "two sticky layers are competing for the same offset",
      ).toBe(false);
      if (!state.topbarVisible) {
        expect(state.toolbarSticky, "the toolbar should stay sticky on desktop").toBe(true);
      }
    });
  }
});
