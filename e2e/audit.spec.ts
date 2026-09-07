import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";
import { resetData } from "./db.ts";

/**
 * Capture matrix for the V2/V3 visual regression audit.
 *
 * Additive to screenshots.spec.ts, which stays as the per-slice capture for V1.
 * This one exists because the audit needs the same states at four viewports
 * rather than one, and because an audit run has to prove its own evidence is
 * trustworthy — see `guardStyles`, which fails the capture if any stylesheet
 * request does not come back 200. A stale `next start` serving old chunk hashes
 * once produced half-unstyled screenshots that looked like real defects.
 *
 * Captures only. No assertions about how anything looks.
 */

const OUT = join("test-artifacts", "visual", "v23-audit");
const shot = (name: string) => join(OUT, `${name}.png`);

const WIDE = { width: 1440, height: 1000 };
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

/** Fails the run if a CSS request 404s — evidence from a stale server is not evidence. */
function guardStyles(page: Page) {
  const broken: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".css") && !response.ok()) {
      broken.push(`${response.status()} ${response.url()}`);
    }
  });
  return () => expect(broken, "stylesheets failed to load").toEqual([]);
}

async function capture(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot(name), fullPage: true, animations: "disabled" });
}

/** Runs the import flow up to preview, leaving the page on the preview panel. */
async function toPreview(page: Page, fixture: string) {
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY });
  await page.getByTestId("file-input").setInputFiles(fixture);
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-panel").waitFor();
}

async function commitAs(page: Page, name: string) {
  await page.getByTestId("dataset-name").fill(name);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  return page.url();
}

test.describe("v2/v3 audit capture", () => {
  test.describe.configure({ mode: "serial" });

  test("import states at every viewport", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const assertStyles = guardStyles(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      await page.goto("/import");
      await capture(page, `import-idle-${viewport.name}`);

      await toPreview(page, join(TMP, "small-old.json"));
      await capture(page, `import-preview-${viewport.name}`);

      await toPreview(page, join(TMP, "partial.json"));
      await capture(page, `import-partial-${viewport.name}`);

      await page.goto("/import");
      await page.getByTestId("file-input").setInputFiles(join(TMP, "invalid.json"));
      await page.getByTestId("preview-button").click();
      await page.getByTestId("import-error").waitFor();
      await capture(page, `import-rejected-${viewport.name}`);
    }

    // Success lands on the dataset, so the "done" stepper state is caught just
    // before navigation completes.
    await page.setViewportSize(WIDE);
    await toPreview(page, join(TMP, "small-old.json"));
    await page.getByTestId("dataset-name").fill("audit-success");
    await page.getByTestId("commit-button").click();
    await capture(page, "import-committing-1440");
    await page.waitForURL(/\/datasets\//);
    await capture(page, "import-success-1440");

    assertStyles();
    await context.close();
  });

  test("dataset detail states at every viewport", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const assertStyles = guardStyles(page);

    await page.setViewportSize(WIDE);
    await toPreview(page, join("tests", "fixtures", "golden-500.json"));
    const completed = await commitAs(page, "audit-completed");

    await toPreview(page, join(TMP, "partial.json"));
    const partial = await commitAs(page, "audit-partial");

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      await page.goto(completed);
      await capture(page, `dataset-completed-${viewport.name}`);

      await page.goto(partial);
      await capture(page, `dataset-partial-${viewport.name}`);

      await page.goto(completed);
      await page.getByTestId("quality-strip-more").click();
      await capture(page, `dataset-quality-expanded-${viewport.name}`);
    }

    assertStyles();
    await context.close();
  });

  test("explorer states at every viewport", async ({ browser }) => {
    await resetData();
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const assertStyles = guardStyles(page);

    await page.setViewportSize(WIDE);
    await toPreview(page, join("tests", "fixtures", "golden-500.json"));
    const dataset = await commitAs(page, "audit-explorer");

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      await page.goto(dataset);
      await page.getByTestId("ads-grid").waitFor();
      await capture(page, `explorer-grid-${viewport.name}`);

      await page.goto(`${dataset}?active=active&format=VIDEO&platform=FACEBOOK`);
      await page.getByTestId("filter-chips").waitFor();
      await capture(page, `explorer-filtered-${viewport.name}`);

      await page.goto(dataset);
      await page.getByTestId("advanced-toggle").click();
      await page.getByTestId("advanced-panel").waitFor();
      await capture(page, `explorer-advanced-${viewport.name}`);

      await page.goto(dataset);
      await page.getByTestId("view-table").click();
      await page.getByTestId("ads-table").waitFor();
      await capture(page, `explorer-table-${viewport.name}`);

      await page.goto(`${dataset}?search=${encodeURIComponent("ไม่มีคำนี้อยู่จริงแน่นอน")}`);
      await page.getByTestId("explorer-empty").waitFor();
      await capture(page, `explorer-zero-${viewport.name}`);
    }

    // Media unavailable: block every image so the placeholder path renders.
    await page.setViewportSize(WIDE);
    await page.route("**/*", (route) =>
      route.request().resourceType() === "image" ? route.abort() : route.continue());
    await page.goto(dataset);
    await page.getByTestId("ads-grid").waitFor();
    await capture(page, "explorer-no-media-1440");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(dataset);
    await page.getByTestId("ads-grid").waitFor();
    await capture(page, "explorer-no-media-375");

    assertStyles();
    await context.close();
  });

  test("drawer and viewer states", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const assertStyles = guardStyles(page);

    await page.setViewportSize(WIDE);
    await page.goto("/datasets");
    const href = await page.locator('[data-testid="dataset-list"] tbody a').first().getAttribute("href");
    await page.goto(href!);
    await page.getByTestId("ads-grid").waitFor();
    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    await capture(page, "drawer-dataset-1440");

    await page.setViewportSize({ width: 375, height: 812 });
    await capture(page, "drawer-dataset-375");
    await context.close();

    const viewer = await browser.newContext({
      storageState: join(AUTH, "viewer.json"), viewport: WIDE,
    });
    const viewerPage = await viewer.newPage();
    await viewerPage.goto("/import");
    await viewerPage.getByTestId("viewer-notice").waitFor();
    await viewerPage.screenshot({ path: shot("import-viewer-1440"), fullPage: true });
    await viewer.close();

    assertStyles();
  });
});
