import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin="http://localhost:3188";
const browser=await chromium.launch();
try {
  await mkdir("test-artifacts/owned-library",{recursive:true});
  const context=await browser.newContext({storageState:"e2e/.auth/trial.json",viewport:{width:1440,height:1000}});
  const get=async params=>{
    const response=await context.request.get(`${origin}/api/owned-ads/library?${new URLSearchParams(params)}`);
    assert.equal(response.status(),200,await response.text()); return response.json();
  };
  const first=await get({});
  assert.equal(first.snapshot.accounts.length,72);
  assert.ok(first.total>70000);assert.equal(first.total,first.snapshot.ad_count);
  assert.equal(first.rows.length,24);
  const second=await get({page:"1"});
  const firstIds=new Set(first.rows.map(row=>`${row.account_id}:${row.ad_id}`));
  assert.ok(second.rows.every(row=>!firstIds.has(`${row.account_id}:${row.ad_id}`)));
  const found=await get({q:first.rows[0].ad_id});
  assert.ok(found.rows.some(row=>row.ad_id===first.rows[0].ad_id));
  const filtered=await get({account:first.rows[0].account_id});
  assert.ok(filtered.total>0 && filtered.total<first.total);
  assert.ok(filtered.rows.every(row=>row.account_id===first.rows[0].account_id));
  const literal=await get({q:'unmatched",status.eq.ACTIVE'});
  assert.equal(literal.total,0,"Search punctuation must not inject a filter");
  const anonymous=await browser.newContext();
  assert.equal((await anonymous.request.get(`${origin}/api/owned-ads/library`)).status(),401);
  assert.equal((await anonymous.request.post(`${origin}/api/owned-ads/sync`)).status(),401);
  await anonymous.close();
  const page=await context.newPage();await page.goto(`${origin}/owned-ads`);
  await page.getByTestId("company-grid").locator("article").first().waitFor();
  assert.equal(await page.getByTestId("company-grid").locator("article").count(),24);
  await page.getByTestId("company-grid").getByRole("button",{name:"ดูรายละเอียด →",exact:true}).first().click();
  await page.getByTestId("company-detail").waitFor();await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("company-detail").count(),0);
  await page.getByTestId("company-next").click();
  await page.getByTestId("company-count").filter({hasText:"หน้า 2"}).waitFor();
  await page.getByTestId("company-grid").locator("article").first().waitFor();
  await page.getByTestId("company-search").fill(first.rows[0].ad_id);
  await page.getByTestId("company-grid").getByTestId(`owned-ad-${first.rows[0].ad_id}`).waitFor();
  await page.getByTestId("company-search").fill("");
  await page.getByTestId("company-grid").locator("article").nth(23).waitFor();
  if(process.argv.includes("--sync")) {
    await page.getByTestId("company-sync").click();
    // Double submission joins the running worker, rather than creating a race.
    const duplicate=await context.request.post(`${origin}/api/owned-ads/sync`);
    assert.equal(duplicate.status(),202);
    let last;let checkedWhileRunning=false;
    for(let attempt=0;attempt<90;attempt++) {
      await page.waitForTimeout(5000);last=await get({progress:"1"});
      if(last.progress?.status==="running" && !checkedWhileRunning){
        const usable=await get({});assert.equal(usable.snapshot.id,first.snapshot.id);
        assert.equal(usable.rows.length,24);
        assert.equal(await page.getByTestId("company-grid").locator("article").count(),24);
        checkedWhileRunning=true;
      }
      if(last.progress?.status==="failed")throw new Error(last.progress.error);
      if(last.progress?.id!==first.snapshot.id && last.progress?.status==="completed"){last=await get({});break;}
    }
    assert.notEqual(last.snapshot.id,first.snapshot.id,"Website-triggered refresh must complete");
    assert.equal(last.snapshot.accounts.length,72);
    assert.equal(last.total,last.snapshot.ad_count);
    assert.ok(last.total>70000);
    assert.equal(new Set(last.rows.map(row=>`${row.account_id}:${row.ad_id}`)).size,last.rows.length);
    await writeFile("test-artifacts/owned-library/repeat-sync.json",JSON.stringify({before:first.snapshot.id,after:last.snapshot.id,beforeAds:first.total,afterAds:last.total,accounts:last.snapshot.accounts.length},null,2));
  }
  await page.screenshot({path:"test-artifacts/owned-library/desktop.png",fullPage:false});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:"test-artifacts/owned-library/mobile.png",fullPage:false});
  await writeFile("test-artifacts/owned-library/check.json",JSON.stringify({ads:first.total,accounts:first.snapshot.accounts.length,pagination:true,search:true,accountFilter:true,unauthorizedRefused:true,desktop:true,mobile:true},null,2));
  console.log("Complete library: API counts, paging, search, account filter, auth, details and mobile passed");
}catch(error){
  // Playwright request errors include auth cookies in their call log.
  console.error("Owned library check failed",error.message.split("\n")[0]);process.exitCode=1;
}finally{await browser.close();}
