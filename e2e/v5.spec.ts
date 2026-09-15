import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY } from "./constants.ts";

/**
 * V5: the final consistency sweep, and the release screenshot set.
 *
 * Nothing here is a new feature. These assertions exist because V1 to V4 were
 * built as separate slices, and the risk at the end of that is not that any one
 * screen is wrong — it is that five right screens do not add up to one product.
 * So the subject is agreement: same gutters, same scale, same words for the same
 * state, same behaviour under a keyboard, on every route.
 *
 * Runs against the seeded "c2-explorer" dataset, whose previews are archived, so
 * the captures show real creatives rather than placeholders.
 */

const OUT = join("test-artifacts", "visual", "v5");
const shot = (name: string) => join(OUT, `${name}.png`);

/** Every breakpoint boundary the shell, the grid and the tables react to. */
const WIDTHS = [375, 640, 768, 900, 1024, 1280, 1440];

const ROUTES = ["/", "/datasets", "/import"];

async function datasetUrl(page: Page): Promise<string> {
  await page.goto("/datasets");
  // Supabase access tokens last an hour. This project runs on the sessions the
  // setup project wrote, so a long gate can arrive here signed out — which
  // otherwise shows up as every later test waiting for a page that is never
  // going to render.
  expect(
    new URL(page.url()).pathname,
    "signed out: re-run --project=setup, re-seed the c2-explorer dataset, then this project",
  ).not.toBe("/login");
  const link = page.locator('[data-testid="dataset-list"] tbody a', { hasText: "c2-explorer" });
  await link.first().waitFor();
  return (await link.first().getAttribute("href"))!;
}

/** Any element whose right edge is past the viewport is a horizontal overflow. */
async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/**
 * Real media on screen, not a lazy grey box.
 *
 * An image has to have decoded. A video element is a player whose visible frame
 * before play is the archived poster, and with preload="none" there is nothing
 * else to wait for — so what is checked there is that a poster was given and the
 * player occupies the stage.
 */
async function mediaDecoded(target: Locator) {
  await target.waitFor();
  await expect.poll(async () => target.evaluate((el) => {
    if (el instanceof HTMLImageElement) return el.naturalWidth;
    const poster = (el as HTMLVideoElement).poster;
    return poster && el.getBoundingClientRect().height > 0 ? 1 : 0;
  })).toBeGreaterThan(0);
}

/**
 * Every card the screenshot will contain has decoded.
 *
 * Only the ones on screen: the grid loads lazily on purpose, so demanding that
 * all sixty images decode would be asking the product to stop doing the thing
 * that makes it fast. Off-screen cards are grey boxes by design, and they are
 * not in the capture.
 */
async function gridSettled(page: Page) {
  await page.getByTestId("ads-grid").waitFor();
  await page.locator('[data-testid^="ad-card-"]').first().waitFor();
  await expect.poll(
    async () => page.locator('[data-testid="card-media"]').evaluateAll((nodes) =>
      nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        const onScreen = box.top < window.innerHeight && box.bottom > 0;
        return onScreen && (node as HTMLImageElement).naturalWidth === 0;
      }).length),
    { timeout: 30_000 },
  ).toBe(0);
}

/**
 * The captures named for the Explorer must actually contain it — with its
 * creatives loaded. Scrolling brings a new set of lazy images into view, so the
 * settle has to happen after the scroll, not before it.
 */
async function showExplorer(page: Page, testId = "ads-grid") {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  const media = testId === "ads-table" ? "row-media" : "card-media";
  await expect.poll(
    async () => page.locator(`[data-testid="${media}"]`).evaluateAll((nodes) =>
      nodes.filter((node) => {
        const box = node.getBoundingClientRect();
        const onScreen = box.top < window.innerHeight && box.bottom > 0;
        return onScreen && (node as HTMLImageElement).naturalWidth === 0;
      }).length),
    { timeout: 30_000 },
  ).toBe(0);
}

async function openFirstCard(page: Page) {
  await page.locator('[data-testid^="open-ad-"]').first().click();
  await page.getByTestId("ad-drawer").waitFor();
  await page.getByTestId("drawer-context").waitFor();
}

test.describe("V5 final consistency", () => {
  test.describe.configure({ mode: "serial" });
  // /import is in the route matrix, and C14 made it admin-only.
  test.use({ storageState: join(AUTH, "admin.json") });

  let dataset = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();
    dataset = await datasetUrl(page);
    await context.close();
  });

  /* ---------------------------------------------------------------- layout */

  test("every page is inset by the same gutter and held to the same measure", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const seen = new Set<string>();

    for (const route of [...ROUTES, dataset]) {
      await page.goto(route);
      const box = await page.getByTestId("shell-content").evaluate((el) => {
        const style = getComputedStyle(el);
        return { padding: style.padding, maxWidth: style.maxWidth };
      });
      seen.add(box.padding);
      // A dataset page is deliberately wider — it carries the research grid —
      // but it is the only exception, and it is a different token, not a
      // different number invented locally.
      expect(["1180px", "1440px"]).toContain(box.maxWidth);
    }

    expect(seen.size, `pages disagree about the page gutter: ${[...seen].join(" / ")}`).toBe(1);
  });

  test("no route runs off the side at any width", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...ROUTES, dataset]) {
        await page.goto(route);
        await page.getByTestId("shell-content").waitFor();
        expect(await overflowsSideways(page), `${route} overflows at ${width}px`).toBe(false);
      }
    }
  });

  test("the sidebar rail never shows a truncated section name", async ({ page }) => {
    // Below 1440 the sidebar collapses to a 68px rail. The section headings used
    // to shrink to 9px and clip; they are dividers now, and a divider cannot be
    // half a word.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/datasets");
    const heading = page.getByTestId("app-sidebar").locator("nav > div > div").first();
    await heading.waitFor();
    const size = await heading.evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe("0px");
  });

  /* ------------------------------------------------------------ typography */

  test("no rendered text sits outside the type scale", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const SCALE = [24, 19, 17, 16, 15, 14, 12.5, 11.5, 11];

    for (const route of [...ROUTES, dataset]) {
      await page.goto(route);
      await page.getByTestId("shell-content").waitFor();
      const strays = await page.evaluate((scale) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          // Only elements that actually render text of their own.
          const own = Array.from(el.childNodes).some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim().length > 0);
          if (!own) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size === 0) continue; // deliberately hidden, kept for screen readers
          if (!scale.some((allowed) => Math.abs(allowed - size) < 0.51)) {
            out.push(`${el.tagName.toLowerCase()}.${el.className} @ ${size}px`);
          }
        }
        return out;
      }, SCALE);
      expect(strays, `${route} renders text outside the scale`).toEqual([]);
    }
  });

  test("Thai text is never cut off by its own line box", async ({ page }) => {
    // Tone marks and upper vowels stack above the line; a tight line-height or a
    // fixed height clips them, and the loss is silent — the text still reads,
    // just wrongly. 375 and 768 are where the boxes are tightest.
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(dataset);
      await gridSettled(page);

      const clipped = await page.evaluate(() => {
        const out: string[] = [];
        const thai = /[฀-๿]/;
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const text = Array.from(el.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent!.trim()).join("");
          if (!thai.test(text)) continue;
          // A one-pixel box is the visually-hidden pattern: text kept for
          // assistive technology, never painted, so it cannot be visibly cut.
          if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
          const style = getComputedStyle(el);
          if (style.overflow === "visible" && style.overflowY === "visible") continue;
          // A single-line ellipsis is a deliberate truncation, not a clip.
          if (style.textOverflow === "ellipsis") continue;
          if (style.webkitLineClamp && style.webkitLineClamp !== "none") continue;
          if (el.scrollHeight > el.clientHeight + 1) {
            out.push(`${el.tagName.toLowerCase()}.${el.className}: "${text.slice(0, 30)}"`);
          }
        }
        return out;
      });
      expect(clipped, `Thai text is clipped at ${width}px`).toEqual([]);
    }
  });

  /* ------------------------------------------------------------------ time */

  test("no route shows a raw ISO date", async ({ page }) => {
    // V23-08, closed in V4 for the drawer and re-checked here for everything
    // else. A stored timestamp is a fact; printing it unformatted is a leak of
    // the storage format into the reading surface.
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const route of [...ROUTES, dataset]) {
      await page.goto(route);
      await page.getByTestId("shell-content").waitFor();
      const text = await page.getByTestId("shell-content").innerText();
      expect(text, `${route} prints a raw date`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  test("the four time facts stay four different things", async ({ page }) => {
    // Start Date is Meta's. First Seen and Last Seen are ours. Collected At
    // belongs to the run. Collapsing any pair would quietly rewrite what the
    // number means.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(dataset);
    await gridSettled(page);
    await openFirstCard(page);

    const drawer = page.getByTestId("ad-drawer");
    for (const label of ["เริ่มแสดง", "พบครั้งแรก", "พบครั้งล่าสุด"]) {
      await expect(drawer.getByText(label, { exact: true })).toBeVisible();
    }
    // ...and the snapshot line names the run's own observation time, separately.
    await expect(drawer.getByTestId("drawer-context")).toContainText("Snapshot");
  });

  /* ---------------------------------------------------------------- states */

  test("loading looks like loading, not like nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Hold the ads response long enough to read the intermediate state.
    await page.route("**/api/datasets/*/ads*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto(dataset);

    const skeleton = page.getByRole("status", { name: "กำลังโหลด…" });
    await expect(skeleton).toBeVisible();
    // The distinction that matters: it must not read as an answer.
    await expect(page.getByTestId("explorer-empty")).toHaveCount(0);
    await page.screenshot({ path: shot("loading-1440"), animations: "disabled" });
    await page.unroute("**/api/datasets/*/ads*");
  });

  test("an empty result and an empty dataset do not share a sentence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${dataset}?search=${encodeURIComponent("ไม่มีคำนี้อยู่จริงแน่นอน")}`);
    const empty = page.getByTestId("explorer-empty");
    await empty.waitFor();
    await expect(empty).toContainText("ตัวกรอง");
    await expect(empty).not.toContainText("ยังไม่มีโฆษณา");
    // ...and it offers the way out, which an empty dataset cannot.
    await expect(page.getByTestId("reset-filters")).toBeVisible();
  });

  /* --------------------------------------------------------------- buttons */

  test("primary actions keep the charcoal label and the blue focus ring", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/datasets");

    const cta = page.locator("[data-cta]").first();
    await cta.waitFor();
    const paint = await cta.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, background: style.backgroundColor };
    });
    // White on #F26522 is 3.15 and fails AA; this is the regression being held.
    expect(paint.color).toBe("rgb(44, 36, 31)");
    expect(paint.background).toBe("rgb(242, 101, 34)");

    await cta.focus();
    const outline = await cta.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outline).toBe("rgb(29, 78, 216)");
  });

  test("a disabled control still reads as a control", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(dataset);
    await gridSettled(page);
    const prev = page.getByTestId("prev-page");
    await expect(prev).toBeDisabled();
    const paint = await prev.evaluate((el) => {
      const style = getComputedStyle(el);
      return { opacity: style.opacity, color: style.color };
    });
    // Dimming the whole control to 0.5 measured 3.06 and read as "fading away".
    expect(paint.opacity).toBe("1");
    expect(paint.color).toBe("rgb(108, 93, 84)");
  });

  /* --------------------------------------------------------------- keyboard */

  test("the research surface is reachable and operable from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(dataset);
    await gridSettled(page);

    // Tab from the search field until a card takes focus: no keyboard trap and
    // no unreachable control in between.
    await page.getByTestId("filter-search").focus();
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() =>
        (document.activeElement?.getAttribute("data-testid") ?? "").startsWith("open-ad-"));
    }
    expect(reached, "no ad card could be reached by Tab").toBe(true);

    // Focus must be visible when it arrives, not only present.
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return { color: style.outlineColor, width: style.outlineWidth };
    });
    expect(ring.color).toBe("rgb(29, 78, 216)");
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await page.getByTestId("ad-drawer").waitFor();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    // ...and back on the card that opened it, not at the top of the document.
    expect(await page.evaluate(() =>
      (document.activeElement?.getAttribute("data-testid") ?? "").startsWith("open-ad-"))).toBe(true);
  });

  test("status is never carried by colour alone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(dataset);
    await gridSettled(page);
    const badge = page.locator('[data-testid^="ad-card-"] [data-status]').first();
    await badge.waitFor();
    expect((await badge.innerText()).trim().length).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------- the two journeys */

  test("a phone can run the whole research journey", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/datasets");
    await page.screenshot({ path: shot("datasets-375"), fullPage: true, animations: "disabled" });

    await page.goto(dataset);
    await gridSettled(page);
    expect(await overflowsSideways(page)).toBe(false);
    await showExplorer(page, "ads-grid");
    await page.screenshot({ path: shot("explorer-grid-375"), animations: "disabled" });

    // Filter, then read the count the server came back with.
    await page.getByTestId("f-format").selectOption("VIDEO");
    await expect(page.getByTestId("chip-format")).toBeVisible();
    await gridSettled(page);
    const filtered = (await page.getByTestId("explorer-total").innerText()).trim();
    await showExplorer(page, "ads-grid");
    await page.screenshot({ path: shot("explorer-filtered-375"), animations: "disabled" });

    await page.getByTestId("view-table").click();
    await page.getByTestId("ads-table").waitFor();
    expect(await overflowsSideways(page)).toBe(false);
    await showExplorer(page, "ads-table");
    await page.screenshot({ path: shot("explorer-table-375"), animations: "disabled" });
    await page.getByTestId("view-grid").click();
    await gridSettled(page);

    await openFirstCard(page);
    // Full-screen sheet on a phone, and it must not push the page sideways.
    const drawer = await page.getByTestId("ad-drawer").boundingBox();
    expect(drawer!.width).toBeCloseTo(375, 0);
    expect(await overflowsSideways(page)).toBe(false);
    await mediaDecoded(page.getByTestId("media-video").or(page.getByTestId("media-archived")).first());
    await page.screenshot({ path: shot("drawer-375"), animations: "disabled" });

    await page.getByTestId("observation-history").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("drawer-history-375"), animations: "disabled" });

    await page.getByTestId("drawer-close").click();
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    // The research state the analyst built survives the inspection.
    await expect(page.getByTestId("chip-format")).toBeVisible();
    await expect(page.getByTestId("explorer-total")).toHaveText(filtered);
    expect(page.url()).toContain("format=VIDEO");
  });

  test("the desktop journey holds together from operation to evidence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto("/");
    await page.screenshot({ path: shot("home-1440"), fullPage: true, animations: "disabled" });
    await page.goto("/datasets");
    await page.screenshot({ path: shot("datasets-1440"), fullPage: true, animations: "disabled" });

    await page.goto(dataset);
    await gridSettled(page);
    await page.screenshot({ path: shot("dataset-1440"), fullPage: true, animations: "disabled" });
    await showExplorer(page, "ads-grid");
    await page.screenshot({ path: shot("explorer-grid-1440"), animations: "disabled" });

    await page.getByTestId("advanced-toggle").click();
    await page.getByTestId("advanced-panel").waitFor();
    await page.screenshot({ path: shot("explorer-filters-1440"), animations: "disabled" });
    await page.getByTestId("advanced-toggle").click();

    await page.getByTestId("view-table").click();
    await page.getByTestId("ads-table").waitFor();
    await mediaDecoded(page.getByTestId("row-media").first());
    await showExplorer(page, "ads-table");
    await page.screenshot({ path: shot("explorer-table-1440"), animations: "disabled" });
    await page.getByTestId("view-grid").click();
    await gridSettled(page);

    // An image ad, then a video ad: the two media presentations side by side.
    await page.goto(`${dataset}?format=IMAGE`);
    await gridSettled(page);
    await openFirstCard(page);
    await mediaDecoded(page.getByTestId("media-archived").or(page.getByTestId("media-image")).first());
    await page.screenshot({ path: shot("drawer-image-1440"), animations: "disabled" });
    await page.getByTestId("drawer-close").click();

    await page.goto(`${dataset}?format=VIDEO`);
    await gridSettled(page);
    await openFirstCard(page);
    await page.getByTestId("media-video").waitFor();
    await page.screenshot({ path: shot("drawer-video-1440"), animations: "disabled" });

    const history = page.getByTestId("observation-history");
    await history.scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="observation-row"][data-current="true"]')).toHaveCount(1);
    await page.screenshot({ path: shot("drawer-history-1440"), animations: "disabled" });

    await page.getByTestId("drawer-close").click();
    await expect(page.getByTestId("ad-drawer")).toHaveCount(0);
    await expect(page.getByTestId("chip-format")).toBeVisible();
  });

  test("the tablet width keeps the same product", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    // Pinned to a format so the capture shows the same kind of creative every
    // run; whichever ad happens to sort first is not a stable subject.
    await page.goto(`${dataset}?format=IMAGE`);
    await gridSettled(page);
    expect(await overflowsSideways(page)).toBe(false);
    await page.screenshot({ path: shot("dataset-768"), fullPage: true, animations: "disabled" });
    await showExplorer(page, "ads-grid");
    await page.screenshot({ path: shot("explorer-grid-768"), animations: "disabled" });

    await openFirstCard(page);
    const drawer = await page.getByTestId("ad-drawer").boundingBox();
    // Wider than desktop's fixed panel, still not the whole screen.
    expect(drawer!.width).toBeGreaterThan(600);
    expect(drawer!.width).toBeLessThan(768);
    await mediaDecoded(page.getByTestId("media-archived").or(page.getByTestId("media-image")).first());
    await page.screenshot({ path: shot("drawer-768"), animations: "disabled" });
  });

  /* ----------------------------------------------------- the remaining set */

  test("login and import complete the capture set", async ({ browser }) => {
    // Login is the one signed-out surface, so it needs a context of its own.
    // Explicitly empty: inside a test, browser.newContext inherits the file's
    // `use` options, so omitting this would hand the "signed out" capture a
    // signed-in session.
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 1000 },
    });
    const out = await anonymous.newPage();
    await out.goto("/login");
    await out.getByRole("button", { name: "เข้าสู่ระบบ" }).waitFor();
    await out.screenshot({ path: shot("login-1440"), animations: "disabled" });
    await out.setViewportSize({ width: 375, height: 812 });
    await out.screenshot({ path: shot("login-375"), animations: "disabled" });
    await anonymous.close();

    const context = await browser.newContext({
      storageState: join(AUTH, "admin.json"), viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    for (const [width, height, name] of [
      [1440, 1000, "import-preview-1440"], [768, 1024, "import-preview-768"], [375, 812, "import-preview-375"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/import");
      await page.getByTestId("category-select").selectOption({ label: CATEGORY });
      await page.getByTestId("file-input").setInputFiles("tests/fixtures/golden-500.json");
      await page.getByTestId("preview-button").click();
      await page.getByTestId("preview-panel").waitFor();
      await page.screenshot({ path: shot(name), fullPage: true, animations: "disabled" });
      expect(await overflowsSideways(page), `import preview overflows at ${width}px`).toBe(false);
    }
    await context.close();
  });
});
