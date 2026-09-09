import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY_BRAND, TMP } from "./constants.ts";

/**
 * P2.8 — Brand mapping.
 *
 * The journey a researcher actually walks: find a Page nobody has grouped,
 * look at its evidence, decide, and record the decision with their name on it.
 * Then get it wrong, move it, and find both decisions still on the record.
 *
 * Nothing in this spec waits for a suggestion, because the product makes none.
 */

const OUT = join("test-artifacts", "visual", "p2-brand-mapping");
const shot = (name: string) => join(OUT, `${name}.png`);

/** This spec's own pages. The first two share a display name deliberately. */
const PAGE_A = "760000000000001";
const PAGE_B = "760000000000002";
const PAGE_C = "760000000000003";

const BRAND_A = `กลอรี่คอฟฟี่ ${Date.now()}`;
const BRAND_B = `คู่แข่งคอฟฟี่ ${Date.now()}`;

async function importFixture(page: Page, file: string, name: string) {
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY_BRAND });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
}

/** Creates a brand through the list form and returns the id from its URL. */
async function createBrand(page: Page, name: string): Promise<string> {
  await page.goto("/brands");
  await page.getByTestId("brand-name-input").fill(name);
  await page.getByTestId("brand-create-submit").click();
  await page.waitForURL(/\/brands\/[0-9a-f-]{36}/);
  return page.url().split("/brands/")[1].split("?")[0];
}

/** Maps a page from wherever the control is on screen. */
async function mapPage(page: Page, pageId: string, brandName: string, note?: string) {
  const control = `map-${pageId}`;
  await page.getByTestId(`${control}-open`).click();
  await page.getByTestId(`${control}-query`).fill(brandName);
  await page.getByTestId(`${control}-search`).click();
  await page.getByTestId(`${control}-results`).waitFor();
  await page.getByTestId(`${control}-results`).getByRole("button", { name: brandName }).click();
  if (note) await page.getByTestId(`${control}-note`).fill(note);
  await page.getByTestId(`${control}-confirm`).click();
}

test.describe("P2.8 brand mapping", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let brandA = "";
  let brandB = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await importFixture(page, join(TMP, "brand-pages.json"), "brand-run-a");
    await importFixture(page, join(TMP, "brand-pages-2.json"), "brand-run-b");
    await context.close();
  });

  /* ------------------------------------------------------------ the queue */

  test("the queue is work, not a data problem", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/unmapped-pages");

    await expect(page.getByTestId("unmapped-table")).toBeVisible();
    await expect(page.getByTestId(`unmapped-row-${PAGE_A}`)).toBeVisible();
    // The two sentences that keep this honest: an unmapped page is unreviewed
    // work, and a brand is somebody's decision rather than an inference.
    await expect(page.getByTestId("unmapped-meaning")).toContainText("ไม่ใช่ข้อผิดพลาด");
    await expect(page.getByTestId("unmapped-meaning")).toContainText("ไม่ใช่คุณภาพข้อมูลต่ำ");
    await expect(page.getByTestId("brand-basis")).toContainText("ไม่ใช่ข้อมูลจาก Meta");

    // Two pages share a name, so the row carries the identity that decides.
    const rowA = page.getByTestId(`unmapped-row-${PAGE_A}`);
    const rowB = page.getByTestId(`unmapped-row-${PAGE_B}`);
    await expect(rowA).toContainText(PAGE_A);
    await expect(rowB).toContainText(PAGE_B);
    await expect(rowA).toContainText("กาแฟกลอรี่ สาขาหลัก");
    await expect(rowB).toContainText("กาแฟกลอรี่ สาขาหลัก");

    await page.screenshot({ path: shot("unmapped-1440"), fullPage: true, animations: "disabled" });
  });

  test("the queue orders by what was observed, and says so", async ({ page }) => {
    await page.goto("/unmapped-pages?sort=observed_ads");
    const ids = await page.locator('[data-testid^="unmapped-row-"]').evaluateAll(
      (rows) => rows.map((row) => row.getAttribute("data-testid")!.replace("unmapped-row-", "")),
    );
    // Page A carries four ads, B three, C two.
    expect(ids.slice(0, 3)).toEqual([PAGE_A, PAGE_B, PAGE_C]);

    await page.goto("/unmapped-pages?sort=page_name");
    await expect(page.getByTestId("unmapped-sort-label")).toHaveText("ชื่อเพจ");
    /*
     * No ordering names a likelihood, because none is computed. Scoped to the
     * sort controls rather than the page: the footnote below them REFUSES a
     * probability score by name, and a whole-body scan cannot tell a claim from
     * its denial.
     */
    const sorts = page.getByLabel("เรียงลำดับคิว");
    await expect(sorts).not.toContainText("น่าจะ");
    await expect(sorts).not.toContainText("แนะนำ");
  });

  test("a page is inspected with the frozen Page surface before any decision", async ({ page }) => {
    await page.goto("/unmapped-pages");
    await page.getByTestId(`unmapped-row-${PAGE_A}`).getByRole("link", { name: /กาแฟกลอรี่/ }).click();
    await page.waitForURL(new RegExp(`/pages/${PAGE_A}`));

    // The whole Page Intelligence surface, not a weaker copy of it.
    await expect(page.getByTestId("kpi-observed")).toBeVisible();
    await expect(page.getByTestId("mix-format")).toBeVisible();
    await expect(page.getByTestId("page-brand")).toContainText("ยังไม่จับคู่");
    await page.screenshot({ path: shot("page-before-mapping-1440"), fullPage: true, animations: "disabled" });
  });

  /* --------------------------------------------------------------- create */

  test("creating a brand is an explicit act", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/brands");
    await expect(page.getByTestId("brand-basis")).toBeVisible();
    await page.screenshot({ path: shot("brands-empty-1440"), fullPage: true, animations: "disabled" });

    brandA = await createBrand(page, BRAND_A);
    brandB = await createBrand(page, BRAND_B);

    await page.goto(`/brands/${brandA}`);
    await expect(page.getByTestId("brand-identity")).toHaveText(brandA);
    await expect(page.getByTestId("brand-status")).toHaveText("ใช้งาน");
    await expect(page.getByTestId("brand-pages-empty")).toBeVisible();
    await page.screenshot({ path: shot("brand-new-1440"), fullPage: true, animations: "disabled" });
  });

  test("a duplicate name is shown, never merged", async ({ page }) => {
    await page.goto("/brands");
    // Same name, different spacing and case: the normalized form collides.
    await page.getByTestId("brand-name-input").fill(`  ${BRAND_A.toUpperCase()}  `);
    await page.getByTestId("brand-create-submit").click();

    await expect(page.getByTestId("brand-create-error")).toContainText("มีแบรนด์ชื่อนี้อยู่แล้ว");
    const existing = page.getByTestId("brand-duplicates");
    await expect(existing).toContainText("ไม่รวมให้อัตโนมัติ");
    await expect(existing.getByTestId(`brand-duplicate-${brandA}`)).toBeVisible();
    // Still on /brands: nothing was created and nothing was chosen for anyone.
    expect(page.url()).toContain("/brands");
    await page.screenshot({ path: shot("duplicate-brand-1440"), animations: "disabled" });
  });

  /* ---------------------------------------------------------------- map */

  test("mapping two pages into one brand", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/unmapped-pages");

    await page.getByTestId(`map-${PAGE_A}-open`).click();
    await page.getByTestId(`map-${PAGE_A}-query`).fill(BRAND_A);
    await page.getByTestId(`map-${PAGE_A}-search`).click();
    await page.getByTestId(`map-${PAGE_A}-results`).waitFor();
    await page.screenshot({ path: shot("map-page-1440"), animations: "disabled" });

    await page.getByTestId(`map-${PAGE_A}-pick-${brandA}`).click();
    await expect(page.getByTestId(`map-${PAGE_A}-map-explanation`)).toContainText(BRAND_A);
    await page.getByTestId(`map-${PAGE_A}-note`).fill("สาขาหลัก");
    await page.getByTestId(`map-${PAGE_A}-confirm`).click();

    // The page leaves the queue, because the queue is defined by the mapping.
    await expect(page.getByTestId(`unmapped-row-${PAGE_A}`)).toHaveCount(0);

    await mapPage(page, PAGE_B, BRAND_A, "สาขาที่สอง");
    await expect(page.getByTestId(`unmapped-row-${PAGE_B}`)).toHaveCount(0);

    await page.goto(`/brands/${brandA}`);
    await expect(page.getByTestId("brand-active-pages")).toHaveText("2");
    await expect(page.getByTestId(`brand-page-${PAGE_A}`)).toBeVisible();
    await expect(page.getByTestId(`brand-page-${PAGE_B}`)).toBeVisible();
    await page.screenshot({ path: shot("brand-detail-1440"), fullPage: true, animations: "disabled" });
  });

  test("the brand total counts distinct ads, inside a stated scope", async ({ page }) => {
    await page.goto(`/brands/${brandA}`);
    const total = Number((await page.getByTestId("kpi-observed-ads").innerText()).replace(/[^\d]/g, ""));
    // Four ads on page A, three on page B, none shared.
    expect(total).toBe(7);
    await expect(page.getByTestId("brand-scope")).toContainText("ทุก");
    await expect(page.getByTestId("brand-ads-basis")).toContainText("ad_archive_id");
    await expect(page.getByTestId("brand-ads-basis")).toContainText("ไม่ใช่ส่วนแบ่งตลาด");
  });

  test("a page keeps its own identity and its own evidence", async ({ page }) => {
    await page.goto(`/brands/${brandA}`);
    await page.getByTestId(`brand-page-${PAGE_A}`).getByRole("link", { name: /กาแฟกลอรี่/ }).click();
    await page.waitForURL(new RegExp(`/pages/${PAGE_A}`));

    // The Brand is metadata beside the Page, labelled as ours. The title is
    // still the Page's own name.
    await expect(page.getByTestId("page-brand")).toContainText(BRAND_A);
    await expect(page.locator("body")).toContainText("Brand (จัดกลุ่มโดย PT Glory)");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("กาแฟกลอรี่");
    await expect(page.getByTestId("kpi-observed")).toBeVisible();
    await page.screenshot({ path: shot("page-brand-context-1440"), fullPage: true, animations: "disabled" });
  });

  /* ---------------------------------------------------------------- move */

  test("moving a page says where from and where to, and asks", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/brands/${brandA}`);

    await page.getByTestId(`map-${PAGE_B}-open`).click();
    await page.getByTestId(`map-${PAGE_B}-query`).fill(BRAND_B);
    await page.getByTestId(`map-${PAGE_B}-search`).click();
    await page.getByTestId(`map-${PAGE_B}-pick-${brandB}`).click();

    const explanation = page.getByTestId(`map-${PAGE_B}-move-explanation`);
    await expect(explanation).toContainText(BRAND_A);
    await expect(explanation).toContainText(BRAND_B);
    // A move is a move. Calling it a merge would describe something this
    // product cannot do.
    await expect(explanation).toContainText("ไม่ใช่การรวมแบรนด์");
    await page.screenshot({ path: shot("move-confirmation-1440"), animations: "disabled" });

    await page.getByTestId(`map-${PAGE_B}-note`).fill("แยกออกไปเป็นคนละแบรนด์");
    await page.getByTestId(`map-${PAGE_B}-confirm`).click();

    await expect(page.getByTestId("brand-active-pages")).toHaveText("1");
    await page.goto(`/brands/${brandB}`);
    await expect(page.getByTestId(`brand-page-${PAGE_B}`)).toBeVisible();
  });

  test("both decisions stay on the record", async ({ page }) => {
    await page.goto(`/brands/${brandA}`);
    const history = page.getByTestId("brand-history");
    await expect(history).toBeVisible();
    // The closed decision keeps its reason and its author; it is not deleted
    // because it was superseded.
    await expect(history).toContainText("สาขาที่สอง");
    await expect(history).toContainText(PAGE_B.slice(0, 6));
    await expect(history).toContainText("ปิดแล้ว");
    await expect(history).toContainText("ปัจจุบัน");
    await page.screenshot({ path: shot("mapping-history-1440"), fullPage: true, animations: "disabled" });

    await page.goto(`/brands/${brandB}`);
    await expect(page.getByTestId("brand-history")).toContainText("แยกออกไปเป็นคนละแบรนด์");
  });

  /* --------------------------------------------------------------- unmap */

  test("unmapping returns the page to the queue and keeps the history", async ({ page }) => {
    await page.goto(`/brands/${brandB}`);
    await page.getByTestId(`map-${PAGE_B}-unmap`).click();
    await expect(page.getByTestId(`brand-page-${PAGE_B}`)).toHaveCount(0);

    await page.goto("/unmapped-pages");
    await expect(page.getByTestId(`unmapped-row-${PAGE_B}`)).toBeVisible();

    await page.goto(`/brands/${brandB}`);
    await expect(page.getByTestId("brand-history")).toContainText(PAGE_B.slice(0, 6));
  });

  /* ------------------------------------------------------------- archive */

  test("archiving keeps the history and refuses new pages", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/brands/${brandB}`);
    await page.getByTestId("archive-brand").click();
    await expect(page.getByTestId("archive-explanation")).toContainText("ประวัติการจับคู่ทั้งหมดยังอยู่");
    await page.getByTestId("confirm-archive").click();
    await expect(page.getByTestId("brand-status")).toHaveText("เก็บเข้าคลัง");
    // There is no delete, and the screen says why.
    await expect(page.getByTestId("no-delete-note")).toContainText("ไม่มีปุ่มลบ");
    await page.screenshot({ path: shot("brand-archived-1440"), fullPage: true, animations: "disabled" });

    // An archived brand takes no new pages: the server refuses, not the UI.
    const response = await page.request.post("/api/brand-mappings", {
      data: { brandId: brandB, pageId: PAGE_C },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toContain("เก็บเข้าคลัง");

    await page.goto("/brands?status=archived");
    await expect(page.getByTestId(`brand-row-${brandB}`)).toBeVisible();
    await page.getByTestId("restore-brand").isVisible().catch(() => {});
  });

  /* -------------------------------------------------------------- viewer */

  test("a viewer reads the grouping and changes nothing", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "viewer.json") });
    const page = await context.newPage();

    await page.goto(`/brands/${brandA}`);
    await expect(page.getByTestId("brand-pages")).toBeVisible();
    // No create form, no edit controls, and the mapper is absent rather than
    // disabled: there is no action here for them to find.
    await expect(page.getByTestId("brand-create-form")).toHaveCount(0);
    await expect(page.getByTestId("brand-rename")).toHaveCount(0);
    await expect(page.getByTestId(`map-${PAGE_A}-open`)).toHaveCount(0);
    await expect(page.getByTestId(`map-${PAGE_A}-readonly`)).toBeVisible();

    // And the server refuses directly, which is the boundary that matters.
    const mapped = await page.request.post("/api/brand-mappings", {
      data: { brandId: brandA, pageId: PAGE_C },
    });
    expect(mapped.status()).toBe(403);
    const created = await page.request.post("/api/brands", { data: { name: "Viewer Brand" } });
    expect(created.status()).toBe(403);

    await page.goto("/unmapped-pages");
    await expect(page.getByTestId("unmapped-table")).toBeVisible();
    await expect(page.getByTestId(`map-${PAGE_C}-open`)).toHaveCount(0);
    await context.close();
  });

  /* ------------------------------------------------------ keyboard, sizes */

  test("the mapper is operable without a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/unmapped-pages");

    const open = page.getByTestId(`map-${PAGE_C}-open`);
    let reached = false;
    for (let step = 0; step < 200 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await open.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the mapper must be reachable by keyboard").toBe(true);
    expect(await open.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(29, 78, 216)");

    await page.keyboard.press("Enter");
    const field = page.getByTestId(`map-${PAGE_C}-query`);
    await field.waitFor();
    await field.fill(BRAND_A);
    // Enter searches. It must never map: a decision needs its own button.
    await field.press("Enter");
    await page.getByTestId(`map-${PAGE_C}-results`).waitFor();
    await expect(page.getByTestId(`map-${PAGE_C}-confirm-panel`)).toHaveCount(0);
    await expect(page.getByTestId(`unmapped-row-${PAGE_C}`)).toBeVisible();
  });

  test("brand management works on a tablet and on a phone", async ({ page }) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    for (const [width, height, suffix] of [[768, 1024, "768"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width, height });

      await page.goto("/brands");
      await expect(page.getByTestId("brand-table")).toBeVisible();
      expect(await overflows(), `the brand list overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`brands-${suffix}`), fullPage: true, animations: "disabled" });

      await page.goto(`/brands/${brandA}`);
      await expect(page.getByTestId("brand-pages")).toBeVisible();
      expect(await overflows(), `the brand detail overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`brand-detail-${suffix}`), fullPage: true, animations: "disabled" });

      await page.goto("/unmapped-pages");
      await expect(page.getByTestId("unmapped-table")).toBeVisible();
      expect(await overflows(), `the queue overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`unmapped-${suffix}`), fullPage: true, animations: "disabled" });

      await page.getByTestId(`map-${PAGE_C}-open`).click();
      await page.getByTestId(`map-${PAGE_C}-query`).waitFor();
      expect(await overflows(), `the mapper overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: shot(`mapping-sheet-${suffix}`), animations: "disabled" });

      if (suffix === "375") {
        await page.goto(`/brands/${brandA}`);
        await page.getByTestId("brand-history").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot("mapping-history-375"), animations: "disabled" });
      }
    }
  });
});
