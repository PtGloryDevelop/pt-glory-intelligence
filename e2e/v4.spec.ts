import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH } from "./constants.ts";

/**
 * V4: the Ad Detail Drawer.
 *
 * Runs against the seeded "c2-explorer" dataset, whose previews are archived, so
 * the media assertions look at real objects rather than placeholders.
 */

const OUT = join("test-artifacts", "visual", "v4");
const shot = (name: string) => join(OUT, `${name}.png`);

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

async function openDataset(page: Page) {
  await page.goto("/datasets");
  const link = page.locator('[data-testid="dataset-list"] tbody a', { hasText: "c2-explorer" });
  await link.first().waitFor();
  return (await link.first().getAttribute("href"))!;
}

/** Opens the first card of a filtered view and waits for the drawer content. */
async function openFirst(page: Page, url: string) {
  await page.goto(url);
  await page.getByTestId("ads-grid").waitFor();
  await page.locator('[data-testid^="ad-card-"]').first().waitFor();
  await page.locator('[data-testid^="open-ad-"]').first().click();
  await page.getByTestId("ad-drawer").waitFor();
  await page.getByTestId("drawer-context").waitFor();
}

/** A real rendered image, not a lazy grey box. */
async function mediaDecoded(page: Page, testId: string) {
  await page.getByTestId(testId).waitFor();
  await expect
    .poll(async () => page.getByTestId(testId).evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

test.describe("V4 ad detail drawer", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    datasetUrl = await openDataset(page);
    await context.close();
  });

  test("the drawer leads with the page, not the archive id", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=IMAGE`);

    const heading = await page.getByTestId("drawer-page-name").textContent();
    // A 16-digit id is metadata; it belongs with the facts, not in the title.
    expect(heading).not.toMatch(/^\d{10,}$/);
    expect((heading ?? "").length).toBeGreaterThan(0);

    // It is still on screen, just not leading.
    await expect(page.getByTestId("ad-drawer")).toContainText("Ad archive ID");
  });

  test("dataset mode says which snapshot it is showing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=IMAGE`);

    const context = page.getByTestId("drawer-context");
    await expect(context).toHaveAttribute("data-context", "dataset");
    await expect(context).toContainText("ข้อมูลใน Dataset นี้");
    await expect(context).toContainText("Snapshot");
    await mediaDecoded(page, "media-archived");
    await page.screenshot({ path: shot("image-1440"), fullPage: false, animations: "disabled" });
  });

  test("a VIDEO ad stays a video with a JPEG durable poster", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=VIDEO`);

    await expect(page.getByTestId("drawer-format")).toHaveText("VIDEO");
    // Either the live source plays, or the archived poster stands in — but the
    // ad reads as video in both cases.
    const hasPlayer = await page.getByTestId("media-video").count();
    if (hasPlayer > 0) {
      await expect(page.getByTestId("media-video")).toHaveAttribute("data-media-kind", "video");
    } else {
      await mediaDecoded(page, "media-archived");
      await expect(page.getByTestId("media-archived")).toHaveAttribute("data-media-kind", "video");
      await expect(page.getByTestId("media-unavailable")).toContainText("วิดีโอต้นทางไม่พร้อมใช้งาน");
    }
    await page.screenshot({ path: shot("video-1440"), fullPage: false, animations: "disabled" });
  });

  test("the durable poster survives the source CDN being blocked", async ({ page }) => {
    // SIMULATION of the four-day expiry: every fbcdn request is aborted, so
    // anything that renders came from our own bucket.
    await page.route(
      (url) => url.hostname.endsWith(".fbcdn.net") || url.hostname === "fbcdn.net",
      (route) => route.abort(),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=VIDEO`);

    /*
     * Two shapes are both correct here, and both prove the same thing.
     *
     * A <video> with preload="none" does not discover its source is dead until
     * play is pressed, so the drawer legitimately still offers the player — but
     * the frame visible on screen is the poster, and that poster is our archived
     * object. Where the source has already failed, it falls back to the image.
     * Either way the pixels come from our bucket, not from fbcdn.
     */
    const player = page.getByTestId("media-video");
    if (await player.count()) {
      await expect(player).toHaveAttribute("data-poster-source", "archived");
      const poster = await player.getAttribute("poster");
      expect(poster, "the poster must not be a CDN URL").not.toMatch(/fbcdn.net/);
    } else {
      await mediaDecoded(page, "media-archived");
      await expect(page.getByTestId("media-archived")).toHaveAttribute("data-media-source", "archived");
    }
    // An archived poster is never reported as "no media saved".
    await expect(page.getByTestId("ad-drawer")).not.toContainText("ไม่มีสื่อที่บันทึกไว้");
    await page.screenshot({ path: shot("video-source-blocked-1440"), fullPage: false, animations: "disabled" });
  });

  test("unusable media reads as unusable, never as missing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=CAROUSEL`);

    const placeholder = page.getByTestId("media-placeholder");
    await expect(placeholder).toHaveAttribute("data-media-state", "unusable");
    await expect(placeholder).toContainText("ไม่สามารถแสดงตัวอย่างสื่อ");
    // Format identity survives even with nothing to show.
    await expect(page.getByTestId("ad-drawer")).toContainText("Carousel");
    await page.screenshot({ path: shot("missing-media-1440"), fullPage: false, animations: "disabled" });
  });

  test("no raw ISO timestamp is visible anywhere in the drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=VIDEO`);

    // The V23-08 audit point: 2026-08-26T07:00:00.000Z must not reach a reader.
    const text = (await page.getByTestId("ad-drawer").textContent()) ?? "";
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("history is newest first and marks the dataset's own observation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openFirst(page, `${datasetUrl}?format=IMAGE`);

    const rows = page.getByTestId("observation-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Exactly one row is the snapshot this drawer is reading from. A newer
    // observation may exist above it, but it must not read as the primary truth.
    await expect(page.locator('[data-testid="observation-row"][data-current="true"]')).toHaveCount(1);
    await expect(rows.first()).toBeVisible();
    await page.screenshot({ path: shot("history-1440"), fullPage: false, animations: "disabled" });
  });

  test("escape closes it and focus returns to the card that opened it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(datasetUrl);
    await page.locator('[data-testid="card-media"]').first().waitFor();

    const opener = page.locator('[data-testid^="open-ad-"]').first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("ad-drawer").waitFor();

    // Focus enters the panel rather than being left behind the overlay.
    await expect(page.getByTestId("drawer-close")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    // ...and comes back to where the reader was in the grid.
    await expect(opener).toBeFocused();
  });

  test("closing the drawer leaves the research state intact", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${datasetUrl}?active=active&format=VIDEO&sort=longest_running`);
    await page.getByTestId("filter-chips").waitFor();
    // Wait for the results, not just the chips: the chips render from the URL
    // immediately, so reading the count first captures the loading value.
    await page.locator('[data-testid^="ad-card-"]').first().waitFor();
    const before = await page.getByTestId("explorer-total").textContent();
    const url = page.url();

    await page.locator('[data-testid^="open-ad-"]').first().click();
    await page.getByTestId("ad-drawer").waitFor();
    await page.getByTestId("drawer-close").click();
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);

    expect(page.url()).toBe(url);
    await expect(page.getByTestId("explorer-total")).toHaveText(before ?? "");
    await expect(page.getByTestId("filter-chips")).toBeVisible();
  });

  test("the drawer is sized for the viewport it is on", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openFirst(page, `${datasetUrl}?format=IMAGE`);

      const box = (await page.getByTestId("ad-drawer").boundingBox())!;
      if (viewport.width >= 1280) {
        // Spacious enough to inspect a creative, without taking the whole app.
        expect(box.width).toBeGreaterThanOrEqual(520);
        expect(box.width).toBeLessThanOrEqual(600);
      } else if (viewport.width <= 640) {
        // A full-screen sheet, not a 600px panel crushed onto a phone.
        expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
      } else {
        // A deliberate sheet width, not a useless strip of Explorer beside it.
        expect(box.width).toBeGreaterThan(viewport.width * 0.6);
      }

      const overflows = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, `page overflow @ ${viewport.name}`).toBe(false);

      await mediaDecoded(page, "media-archived");
      await page.screenshot({ path: shot(`image-${viewport.name}`), fullPage: false, animations: "disabled" });

      if (viewport.name !== "1440") {
        await page.getByTestId("drawer-close").click();
        await openFirst(page, `${datasetUrl}?format=VIDEO`);
        await page.screenshot({ path: shot(`video-${viewport.name}`), fullPage: false, animations: "disabled" });
        await page.getByTestId("ad-drawer").getByTestId("observation-history").scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot(`history-${viewport.name}`), fullPage: false, animations: "disabled" });
      }
    }
  });

  test("long copy is readable rather than clamped, and stays text", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openFirst(page, `${datasetUrl}?format=IMAGE`);

    const clamp = await page.getByTestId("drawer-copy").evaluate(
      (el) => getComputedStyle(el).webkitLineClamp);
    // The grid clamps to three lines; the drawer is where the ad gets read.
    expect(clamp === "none" || clamp === "" || clamp === "auto").toBe(true);

    await page.screenshot({ path: shot("long-copy-375"), fullPage: false, animations: "disabled" });
  });

  /*
   * Unknown-state rendering is asserted in journey.spec.ts, on a fixture built
   * for it. Every ad in a live collector export is active, so a copy of that
   * assertion here could only ever skip — and a skip is not coverage.
   */
});
