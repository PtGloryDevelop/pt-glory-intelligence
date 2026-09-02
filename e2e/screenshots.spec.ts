import { test } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";
import { resetData } from "./db.ts";

/**
 * Visual capture, not visual assertion.
 *
 * Plain page.screenshot() rather than toHaveScreenshot(): pixel baselines are
 * flaky across font rendering on Windows, and turning cosmetic drift into a red
 * suite would add noise without protecting behaviour. These files exist to be
 * looked at by a person after each slice.
 */

const SLICE = process.env.VISUAL_SLICE ?? "v1";
const OUT = join("test-artifacts", "visual", SLICE);

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

const shot = (name: string) => join(OUT, `${name}.png`);

test.describe("visual capture", () => {
  test.describe.configure({ mode: "serial" });

  test("login", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: shot(`login-${viewport.name}`), fullPage: true, animations: "disabled" });
    }
  });

  test("authenticated shell", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();

    // One dataset so the dataset surfaces have something real to render.
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await page.getByTestId("preview-panel").waitFor();
    await page.getByTestId("dataset-name").fill("visual-shell");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    const datasetUrl = page.url();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of [
        ["home", "/"], ["datasets", "/datasets"], ["import", "/import"], ["dataset-detail", datasetUrl],
      ] as const) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: shot(`${name}-${viewport.name}`), fullPage: true, animations: "disabled" });
      }
    }

    // Sidebar collapsed, and the mobile off-canvas menu opened.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/datasets");
    await page.getByRole("button", { name: "« ย่อเมนู" }).click();
    await page.screenshot({ path: shot("sidebar-rail-1440"), fullPage: false, animations: "disabled" });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/datasets");
    await page.getByRole("button", { name: "เปิดเมนู" }).click();
    await page.screenshot({ path: shot("sidebar-open-375"), fullPage: false, animations: "disabled" });

    await context.close();
  });

  /**
   * V2 surfaces: every import phase that has its own presentation, and the
   * dataset detail in both completed and partial shape.
   */
  test("import phases and the partial dataset", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });

    const shoot = (name: string) =>
      page.screenshot({ path: shot(name), fullPage: true, animations: "disabled" });

    // idle — the drop zone before a file is chosen.
    await page.goto("/import");
    await shoot("import-phase-idle-1440");

    // rejected — validation refused the file.
    await page.getByTestId("file-input").setInputFiles(join(TMP, "invalid.json"));
    await page.getByTestId("preview-button").click();
    await page.getByTestId("import-error").waitFor();
    await shoot("import-phase-rejected-1440");

    // preview — the panel with stats, counts and the quality strip.
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await page.getByTestId("preview-panel").waitFor();
    await shoot("import-phase-preview-1440");
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await shoot(`import-preview-${viewport.name}`);
    }

    // A completed dataset, then the same page for a partial run.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("dataset-name").fill("visual-completed");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    const completedUrl = page.url();

    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "partial.json"));
    await page.getByTestId("preview-button").click();
    await page.getByTestId("partial-warning").waitFor();
    await shoot("import-preview-partial-1440");
    await page.getByTestId("dataset-name").fill("visual-partial");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    const partialUrl = page.url();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(completedUrl);
      await page.getByTestId("quality-strip").waitFor();
      await shoot(`dataset-completed-${viewport.name}`);
      await page.goto(partialUrl);
      await page.getByTestId("partial-banner").waitFor();
      await shoot(`dataset-partial-${viewport.name}`);
      await page.goto("/datasets");
      await shoot(`dataset-list-${viewport.name}`);
    }

    // The full field table, opened.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(completedUrl);
    await page.getByTestId("quality-strip-more").locator("summary").click();
    await shoot("quality-strip-expanded-1440");

    await context.close();
  });

  /** V3: the Explorer in every state a researcher works in. */
  test("ads explorer", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });

    const shoot = (name: string) =>
      page.screenshot({ path: shot(name), fullPage: true, animations: "disabled" });

    // The 500-ad export, so the grid is a real research surface.
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles("tests/fixtures/golden-500.json");
    await page.getByTestId("preview-button").click();
    await page.getByTestId("preview-panel").waitFor();
    await page.getByTestId("dataset-name").fill("visual-explorer");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    const datasetUrl = page.url();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(datasetUrl);
      await page.getByTestId("ads-grid").waitFor();
      // A phone-width full-page shot of 30 stacked cards is 20,000px tall and
      // unreadable, so narrow widths capture the grid itself in the viewport.
      if (viewport.width < 768) await page.getByTestId("ads-grid").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: shot(`explorer-grid-${viewport.name}`),
        fullPage: viewport.width >= 768,
        animations: "disabled",
      });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?platform=INSTAGRAM&evergreen=true`);
    await page.getByTestId("filter-chips").waitFor();
    await shoot("explorer-filtered-1440");

    await page.getByTestId("advanced-toggle").click();
    await page.getByTestId("advanced-panel").waitFor();
    await shoot("explorer-advanced-1440");

    await page.goto(datasetUrl);
    await page.getByTestId("view-table").click();
    await page.getByTestId("ads-table").waitFor();
    await shoot("explorer-table-1440");
    await page.setViewportSize({ width: 375, height: 812 });
    await shoot("explorer-table-375");

    // Empty state: a filter combination the snapshot cannot satisfy.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?search=${encodeURIComponent("ไม่มีคำนี้อยู่จริง")}`);
    await page.getByTestId("explorer-empty").waitFor();
    await shoot("explorer-empty-1440");

    // Media unavailable: block every image, so the grid shows placeholders.
    await page.route("**/*", (route) =>
      route.request().resourceType() === "image" ? route.abort() : route.continue());
    await page.goto(datasetUrl);
    await page.getByTestId("ads-grid").waitFor();
    await shoot("explorer-media-unavailable-1440");
    await page.unroute("**/*");

    await context.close();
  });

  test("viewer sees no import form", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: join(AUTH, "viewer.json"),
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto("/import");
    await page.getByTestId("viewer-notice").waitFor();
    await page.screenshot({ path: shot("import-viewer-1440"), fullPage: true, animations: "disabled" });
    await context.close();
  });
});
