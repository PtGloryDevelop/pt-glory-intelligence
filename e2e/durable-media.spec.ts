import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";
import { resetData } from "./db.ts";

/**
 * End-to-end proof that a dataset keeps its creatives after the source dies.
 *
 * Needs a collector export whose signed URLs are still inside their ~105-hour
 * window; point FRESH_EXPORT at one. Without it the whole file skips rather than
 * pretending: an expired source cannot prove archival works.
 */

const FRESH = process.env.FRESH_EXPORT;
const SLICE = join(TMP, "fresh-slice.json");

test.describe("durable preview archive", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!FRESH || !existsSync(FRESH), "set FRESH_EXPORT to a recent collector export");
  // The import step is admin-only since C14; the archive assertions that
  // follow are about storage, not about who is signed in.
  test.use({ storageState: join(AUTH, "admin.json") });

  let datasetUrl = "";

  test("import, archive, and render from our own storage", async ({ page }) => {
    // A small slice keeps the run quick while using entirely real URLs.
    const source = JSON.parse(readFileSync(FRESH!, "utf8"));
    // A deliberate mix: the format-semantics assertion needs at least one VIDEO
    // ad, and taking the first N happens to give none.
    const videos = source.ads.filter((ad: { display_format?: string }) => ad.display_format === "VIDEO").slice(0, 5);
    const others = source.ads.filter((ad: { display_format?: string }) => ad.display_format !== "VIDEO").slice(0, 7);
    const ads = [...videos, ...others];
    const pages = new Set(ads.map((ad: { page_id: string }) => ad.page_id).filter(Boolean));
    mkdirSync(TMP, { recursive: true });
    writeFileSync(SLICE, JSON.stringify({
      ...source,
      source_rows: ads.length, unique_ads: ads.length,
      unique_pages: pages.size, unresolved_count: 0,
      ads, unresolved_ads: [],
    }));

    await resetData();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(SLICE);
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible();
    await page.getByTestId("dataset-name").fill("durable-media-proof");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    datasetUrl = page.url();

    // Before the drain the grid renders from the source URL — still alive, since
    // this export is fresh.
    await page.getByTestId("ads-grid").waitFor();
    const beforeSources = await page.locator("[data-media-source]").evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute("data-media-source")),
    );
    expect(beforeSources.length).toBeGreaterThan(0);
    expect(beforeSources.every((state) => state === "source")).toBe(true);

    // Turn the crank. The queue is in the database; this is one invocation of it.
    const drain = await page.request.post("/api/media/archive?limit=50");
    expect(drain.status()).toBe(200);
    const stats = await drain.json();
    expect(stats.archived).toBeGreaterThan(0);
    expect(stats.failed).toBe(0);

    // Now the same page renders from our bucket instead.
    await page.goto(datasetUrl);
    await page.getByTestId("ads-grid").waitFor();
    await expect(page.locator('[data-media-source="archived"]').first()).toBeVisible();
    const archived = await page.locator('[data-media-source="archived"]').count();
    expect(archived).toBeGreaterThan(0);
  });

  test("the creative survives the source CDN going away", async ({ page }) => {
    // SIMULATION of the four-day expiry: every fbcdn request is aborted, so the
    // only way an image can render is from the archived object.
    // A host predicate rather than a glob: a pattern broad enough to catch every
    // fbcdn URL shape is also broad enough to catch the app's own requests, and
    // blocking those would fail the test for the wrong reason.
    await page.route(
      (url) => url.hostname.endsWith(".fbcdn.net") || url.hostname === "fbcdn.net",
      (route) => route.abort(),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(datasetUrl);
    await page.getByTestId("ads-grid").waitFor();

    const rendered = page.locator('[data-testid="card-media"][data-media-source="archived"]');
    await expect(rendered.first()).toBeVisible();

    // The images are not merely present in the DOM — they decoded.
    const decoded = await rendered.evaluateAll(
      (nodes) => nodes.filter((node) => (node as HTMLImageElement).naturalWidth > 0).length,
    );
    expect(decoded, "archived previews must render with the CDN unreachable").toBeGreaterThan(0);
  });

  test("a VIDEO ad stays a video even though its preview is a JPEG", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?format=VIDEO`);
    // Wait for a rendered card: counting before the fetch resolves would
    // silently skip the assertion instead of making it.
    await page.getByTestId("ads-grid").waitFor();
    await page.locator('[data-testid^="ad-card-"]').first().waitFor();

    // The archived file is a JPEG poster. The AD is still a video, and the card
    // must say so — this is the semantic split C1 exposed.
    const videoCards = page.locator('[data-testid="card-media"][data-media-kind="video"]');
    await expect(videoCards.first()).toBeVisible();
    expect(await videoCards.count()).toBeGreaterThan(0);

    // ...and it is being served from our bucket, not the CDN.
    await expect(videoCards.first()).toHaveAttribute("data-media-source", "archived");
  });
});
