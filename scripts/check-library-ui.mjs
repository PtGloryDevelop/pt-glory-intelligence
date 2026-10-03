import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Read-only check: browsing and comparison links, no sync or paid collection.
const origin = process.env.LIBRARY_CHECK_URL ?? "http://localhost:3188";
await mkdir("test-artifacts/library-redesign", { recursive: true });
const browser = await chromium.launch();
let stage="open company library";
let page;
try {
  const context = await browser.newContext({ storageState: process.env.LIBRARY_CHECK_AUTH ?? "e2e/.auth/trial.json", viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on("pageerror",error=>console.error("Client exception:",error.message.split("\n")[0]));
  page.on("response",response=>{if(response.url().startsWith(origin)&&response.status()>=400)console.error("Local response:",new URL(response.url()).pathname,response.status());});
  await page.goto(`${origin}/owned-ads`, { waitUntil: "domcontentloaded", timeout:60000 });
  if(page.url().includes("/login")) {
    stage="trial login";
    const credentials=JSON.parse(await readFile("e2e/.auth/trial-credentials.json","utf8"));
    await page.getByLabel("อีเมล",{exact:true}).fill(credentials.email);
    await page.getByLabel("รหัสผ่าน",{exact:true}).fill(credentials.password);
    await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();
    await page.waitForURL(`${origin}/`,{timeout:60000});
    await page.goto(`${origin}/owned-ads`,{waitUntil:"domcontentloaded",timeout:60000});
  }
  const company=page.getByTestId("company-grid");
  stage="company cards";
  await company.locator("article").first().waitFor({timeout:process.argv.includes("--probe")?10000:60000});
  assert.equal(await company.locator("article").count(),24);
  const spendPage=await (await context.request.get(origin+'/api/owned-ads/library?spend=reported')).json();
  const allPage=await (await context.request.get(origin+'/api/owned-ads/library?spend=all')).json();
  assert.ok(spendPage.rows.every(row=>row.spend>0));
  assert.ok(spendPage.total<allPage.total&&allPage.total===allPage.snapshot.ad_count);
  const spendToggle=page.getByRole('checkbox',{name:'มีค่าแอดในช่วงผลลัพธ์ · ปิดเพื่อดูแอดทั้งคลัง'});
  assert.equal(await spendToggle.isChecked(),true);
  await spendToggle.uncheck();
  await page.getByTestId('company-count').filter({hasText:allPage.total.toLocaleString('th-TH')}).waitFor();
  await spendToggle.check();
  await page.getByTestId('company-count').filter({hasText:spendPage.total.toLocaleString('th-TH')}).waitFor();
  console.log('Owned scope: '+spendPage.total+' with spend; '+allPage.total+' retained in full inventory');
  assert.equal(await company.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(" ").length),3,"The 1440px gallery must show three large creative cards");
  assert.ok((await company.locator("article").first().boundingBox()).width>=320,"Ad cards must keep imagery and metrics readable");
  assert.equal(await company.locator("article").first().getByText("ค่า / บทสนทนา",{exact:true}).isVisible(),true);
  assert.equal(await page.getByTestId("company-advanced").getAttribute("open"),null);
  assert.equal(await page.getByTestId("company-account").isVisible(),false);
  assert.equal(await page.getByTestId("owned-dashboard").count(),0,"Hidden CSV reports should not load in the main flow");
  const ownedHref=await company.getByRole("link",{name:"เลือกเปรียบเทียบ",exact:true}).first().getAttribute("href");
  const ownedParams=new URL(ownedHref,origin).searchParams;
  assert.ok(ownedParams.get("account")&&ownedParams.get("owned"));
  await company.getByRole("button",{name:"ดูรายละเอียด →",exact:true}).first().click();
  stage="company detail";
  await page.getByTestId("company-detail").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("company-detail").count(),0);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"test-artifacts/library-redesign/owned-desktop.png",fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Company library must fit mobile");
  await page.screenshot({path:"test-artifacts/library-redesign/owned-mobile.png",fullPage:false});

  await page.setViewportSize({width:1440,height:1000});
  stage="open competitor library";
  await page.goto(`${origin}/competitors`,{waitUntil:"domcontentloaded",timeout:60000});
  await page.getByRole("heading",{name:"ส่องคู่แข่ง",exact:true}).waitFor();
  assert.equal(await page.getByTestId("competitor-all-pages").getAttribute("href"),"/pages?scope=all");
  const rivals=page.getByTestId("catalog-grid");
  stage="competitor cards";
  await rivals.locator("article").first().waitFor({timeout:60000});
  assert.equal(await rivals.locator("article").count(),24);
  assert.equal(await rivals.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(" ").length),3);
  assert.ok((await rivals.locator("article").first().boundingBox()).width>=320);
  assert.equal(await page.getByTestId("competitor-source-options").getAttribute("open"),null);
  await page.getByTestId("catalog-search").fill("Scotch");
  await page.getByRole("button",{name:"ค้นหาแอด",exact:true}).click();
  await page.getByTestId("catalog-count").filter({hasText:"2 แอด"}).waitFor();
  assert.equal(await rivals.locator("article").count(),2);
  await rivals.locator('button[data-testid^="open-ad-"]').first().click();
  stage="competitor detail";
  await page.getByTestId("ad-drawer").waitFor();
  const rivalHref=await page.getByTestId("ad-drawer").getByRole("link",{name:"เทียบกับแอดของเรา →",exact:true}).getAttribute("href");
  const rivalParams=new URL(rivalHref,origin).searchParams;
  assert.ok(rivalParams.get("dataset")&&rivalParams.get("rival"));
  await page.screenshot({path:"test-artifacts/library-redesign/rival-drawer.png"});
  await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("ad-drawer").count(),0);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"test-artifacts/library-redesign/rivals-desktop.png",fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Competitor library must fit mobile");
  await page.screenshot({path:"test-artifacts/library-redesign/rivals-mobile.png",fullPage:false});
  // Hold one image lookup to check the factual difference between queued and unavailable.
  stage="queued image state";
  let releaseMedia;
  const mediaGate=new Promise(resolve=>{releaseMedia=resolve;});
  await page.route("**/api/owned-ads/library?*",async route=>{
    const response=await route.fetch();const body=await response.json();
    if(body.rows)body.rows=body.rows.map(row=>({...row,creative_url:null}));
    await route.fulfill({response,json:body});
  });
  await page.route("**/api/owned-ads/media",async route=>{
    await mediaGate;
    const {items}=route.request().postDataJSON();
    await route.fulfill({json:{items:items.map(item=>({...item,url:null}))}});
  });
  await page.goto(`${origin}/owned-ads`,{waitUntil:"domcontentloaded",timeout:60000});
  await page.getByText("กำลังโหลดภาพชัด…",{exact:true}).first().waitFor();
  releaseMedia();
  await page.getByText("กำลังโหลดภาพชัด…",{exact:true}).first().waitFor({state:"hidden"});
  assert.ok(await page.getByText("ไม่มีไฟล์ครีเอทีฟในรายงาน",{exact:true}).count()>0);
  console.log("Library flow: automatic data, concise filters, both comparison links, drawers and mobile passed");
  await context.close();
} catch(error) {
  // Playwright call logs can include session cookies: print the short reason only.
  console.error(`Library flow failed (${stage}):`,error.message.split("\n")[0]);process.exitCode=1;
  if(page){await page.screenshot({path:"test-artifacts/library-redesign/failure.png"}).catch(()=>{});console.error("Page alerts:",(await page.getByRole("alert").allTextContents()).join(" ").slice(0,200));}
} finally {
  await browser.close();
}
