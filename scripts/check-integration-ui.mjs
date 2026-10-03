import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const management = JSON.parse(await readFile("test-artifacts/integration/management-result.json", "utf8"));
const collection = JSON.parse(await readFile("test-artifacts/integration/apify-result.json", "utf8"));
assert.equal(collection.status, "succeeded");
assert.equal(collection.result.ads, 10);
assert.equal(collection.cost_status, "final");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ storageState: "e2e/.auth/trial.json", viewport: { width: 1440, height: 1000 } });
  const report = await context.request.get(`http://localhost:3188/api/owned-ads/reports/${management.reportId}`);
  assert.equal(report.status(), 200);
  assert.equal((await report.json()).report.rows.length, 30);
  const ads = await context.request.get(`http://localhost:3188/api/datasets/${collection.dataset_id}/ads?limit=50`);
  assert.equal(ads.status(), 200);
  const data = await ads.json();
  assert.equal(data.rows.length, 10);
  const page = await context.newPage();
  await page.goto("http://localhost:3188/owned-ads");
  await page.getByText('รายงาน CSV และข้อมูลทดสอบเดิม', {exact:true}).click();
  await page.getByTestId("owned-report-select").selectOption(management.reportId);
  await page.getByTestId("owned-grid").waitFor();
  assert.equal(await page.getByTestId("owned-grid").locator("article").count(), 24);
  await page.screenshot({ path: "test-artifacts/integration/company-ads.png", fullPage: false });
  await page.goto(`http://localhost:3188/competitors?dataset=${collection.dataset_id}`);
  await page.getByTestId("ads-grid").waitFor();
  assert.equal(await page.getByTestId("ads-grid").locator("article").count(), 10);
  await page.screenshot({ path: "test-artifacts/integration/apify-ads.png", fullPage: false });
  await writeFile("test-artifacts/integration/browser-result.json", JSON.stringify({ companyApi: 200, companyRows: 30, apifyApi: 200, apifyRows: 10, companyScreen: true, competitorScreen: true },null,2));
  console.log("Real company report and real Apify dataset: API counts and browser cards passed");
} finally { await browser.close(); }
