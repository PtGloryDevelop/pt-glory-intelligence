import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH } from "./constants.ts";

/**
 * C2 capture and geometry checks against the seeded "c2-explorer" dataset,
 * whose previews are already archived — so this looks at the real
 * creative-filled state rather than a wall of placeholders.
 *
 * Geometry only, never pixels: column counts, equal card heights, a phone card
 * that is a row rather than a page. Those are the regressions worth catching.
 */

const OUT = join("test-artifacts", "visual", "c2");
const shot = (name: string) => join(OUT, `${name}.png`);

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000, columns: 4 },
  { name: "1280", width: 1280, height: 900, columns: 3 },
  { name: "768", width: 768, height: 1024, columns: 2 },
  { name: "375", width: 375, height: 812, columns: 1 },
];

async function openDataset(page: Page) {
  await page.goto("/datasets");
  const link = page.locator('[data-testid="dataset-list"] tbody a', { hasText: "c2-explorer" });
  await link.first().waitFor();
  const href = await link.first().getAttribute("href");
  await page.goto(href!);
  await page.getByTestId("ads-grid").waitFor();
  return href!;
}

/** Columns counted from where cards actually sit, not from the CSS. */
async function gridColumns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid^="ad-card-"]')];
    if (cards.length === 0) return 0;
    const top = Math.round(cards[0].getBoundingClientRect().top);
    return cards.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - top) < 4).length;
  });
}

test.describe("C2 explorer", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  // Resolved once, before anything, so a single test can be run on its own
  // instead of depending on the first one having gone first.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    datasetUrl = await openDataset(page);
    await context.close();
  });

  test("grid at every breakpoint", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(datasetUrl);
      await page.getByTestId("ads-grid").waitFor();
      await page.locator('[data-testid="card-media"]').first().waitFor();
      await page.waitForLoadState("networkidle");

      const columns = await gridColumns(page);
      expect(columns, `${viewport.name} column count`).toBe(viewport.columns);
      expect(columns, "a fifth column is never allowed").toBeLessThanOrEqual(4);

      await page.screenshot({ path: shot(`grid-${viewport.name}`), fullPage: true, animations: "disabled" });
    }
  });

  test("cards in a row are the same height", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(datasetUrl);
    await page.locator('[data-testid="card-media"]').first().waitFor();

    const heights = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid^="ad-card-"]')].slice(0, 4);
      return cards.map((c) => Math.round(c.getBoundingClientRect().height));
    });
    // Mixed square and 9:16 creatives must not produce ragged card heights.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  });

  test("a phone browses rather than scrolls a report", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(datasetUrl);
    await page.locator('[data-testid="card-media"]').first().waitFor();

    const perCard = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid^="ad-card-"]')];
      return Math.round(cards[0].getBoundingClientRect().height);
    });
    // The pre-C2 phone card was ~550px tall, which made 30 records a 23,000px
    // scroll. The recomposed row is a fraction of that.
    expect(perCard, "phone card height").toBeLessThan(220);

    // Nothing may spill out of the card sideways — a clipped status badge is
    // information lost, not a cosmetic issue.
    const overflow = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid^="ad-card-"]')].slice(0, 6);
      return cards.filter((card) => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll('*')].some(
          (child) => child.getBoundingClientRect().right > box.right + 1);
      }).length;
    });
    expect(overflow, 'cards whose content spills past their own edge').toBe(0);

    // Scroll to the grid: a viewport shot of the page top would show the header
    // rather than the thing this test is about.
    await page.getByTestId("ads-grid").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("grid-mobile-detail"), fullPage: false, animations: "disabled" });
  });

  test("format identity comes from the ad, not the archived file", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?format=VIDEO`);
    await page.locator('[data-testid="card-media"]').first().waitFor();

    // Every archived video preview is a JPEG; the card must still say Video.
    const cards = page.locator('[data-testid^="ad-card-"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 4); i += 1) {
      const card = cards.nth(i);
      await expect(card.locator('[data-testid^="card-format-"]')).toHaveText(/Video/);
      await expect(card.locator('[data-testid="card-media"]')).toHaveAttribute("data-media-kind", "video");
    }
    await page.screenshot({ path: shot("grid-video-1440"), fullPage: true, animations: "disabled" });
  });

  test("table mode leads with the creative", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(datasetUrl);
      await page.getByTestId("view-table").click();
      await page.getByTestId("ads-table").waitFor();
      await page.waitForLoadState("networkidle");

      if (viewport.name === "1440") {
        const headers = await page.locator('[data-testid="ads-table"] thead th').allTextContents();
        expect(headers).toEqual([
          "ครีเอทีฟ", "เพจ", "ข้อความ", "รูปแบบ", "CTA", "แพลตฟอร์ม", "เริ่มแสดง", "อายุ (วัน)", "สถานะ",
        ]);
        await expect(page.locator('[data-testid="row-media"]').first()).toBeVisible();
      }
      await page.screenshot({ path: shot(`table-${viewport.name}`), fullPage: true, animations: "disabled" });
    }
  });

  test("filters, advanced panel and zero results", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto(`${datasetUrl}?active=active&format=VIDEO`);
      await page.getByTestId("filter-chips").waitFor();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: shot(`filters-${viewport.name}`), fullPage: true, animations: "disabled" });

      await page.goto(datasetUrl);
      await page.getByTestId("advanced-toggle").click();
      await page.getByTestId("advanced-panel").waitFor();
      await page.screenshot({ path: shot(`advanced-${viewport.name}`), fullPage: true, animations: "disabled" });
    }

    // Filtered-to-zero names the filters and offers the way out.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?search=${encodeURIComponent("ไม่มีคำนี้อยู่จริงแน่นอน")}`);
    await page.getByTestId("explorer-empty").waitFor();
    await expect(page.getByTestId("explorer-empty")).toContainText("ตัวกรองที่ใช้อยู่");
    await expect(page.getByTestId("reset-filters")).toBeVisible();
    await page.screenshot({ path: shot("zero-results-1440"), fullPage: true, animations: "disabled" });
  });

  test("unusable media reads as unusable, not as missing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The carousel/DCO ads in this dataset are text-only at source.
    await page.goto(`${datasetUrl}?format=CAROUSEL`);
    await page.getByTestId("ads-grid").waitFor();
    const placeholder = page.getByTestId("card-media-placeholder").first();
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveAttribute("data-media-state", "unusable");
    await expect(placeholder).toContainText("ไม่สามารถแสดงตัวอย่างสื่อ");
    await page.screenshot({ path: shot("unusable-media-1440"), fullPage: true, animations: "disabled" });
  });

  test("keyboard reaches the card, the toggle and the filters", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(datasetUrl);
    await page.locator('[data-testid="card-media"]').first().waitFor();

    // The card opens on Enter from the keyboard, with a visible focus ring.
    const firstCard = page.locator('[data-testid^="open-ad-"]').first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();
    const outline = await firstCard.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ad-drawer")).toBeVisible();
    await page.getByTestId("drawer-close").click();

    for (const id of ["filter-search", "f-active", "sort-select", "view-table", "advanced-toggle"]) {
      await page.getByTestId(id).focus();
      await expect(page.getByTestId(id)).toBeFocused();
    }

    // Abbreviated and icon-bearing controls still carry an accessible name.
    for (const id of ["view-grid", "view-table"]) {
      const name = await page.getByTestId(id).evaluate(
        (el) => el.textContent?.trim() || el.getAttribute("aria-label"));
      expect(name, `${id} accessible name`).toBeTruthy();
    }
  });
});
