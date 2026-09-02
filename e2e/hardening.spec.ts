import { expect, test, type APIResponse } from "@playwright/test";
import { join } from "node:path";
import { AUTH, CATEGORY, TMP } from "./constants.ts";

/**
 * Abuse cases against the read API and the untrusted-content path.
 *
 * Everything here asserts two things at once: the right status, and that the
 * body never carries database internals back to the caller.
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const DB_LEAKS = [
  /invalid input syntax/i, /relation "/i, /pg_/i, /postgres/i, /postgresql:\/\//i,
  /supabase\.co/i, /PGRST/i, /\bstack\b/i, /at Object\./i, /column .* does not exist/i,
];

async function assertNoLeak(response: APIResponse) {
  const body = await response.text();
  for (const pattern of DB_LEAKS) {
    expect(body, `response leaked ${pattern}`).not.toMatch(pattern);
  }
  return body;
}

test.describe("read API abuse cases", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  let datasetId = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: join(AUTH, "analyst.json") });
    const page = await context.newPage();
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "small-old.json"));
    await page.getByTestId("preview-button").click();
    await expect(page.getByTestId("preview-panel")).toBeVisible();
    await page.getByTestId("dataset-name").fill("e2e-hardening");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
    datasetId = page.url().split("/").pop()!;
    await context.close();
  });

  test("a malformed id is a 400, never a database error", async ({ page }) => {
    for (const bad of ["not-a-uuid", "1", "%27%20or%201%3D1", "0".repeat(200)]) {
      const response = await page.request.get(`/api/datasets/${bad}`);
      expect(response.status(), bad).toBe(400);
      await assertNoLeak(response);
    }
  });

  test("a traversal-shaped id never reaches the route at all", async ({ page }) => {
    // These normalize away before routing, so the honest expectation is
    // "refused", not a specific status from our handler.
    for (const bad of ["../../etc/passwd", "%2e%2e%2f%2e%2e%2fetc"]) {
      const response = await page.request.get(`/api/datasets/${bad}`);
      expect([400, 404], bad).toContain(response.status());
      await assertNoLeak(response);
    }
  });

  test("a well-formed id that does not exist is a 404", async ({ page }) => {
    const response = await page.request.get(`/api/datasets/${VALID_UUID}`);
    expect(response.status()).toBe(404);
    await assertNoLeak(response);
  });

  test("page size is clamped by the server, not by the caller", async ({ page }) => {
    const cases: [string, number][] = [
      ["limit=100000", 100], ["limit=-5", 1], ["limit=abc", 30],
      ["limit=0", 1], ["limit=1e9", 100], ["", 30],
    ];
    for (const [query, expected] of cases) {
      const response = await page.request.get(`/api/datasets/${datasetId}/ads?${query}`);
      expect(response.status(), query).toBe(200);
      expect((await response.json()).limit, query).toBe(expected);
    }

    const offset = await page.request.get(`/api/datasets/${datasetId}/ads?offset=-10`);
    expect((await offset.json()).offset).toBe(0);
  });

  test("an unknown filter value is refused instead of silently ignored", async ({ page }) => {
    const response = await page.request.get(`/api/datasets/${datasetId}/ads?active=maybe`);
    expect(response.status()).toBe(400);
    await assertNoLeak(response);
  });

  test("a very long search query is answered, not crashed", async ({ page }) => {
    const response = await page.request.get(
      // Long enough to blow past MAX_SEARCH_LENGTH many times over, short
      // enough that the request line itself is still legal.
      `/api/datasets/${datasetId}/ads?search=${encodeURIComponent("ก".repeat(1000))}`,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).total).toBe(0);
  });

  test("filter values that look like SQL are matched as text", async ({ page }) => {
    const response = await page.request.get(
      `/api/datasets/${datasetId}/ads?search=${encodeURIComponent("' or 1=1 --")}`,
    );
    expect(response.status()).toBe(200);
    // If the quote had been interpolated, this would have matched everything.
    expect((await response.json()).total).toBe(0);
  });

  test("ad ids are validated before they reach the database", async ({ page }) => {
    for (const bad of ["abc", "1'or'1", "12345678901234567890123456789012345"]) {
      const response = await page.request.get(`/api/ads/${bad}`);
      expect(response.status(), bad).toBe(400);
      await assertNoLeak(response);
    }

    const badDataset = await page.request.get(`/api/ads/700000000000001?datasetId=nope`);
    expect(badDataset.status()).toBe(400);

    const missing = await page.request.get(`/api/ads/999999999999999`);
    expect(missing.status()).toBe(404);
    await assertNoLeak(missing);
  });

  test("a commit with a malformed category id is a 400, not a 500", async ({ page }) => {
    const response = await page.request.post("/api/imports/commit", {
      multipart: {
        file: { name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") },
        categoryId: "not-a-uuid",
        datasetName: "x",
      },
    });
    expect(response.status()).toBe(400);
    await assertNoLeak(response);
  });

  test("a request with no file at all is a 400", async ({ page }) => {
    const response = await page.request.post("/api/imports/preview", { multipart: {} });
    expect(response.status()).toBe(400);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every read route answers 401 before doing any work", async ({ page }) => {
    for (const path of [
      `/api/datasets/${VALID_UUID}`,
      `/api/datasets/${VALID_UUID}/ads`,
      "/api/ads/700000000000001",
    ]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(401);
      await assertNoLeak(response);
    }
  });

  test("the import routes answer 401 too", async ({ page }) => {
    const response = await page.request.post("/api/imports/preview", { multipart: {} });
    expect(response.status()).toBe(401);
  });
});

test.describe("untrusted file content", () => {
  test.use({ storageState: join(AUTH, "analyst.json") });

  test("hostile copy renders as text and hostile URLs never load", async ({ page }) => {
    await page.goto("/import");
    await page.getByTestId("category-select").selectOption({ label: CATEGORY });
    await page.getByTestId("file-input").setInputFiles(join(TMP, "xss.json"));
    await page.getByTestId("preview-button").click();
    await page.getByTestId("dataset-name").fill("e2e-xss");
    await page.getByTestId("commit-button").click();
    await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);

    await page.getByTestId("ads-table").locator("tbody tr").first().getByRole("button").click();
    await expect(page.getByTestId("ad-drawer")).toBeVisible();

    // Nothing from the file executed.
    expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned))
      .toBeUndefined();
    // ...and no injected element exists either.
    expect(await page.locator("script[data-injected], svg[onload]").count()).toBe(0);

    // The copy is visible as literal text, not swallowed by the parser.
    await expect(page.getByTestId("ad-drawer"))
      .toContainText("<img src=x onerror=");
    await expect(page.getByTestId("ad-drawer")).toContainText("javascript:window.__pwned='link'");

    // A javascript:/data: media URL is dropped, leaving the honest placeholder.
    await expect(page.getByTestId("media-placeholder")).toBeVisible();
    expect(await page.locator("img[src^='javascript:'], img[src^='data:']").count()).toBe(0);
  });
});
