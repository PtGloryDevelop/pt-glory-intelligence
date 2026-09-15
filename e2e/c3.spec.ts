import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * C3: dataset hierarchy and import corrections.
 *
 * Structural assertions only — no pixel comparisons. What is worth protecting
 * here is that a fact is stated once, that the working surface is reachable, and
 * that nothing runs off the side of a phone.
 */

const OUT = join("test-artifacts", "visual", "c3");
const shot = (name: string) => join(OUT, `${name}.png`);

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

async function datasetNamed(page: Page, name: string): Promise<string> {
  await page.goto("/datasets");
  const link = page.locator('[data-testid="dataset-list"] tbody a', { hasText: name });
  await link.first().waitFor();
  return (await link.first().getAttribute("href"))!;
}

/** Any element whose right edge is past the viewport is a horizontal overflow. */
async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test.describe("C3 dataset and import", () => {
  test.describe.configure({ mode: "serial" });
  // The subject is the import screen, which C14 made admin-only.
  test.use({ storageState: join(AUTH, "admin.json") });

  let completedUrl = "";
  let partialUrl = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();

    // A completed dataset and a partial one, imported through the real flow.
    for (const [fixture, name] of [
      [join("tests", "fixtures", "golden-500.json"), "c3-completed"],
      [join(TMP, "partial.json"), "c3-partial"],
    ] as const) {
      await page.goto("/import");
      await page.getByTestId("category-select").selectOption({ label: CATEGORY });
      await page.getByTestId("file-input").setInputFiles(fixture);
      await page.getByTestId("preview-button").click();
      await page.getByTestId("preview-panel").waitFor();
      await page.getByTestId("dataset-name").fill(name);
      await page.getByTestId("commit-button").click();
      await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    }

    completedUrl = await datasetNamed(page, "c3-completed");
    partialUrl = await datasetNamed(page, "c3-partial");
    await context.close();
  });

  test("no primary dataset fact is stated twice", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(completedUrl);
    await page.getByTestId("context-bar").waitFor();

    // Ads, Pages and quality live in the KPI row; the context bar identifies the
    // dataset. Before C3 all three appeared in both, one directly above the other.
    const barLabels = await page.locator('[data-testid="context-bar"]').evaluate(
      (el) => [...el.querySelectorAll("div")].map((d) => d.firstChild?.textContent?.trim() ?? ""));
    // Only the DATASET facts are forbidden here — those belong to the KPI row.
    // Run provenance ("Pages พบในรอบเก็บ", "กันไว้ตรวจ") lives in the bar on
    // purpose: it describes the collection run, which is what the bar is for.
    for (const duplicated of ["Ads", "Pages", "คุณภาพข้อมูล"]) {
      expect(barLabels, `${duplicated} must not appear in the context bar`).not.toContain(duplicated);
    }

    // ...and the values are still on the page, in exactly one place each.
    for (const id of ["context-ads", "context-pages", "context-quarantine", "context-run-pages"]) {
      await expect(page.getByTestId(id)).toHaveCount(1);
    }
    await expect(page.getByTestId("context-method")).toHaveCount(1);
    await expect(page.getByTestId("context-status")).toHaveCount(1);
  });

  test("the Explorer is reachable without a long scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(completedUrl);
    await page.getByTestId("explorer").waitFor();

    const top = await page.getByTestId("explorer").evaluate(
      (el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    // The audit measured 887px of header before the working surface began, with
    // five facts stated twice. It now measures ~779, so at 1440x1000 the
    // Explorer heading and its toolbar are on the first screen.
    //
    // The threshold is not lower because the remaining height is content the
    // spec asks for — six quality fields with their denominators — and trimming
    // those to hit a rounder number would be removing information to flatter a
    // measurement.
    expect(top, "vertical distance to the Explorer").toBeLessThan(800);
  });

  test("dataset and collection-run page counts stay distinct", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(partialUrl);
    await page.getByTestId("context-run-pages").waitFor();

    // A partial run sees pages on rows it could not import, so the run count is
    // legitimately the larger of the two. Merging them would erase that.
    const inDataset = Number(await page.getByTestId("context-pages").textContent());
    const inRun = Number(await page.getByTestId("context-run-pages").textContent());
    expect(Number.isFinite(inDataset) && Number.isFinite(inRun)).toBe(true);
    expect(inRun).toBeGreaterThanOrEqual(inDataset);

    await expect(page.getByTestId("partial-banner")).toBeVisible();
  });

  test("dataset detail never overflows sideways", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const [name, url] of [["completed", completedUrl], ["partial", partialUrl]] as const) {
        await page.goto(url);
        await page.getByTestId("quality-strip").waitFor();
        expect(await overflowsSideways(page), `${name} @ ${viewport.name}`).toBe(false);
        await page.screenshot({ path: shot(`dataset-${name}-${viewport.name}`), fullPage: true, animations: "disabled" });

        await page.getByTestId("quality-strip-more").click();
        expect(await overflowsSideways(page), `expanded quality @ ${viewport.name}`).toBe(false);
        if (name === "completed") {
          await page.screenshot({ path: shot(`dataset-expanded-${viewport.name}`), fullPage: true, animations: "disabled" });
        }
      }
    }
  });

  test("the page header keeps its a295fad fix", async ({ page }) => {
    // Regression guard for the flex-basis-as-height defect, re-checked here
    // because C3 touched the surrounding layout.
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(completedUrl);
      const slack = await page.evaluate(() => {
        const text = document.querySelector("header")!.firstElementChild!;
        const rule = text.querySelector("span[aria-hidden]")!;
        return text.getBoundingClientRect().bottom - rule.getBoundingClientRect().bottom;
      });
      expect(slack, `header slack @ ${viewport.name}`).toBeLessThan(24);
    }
  });

  test("import preview fits a phone and states the current action", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto("/import");
      await page.screenshot({ path: shot(`import-idle-${viewport.name}`), fullPage: true, animations: "disabled" });

      // Before a file is checked, the check is the primary action.
      await expect(page.getByTestId("preview-button")).toHaveText("ตรวจไฟล์ก่อนบันทึก");
      await expect(page.getByTestId("preview-button")).toHaveAttribute("data-variant", "primary");

      await page.getByTestId("category-select").selectOption({ label: CATEGORY });
      await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
      await page.getByTestId("preview-button").click();
      await page.getByTestId("preview-panel").waitFor();

      // Afterwards it must not still read as an instruction to do it.
      await expect(page.getByTestId("preview-button")).toHaveText("ตรวจไฟล์นี้อีกครั้ง");
      await expect(page.getByTestId("preview-button")).not.toHaveAttribute("data-variant", "primary");
      // Exactly one primary action on screen: the commit.
      await expect(page.locator('[data-variant="primary"]')).toHaveCount(1);
      await expect(page.getByTestId("commit-button")).toHaveAttribute("data-variant", "primary");

      expect(await overflowsSideways(page), `import preview @ ${viewport.name}`).toBe(false);
      await page.screenshot({ path: shot(`import-preview-${viewport.name}`), fullPage: true, animations: "disabled" });

      // The reported-vs-computed numbers stay inside the viewport.
      const spill = await page.evaluate(() => {
        const table = document.querySelector('[data-testid="counts-table"]')!;
        return table.getBoundingClientRect().right > document.documentElement.clientWidth + 1;
      });
      expect(spill, `counts table @ ${viewport.name}`).toBe(false);

      await page.goto("/import");
      await page.getByTestId("category-select").selectOption({ label: CATEGORY });
      await page.getByTestId("file-input").setInputFiles(join(TMP, "partial.json"));
      await page.getByTestId("preview-button").click();
      await page.getByTestId("partial-warning").waitFor();
      await page.screenshot({ path: shot(`import-partial-${viewport.name}`), fullPage: true, animations: "disabled" });

      await page.goto("/import");
      await page.getByTestId("file-input").setInputFiles(join(TMP, "invalid.json"));
      await page.getByTestId("preview-button").click();
      await page.getByTestId("import-error").waitFor();
      expect(await overflowsSideways(page), `import rejected @ ${viewport.name}`).toBe(false);
      await page.screenshot({ path: shot(`import-rejected-${viewport.name}`), fullPage: true, animations: "disabled" });
    }
  });

  test("a disabled control still reads as a control", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/import");

    const button = page.getByTestId("preview-button");
    await expect(button).toBeDisabled();
    const style = await button.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { opacity: computed.opacity, color: computed.color, background: computed.backgroundColor };
    });
    // Dimming the whole control to 0.5 made it read as fading away, and as
    // indistinguishable from a loading state.
    expect(Number(style.opacity)).toBe(1);
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({ path: shot("import-disabled-1440"), fullPage: false, animations: "disabled" });
  });
});
