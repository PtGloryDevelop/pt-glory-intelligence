import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * Layout invariants that a screenshot shows but no functional test would catch.
 *
 * The case that motivated this: PageHeader's `.text` used `flex: 1 1 320px` as a
 * minimum column width. That is only meaningful while the header is a row — the
 * mobile rule flips it to a column, where flex-basis applies to the block axis,
 * so 320px became reserved HEIGHT and the title block rendered four times taller
 * than its content on a phone.
 */

const WIDTHS = [375, 768, 1280, 1440];

test.describe("page header geometry", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  test.beforeAll(async ({ browser }) => {
    // Admin: the import step, not the layout, is what needs the role.
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible();
    await page.getByTestId("dataset-name").fill("e2e-layout");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    datasetUrl = page.url();
    await context.close();
  });

  for (const width of WIDTHS) {
    test(`the header reserves no empty height at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(datasetUrl);

      const box = await page.evaluate(() => {
        const header = document.querySelector("header");
        const text = header!.firstElementChild!;
        const rule = text.querySelector("span[aria-hidden]")!;
        return {
          text: text.getBoundingClientRect().height,
          // Distance from the accent rule — the last thing in the block on this
          // page — to the bottom of the block. Anything large is dead space.
          slack: text.getBoundingClientRect().bottom - rule.getBoundingClientRect().bottom,
        };
      });

      expect(box.slack, "empty reserved space below the header content").toBeLessThan(24);
      expect(box.text, "header text block should be content-sized").toBeLessThan(200);
    });
  }

  test("the header and the context bar stay in document order on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(datasetUrl);
    const header = await page.locator("header").boundingBox();
    const context = await page.getByTestId("context-bar").boundingBox();
    expect(context!.y).toBeGreaterThan(header!.y + header!.height - 1);
    // The gap between them is the declared section margin, not a surprise.
    expect(context!.y - (header!.y + header!.height)).toBeLessThan(48);
  });
});

/**
 * The shell's topbar appears below 900px as a sticky layer at top:0 with
 * z-index 30. Any second sticky layer at the same offset slides underneath it.
 */
test.describe("sticky layers never overlap", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetUrl = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.goto("/datasets");
    const href = await page.locator('[data-testid="dataset-list"] tbody a').first().getAttribute("href");
    datasetUrl = href!;
    await context.close();
  });

  for (const width of [640, 641, 768, 899, 900, 901, 1280, 1440]) {
    test(`explorer toolbar does not hide under the shell topbar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(datasetUrl);
      await page.getByTestId("filter-toolbar").waitFor();

      const state = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-testid="filter-toolbar"]')!;
        const topbar = [...document.querySelectorAll("div")].find(
          (el) => getComputedStyle(el).position === "sticky"
            && el.querySelector('button[aria-label="เปิดเมนู"]'),
        );
        return {
          toolbarSticky: getComputedStyle(toolbar).position === "sticky",
          topbarVisible: Boolean(topbar) && getComputedStyle(topbar!).display !== "none",
        };
      });

      // Exactly one sticky layer may claim top: 0. Where the shell topbar is
      // present the toolbar returns to normal flow; where it is absent the
      // toolbar keeps its sticky behaviour.
      expect(
        state.toolbarSticky && state.topbarVisible,
        "two sticky layers are competing for the same offset",
      ).toBe(false);
      if (!state.topbarVisible) {
        expect(state.toolbarSticky, "the toolbar should stay sticky on desktop").toBe(true);
      }
    });
  }
});

/**
 * C14 — the menu one role receives, read off the server-rendered HTML.
 *
 * Not "is it visible": whether the label is in the document at all. Filtering in
 * the browser would ship every admin entry to every person and call CSS a
 * permission, so the proof has to be about what the server sent.
 */
test.describe("role-aware navigation", () => {
  const ADMIN_ONLY = ["ค่าเก็บข้อมูล", "นำเข้าไฟล์ (กู้คืนระบบ)"];

  /**
   * The sidebar's own markup, out of the server's response.
   *
   * Scoped deliberately: the document also carries the copy of every rendered
   * boundary, and one of those tells a refused person which menu to use. What
   * this is about is the menu itself — what the server put in the sidebar for
   * this role.
   */
  const sidebarHtml = async (page: import("@playwright/test").Page, url: string) => {
    const html = await (await page.goto(url))!.text();
    const start = html.indexOf('data-testid="app-sidebar"');
    expect(start, "the sidebar must be server-rendered").toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</aside>", start));
  };

  test("a viewer receives none of the collection entries", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "viewer.json") });
    const page = await context.newPage();
    const sidebar = await sidebarHtml(page, "/datasets");

    for (const label of [...ADMIN_ONLY, "เก็บข้อมูลใหม่"]) {
      expect(sidebar, `a viewer's menu must not contain ${label}`).not.toContain(label);
    }
    expect(sidebar).toContain("Dataset");
    await context.close();
  });

  test("an analyst receives the collection entry and nothing admin", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    const sidebar = await sidebarHtml(page, "/datasets");

    expect(sidebar).toContain("เก็บข้อมูลใหม่");
    for (const label of ADMIN_ONLY) {
      expect(sidebar, `an analyst's menu must not contain ${label}`).not.toContain(label);
    }
    // The entry exists but leads nowhere until C15 builds the page.
    await expect(page.locator('[aria-disabled="true"]', { hasText: "เก็บข้อมูลใหม่" })).toHaveCount(1);
    await expect(page.locator('a[href="/collect"]')).toHaveCount(0);
    await context.close();
  });

  test("an admin receives all three, and only the import one is a link", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();
    await page.goto("/datasets");

    for (const label of ["เก็บข้อมูลใหม่", ...ADMIN_ONLY]) {
      await expect(page.getByText(label)).toHaveCount(1);
    }
    // The recovery import works; the two C15 entries are disabled placeholders.
    await expect(page.getByTestId("nav-/import")).toHaveAttribute("href", "/import");
    for (const label of ["เก็บข้อมูลใหม่", "ค่าเก็บข้อมูล"]) {
      await expect(page.locator('[aria-disabled="true"]', { hasText: label })).toHaveCount(1);
    }
    // Neither has a destination yet, so neither can 404.
    await expect(page.locator('a[href="/collect"], a[href="/collector"]')).toHaveCount(0);
    await context.close();
  });
});

/**
 * C14 — /import answers with a status, not only with a screen.
 *
 * A refusal rendered inside a 200 tells a script, a crawler and a client library
 * that the request succeeded. The ticket asks for 403, so that is what is
 * asserted here: the status on the wire, for each role.
 */
test.describe("the import page answers each role with a real status", () => {
  const statusFor = async (browser: import("@playwright/test").Browser, role: string) => {
    const context = await browser.newContext({ storageState: join(AUTH, `${role}.json`) });
    const page = await context.newPage();
    const response = await page.goto("/import");
    const status = response!.status();
    const body = await page.content();
    await context.close();
    return { status, body };
  };

  test("a viewer is refused with 403", async ({ browser }) => {
    const { status, body } = await statusFor(browser, "viewer");
    expect(status).toBe(403);
    expect(body).toContain("หน้านี้สำหรับผู้ดูแลระบบ");
  });

  test("an analyst is refused with 403", async ({ browser }) => {
    const { status, body } = await statusFor(browser, "analyst");
    expect(status).toBe(403);
    // And told where their own collection path is, without naming a collector.
    expect(body).toContain("เก็บข้อมูลใหม่");
    expect(body).not.toMatch(/apify|extension/i);
  });

  test("an admin gets the page, and the form on it", async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "admin.json") });
    const page = await context.newPage();
    const response = await page.goto("/import");
    expect(response!.status()).toBe(200);
    await expect(page.getByTestId("file-input")).toBeVisible();
    await expect(page.getByTestId("category-select")).toBeVisible();
    await context.close();
  });
});
