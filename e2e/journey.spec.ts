import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";
import { resetData } from "./db.ts";

const analyst = { storageState: join(AUTH, "analyst.json") };
const GOLDEN = "tests/fixtures/golden-500.json";

/** Upload → preview → confirm, returning the dataset URL the app lands on. */
async function importFile(page: Page, file: string, datasetName: string) {
  await page.goto("/import");
  await page.getByTestId("category-select").selectOption({ label: CATEGORY });
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("preview-button").click();
  await expect(page.getByTestId("preview-panel")).toBeVisible();
  await page.getByTestId("dataset-name").fill(datasetName);
  await page.getByTestId("commit-button").click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  return page.url();
}

/**
 * Grid is the default research view. Analyst assertions below read the table,
 * so they switch to it explicitly rather than assuming a default.
 */
async function showTable(page: Page) {
  await page.getByTestId("view-table").click();
  await expect(page.getByTestId("ads-table")).toBeVisible();
}

test.describe("import to explorer to drawer", () => {
  test.use(analyst);

  // Other spec files import into the same database; this journey asserts on
  // absolute state ("no datasets yet", "exactly two observations"), so it needs
  // its own floor rather than whatever ran before it.
  test.beforeAll(resetData);

  test("the full journey on the real 500-ad export", async ({ page }) => {
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(GOLDEN);
    await page.getByTestId("preview-button").click();

    // Preview must be a read: the server's own counts, no dataset yet.
    await expect(page.getByTestId("preview-ads")).toHaveText("500");
    await expect(page.getByTestId("preview-pages")).toHaveText("309");
    await expect(page.getByTestId("preview-quarantine")).toHaveText("0");
    // An analyst reads the neutral label, never the collector's own name (C03).
    await expect(page.getByTestId("preview-method")).toHaveText("นำเข้าจากไฟล์");
    await expect(page.getByTestId("coverage-table")).toBeVisible();
    await page.goto("/datasets");
    await expect(page.getByTestId("datasets-empty")).toBeVisible();

    const datasetUrl = await importFile(page, GOLDEN, "golden-journey");
    const datasetId = datasetUrl.split("/").pop()!;

    // The list carries the run's own counts, not a cached number on the dataset.
    await page.goto("/datasets");
    const listRow = page.getByTestId(`dataset-row-${datasetId}`);
    await expect(listRow.locator("td").nth(6)).toHaveText("500");
    await expect(listRow.locator("td").nth(7)).toHaveText("309");
    await expect(listRow.locator("td").nth(8)).toHaveText("completed");
    await page.goto(datasetUrl);

    await expect(page.getByTestId("context-ads")).toHaveText("500");
    await expect(page.getByTestId("context-pages")).toHaveText("309");
    await expect(page.getByTestId("context-status")).toHaveText("completed");

    // Quality never states a percentage without the pair it came from.
    const firstQuality = page.getByTestId("quality-strip").locator("tbody tr").first();
    await expect(firstQuality.locator("td").nth(1)).toContainText(" / 500");

    // Grid is the default research view.
    await expect(page.getByTestId("ads-grid")).toBeVisible();
    await expect(page.getByTestId("explorer-total")).toContainText("500");

    // Filters run server-side: the total changes, not just the visible rows.
    await page.getByTestId("f-platform").selectOption("INSTAGRAM");
    await expect(page.getByTestId("explorer-total")).not.toContainText("พบ 500");
    await page.getByTestId("filter-search").fill("ไม่มีคำนี้อยู่จริงแน่นอน");
    await expect(page.getByTestId("explorer-empty")).toBeVisible();
    await page.getByTestId("reset-filters").click();
    await expect(page.getByTestId("explorer-total")).toContainText("พบ 500");

    // Pagination
    await showTable(page);
    const firstId = await page.getByTestId("ads-table").locator("tbody tr").first()
      .getAttribute("data-testid");
    await page.getByTestId("next-page").click();
    await expect(page.getByTestId("ads-table").locator("tbody tr").first())
      .not.toHaveAttribute("data-testid", firstId!);
    await page.getByTestId("prev-page").click();

    // Drawer
    await page.getByTestId("ads-table").locator("tbody tr").first()
      .getByRole("button").click();
    const drawer = page.getByTestId("ad-drawer");
    // V4 states which snapshot, rather than only that it is one.
    await expect(drawer.getByTestId("drawer-context")).toContainText("ข้อมูลใน Dataset นี้");
    await expect(drawer.getByTestId("drawer-context")).toHaveAttribute("data-context", "dataset");
    await expect(drawer.getByTestId("observation-history")).toBeVisible();
    await drawer.getByTestId("drawer-close").click();
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);

    expect(datasetUrl).toContain("/datasets/");
  });

  test("the explorer is a research tool: filters, chips, sort, views and a shareable URL", async ({ page }) => {
    await importFile(page, GOLDEN, "e2e-explorer");
    await expect(page.getByTestId("ads-grid")).toBeVisible();
    const total = page.getByTestId("explorer-total");
    await expect(total).toContainText("พบ 500");

    // A primary filter narrows the set on the server and appears as a chip.
    // Platform rather than status: every ad in the golden export is active, so
    // filtering on status would prove nothing about where filtering happens.
    await page.getByTestId("f-platform").selectOption("INSTAGRAM");
    await expect(page.getByTestId("chip-platform")).toBeVisible();
    await expect(total).not.toContainText("พบ 500");
    const narrowed = await total.textContent();

    // An advanced filter, from the panel, also runs on the server.
    await page.getByTestId("advanced-toggle").click();
    await expect(page.getByTestId("advanced-panel")).toBeVisible();
    await page.getByTestId("f-has-destination").selectOption("true");
    await expect(page.getByTestId("chip-hasDestination")).toBeVisible();
    await expect(total).not.toHaveText(narrowed!);

    // The URL carries the research state, so this view can be shared or reloaded.
    expect(page.url()).toContain("platform=INSTAGRAM");
    expect(page.url()).toContain("hasDestination=true");
    await page.reload();
    await expect(page.getByTestId("chip-platform")).toBeVisible();
    await expect(page.getByTestId("chip-hasDestination")).toBeVisible();

    // Removing one chip leaves the other applied.
    await page.getByTestId("chip-hasDestination").click();
    await expect(page.getByTestId("chip-hasDestination")).toHaveCount(0);
    await expect(page.getByTestId("chip-platform")).toBeVisible();

    // Sort is a key, and it survives in the URL too.
    await page.getByTestId("sort-select").selectOption("most_reused");
    expect(page.url()).toContain("sort=most_reused");
    await expect(page.getByTestId("ads-grid")).toBeVisible();

    // Back returns to the previous research state rather than leaving the page.
    await page.goBack();
    await expect(page.getByTestId("sort-select")).toHaveValue("started_desc");

    // Clear all empties the chips and restores the full set.
    await page.getByTestId("clear-all").click();
    await expect(page.getByTestId("filter-chips")).toHaveCount(0);
    await expect(total).toContainText("พบ 500");

    // Table mode and back, without losing the result.
    await showTable(page);
    await expect(page.getByTestId("ads-grid")).toHaveCount(0);
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("ads-grid")).toBeVisible();

    // Search, then open the drawer from a filtered result.
    await page.getByTestId("filter-search").fill("ลด");
    await expect(page.getByTestId("chip-search")).toBeVisible();
    const card = page.locator("[data-testid^='ad-card-']").first();
    await expect(card).toBeVisible();
    await card.getByRole("button").first().click();
    await expect(page.getByTestId("ad-drawer")).toBeVisible();
    await page.getByTestId("drawer-close").click();
    // Closing the drawer leaves the filtered view exactly as it was.
    await expect(page.getByTestId("chip-search")).toBeVisible();
  });

  test("an old dataset keeps its snapshot after a newer import", async ({ page }) => {
    const oldUrl = await importFile(page, join(TMP, "small-old.json"), "e2e-old");
    await showTable(page);
    await expect(page.getByTestId("ads-table")).toContainText("IMAGE");

    await importFile(page, join(TMP, "small-new.json"), "e2e-new");
    await showTable(page);
    await expect(page.getByTestId("ads-table")).toContainText("VIDEO");

    // The proof: reopening the old dataset must not show the newer observation.
    await page.goto(oldUrl);
    await showTable(page);
    const row = page.getByTestId("ads-table").locator("tbody tr").first();
    await expect(row).toContainText("IMAGE");
    await expect(row).toContainText("FACEBOOK");
    await expect(row).toContainText("Active");
    await expect(row).not.toContainText("VIDEO");

    await row.getByRole("button").click();
    await expect(page.getByTestId("drawer-format")).toHaveText("IMAGE");
    await expect(page.getByTestId("drawer-active")).toHaveText("Active");
    // History carries both runs even though the snapshot shows one.
    await expect(page.getByTestId("observation-row")).toHaveCount(2);
    // ...and exactly one of them is the observation this dataset is pinned to,
    // so the newer run above it cannot read as the drawer's primary truth.
    await expect(page.locator('[data-testid="observation-row"][data-current="true"]')).toHaveCount(1);
  });

  test("a partial import says so instead of rounding it away", async ({ page }) => {
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "partial.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("partial-warning")).toBeVisible();
    await expect(page.getByTestId("preview-quarantine")).toHaveText("1");

    await page.getByTestId("dataset-name").fill("e2e-partial");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\//);
    await expect(page.getByTestId("context-status")).toHaveText("partial");
    await expect(page.getByTestId("context-quarantine")).toHaveText("1");
    // The banner states both real numbers: what landed and what did not.
    const banner = page.getByTestId("partial-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("กันไว้ตรวจ 1 แถว");

    // Pages is the dataset's own count; the run's larger count stays beside it
    // as provenance. Neither is substituted for the other.
    await expect(page.getByTestId("context-pages")).toHaveText("1");
    await expect(page.getByTestId("context-run-pages")).toHaveText("2");
    await page.goto("/datasets");
    const row = page.getByTestId("dataset-list").locator("tbody tr").first();
    await expect(row.locator("td").nth(7)).toHaveText("1");
  });

  test("the stepper follows the real phases and never claims a rejected file passed", async ({ page }) => {
    await page.goto("/import");
    const stepper = page.getByTestId("import-stepper");
    await expect(stepper).toHaveAttribute("data-phase", "idle");

    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible();
    await expect(stepper).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("step-upload")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("step-preview")).toHaveAttribute("data-state", "current");
    await expect(page.getByTestId("step-done")).toHaveAttribute("data-state", "todo");

    // A rejected file must not leave the stepper standing on a later step.
    await page.getByTestId("file-input").setInputFiles(join(TMP, "invalid.json"));
    await expect(stepper).toHaveAttribute("data-phase", "idle");
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("import-error")).toBeVisible();
    await expect(stepper).toHaveAttribute("data-phase", "rejected");
    await expect(page.getByTestId("step-validate")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("step-done")).toHaveAttribute("data-state", "todo");
  });

  test("the quality strip leads with the fields that carry the copy", async ({ page }) => {
    const url = await importFile(page, join(TMP, "small-old.json"), "e2e-quality-order");
    await page.goto(url);
    const first = page.getByTestId("quality-strip").locator("tbody tr").first();
    await expect(first.locator("td").first()).toHaveText("body_text");
    // Everything else stays reachable rather than being dropped.
    await expect(page.getByTestId("quality-strip-more")).toBeVisible();
  });

  test("an unreadable file is rejected before anything is written", async ({ page }) => {
    await page.goto("/import");
    await page.getByTestId("file-input").setInputFiles(join(TMP, "invalid.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("import-error")).toContainText("malformed_json");
    await expect(page.getByTestId("preview-panel")).toHaveCount(0);
  });

  test("unknown stays unknown and missing fields render as —", async ({ page }) => {
    await importFile(page, join(TMP, "small-unknown.json"), "e2e-unknown");
    await showTable(page);
    const row = page.getByTestId("ads-table").locator("tbody tr").first();
    await expect(row).toContainText("ไม่ทราบ");

    // Unknown is filterable in its own right, not folded into inactive.
    await page.getByTestId("f-active").selectOption("inactive");
    await expect(page.getByTestId("explorer-empty")).toBeVisible();
    await page.getByTestId("f-active").selectOption("unknown");
    await expect(page.getByTestId("ads-table").locator("tbody tr")).toHaveCount(1);

    await page.getByTestId("ads-table").locator("tbody tr").first().getByRole("button").click();
    await expect(page.getByTestId("drawer-format")).toHaveText("—");
    await expect(page.getByTestId("drawer-active")).toHaveText("—");
    await expect(page.getByTestId("media-placeholder")).toBeVisible();
  });

  test("media that will not load says so instead of showing a broken frame", async ({ page }) => {
    // Meta's CDN URLs expire; the drawer must survive that, not blank out.
    await page.route("**/*", (route) =>
      route.request().resourceType() === "image" ? route.abort() : route.continue(),
    );
    await importFile(page, GOLDEN, "e2e-media");
    await showTable(page);
    // An IMAGE ad specifically: a VIDEO renders a player, and a player with an
    // unreachable poster is not the broken frame this test is about.
    await page.getByTestId("f-format").selectOption("IMAGE");
    await expect(page.getByTestId("ads-table").locator("tbody tr").first()).toBeVisible();
    await page.getByTestId("ads-table").locator("tbody tr").first().getByRole("button").click();
    await expect(page.getByTestId("ad-drawer")).toBeVisible();
    const media = page.getByTestId("media-unavailable").or(page.getByTestId("media-placeholder"));
    await expect(media.first()).toBeVisible();
  });

  test("an ad outside the dataset is a 404, not the latest state", async ({ page }) => {
    const oldUrl = await importFile(page, join(TMP, "small-old.json"), "e2e-404-a");
    const datasetId = oldUrl.split("/").pop()!;
    const response = await page.request.get(
      `/api/ads/000000000000000?datasetId=${datasetId}`,
    );
    expect(response.status()).toBe(404);
  });
});

test.describe("viewer", () => {
  test.use({ storageState: join(AUTH, "viewer.json") });

  test("cannot import, and the server refuses even without the form", async ({ page }) => {
    await page.goto("/import");
    await expect(page.getByTestId("viewer-notice")).toBeVisible();
    await expect(page.getByTestId("file-input")).toHaveCount(0);

    const response = await page.request.post("/api/imports/commit", {
      multipart: { file: { name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") } },
    });
    expect(response.status()).toBe(403);
  });
});
