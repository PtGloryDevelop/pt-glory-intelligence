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
      await page.screenshot({ path: shot(`login-${viewport.name}`), fullPage: true });
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
        await page.screenshot({ path: shot(`${name}-${viewport.name}`), fullPage: true });
      }
    }

    // Sidebar collapsed, and the mobile off-canvas menu opened.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/datasets");
    await page.getByRole("button", { name: "« ย่อเมนู" }).click();
    await page.screenshot({ path: shot("sidebar-rail-1440"), fullPage: false });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/datasets");
    await page.getByRole("button", { name: "เปิดเมนู" }).click();
    await page.screenshot({ path: shot("sidebar-open-375"), fullPage: false });

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
    await page.screenshot({ path: shot("import-viewer-1440"), fullPage: true });
    await context.close();
  });
});
