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

const OUT = join("test-artifacts", "visual", process.env.VISUAL_SLICE ?? "v23-audit");
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
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
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
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
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
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
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
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
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
    await viewerPage.getByTestId("forbidden-notice").waitFor();
    await viewerPage.screenshot({ path: shot("import-viewer-1440"), fullPage: true });
    await viewer.close();

    assertStyles();
  });
});

/**
 * The creative-filled state.
 *
 * The golden fixture carries the real URLs the collector recorded in August, and
 * those Meta CDN links have long since expired — so a truthful capture of the
 * real data shows "media exists, it will not load", which is exactly what the
 * product should say and exactly what it now says.
 *
 * To see the composition the grid is actually built for, image responses are
 * fulfilled locally. The URLs, their selection and every code path stay real;
 * only the bytes at the far end are substituted. This is a render-path proof,
 * not evidence about the data.
 */
const STUB_IMAGE = (label: string) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750">
     <rect width="600" height="750" fill="#f0e7d8"/>
     <rect x="24" y="24" width="552" height="702" fill="#e8dccf"/>
     <text x="300" y="380" font-family="sans-serif" font-size="34" fill="#6c5d54"
       text-anchor="middle">${label}</text>
   </svg>`, "utf8");

test.describe("creative-filled render path", () => {
  test.describe.configure({ mode: "serial" });

  test("grid and drawer with media served", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();

    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "image") return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: STUB_IMAGE("creative"),
      });
    });

    // Imports its own dataset so the capture stands alone rather than depending
    // on whichever test ran before it.
    await page.setViewportSize(WIDE);
    await resetData();
    await toPreview(page, join("tests", "fixtures", "golden-500.json"));
    const href = await commitAs(page, "c1-media");

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(href);
      await page.getByTestId("ads-grid").waitFor();
      await page.locator('[data-testid="card-media"]').first().waitFor();
      await capture(page, `media-grid-${viewport.name}`);
    }

    await page.setViewportSize(WIDE);
    await page.goto(href);
    await page.getByTestId("ads-grid").waitFor();
    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    await capture(page, "media-drawer-1440");

    await context.close();
  });
});
