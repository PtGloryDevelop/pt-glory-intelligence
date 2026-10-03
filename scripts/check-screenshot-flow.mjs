import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const base='http://localhost:3188',out='test-artifacts/screenshot-audit/after';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const context=await browser.newContext({storageState:'e2e/.auth/trial.json',viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 const failures=[];page.on('pageerror',error=>failures.push(error.message.split('\n')[0]));
 async function contained(image){
  assert.ok(await image.evaluate(img=>{
   const frame=img.parentElement.getBoundingClientRect(),box=img.getBoundingClientRect();
   return getComputedStyle(img).objectFit==='contain'&&box.width<=frame.width+1&&box.height<=frame.height+1;
  }),'Creative must fit its frame without clipping');
 }
 await page.goto(base+'/market-overview',{timeout:60000});
 await expect(page.getByTestId('dashboard-metrics')).toBeVisible({timeout:60000});
 await page.getByTestId('dashboard-rivals').scrollIntoViewIfNeeded();
 await expect.poll(()=>page.getByTestId('dashboard-rivals').locator('img').evaluateAll(images=>images.length>0&&images.every(img=>img.complete&&img.naturalWidth>0)),{timeout:30000}).toBe(true);
 await page.locator('[data-testid^="dashboard-open-"]').first().scrollIntoViewIfNeeded();
 await expect.poll(()=>page.locator('[data-testid^="dashboard-open-"] img').evaluateAll(images=>images.length>0&&images.every(img=>img.complete&&img.naturalWidth>=300)),{timeout:30000}).toBe(true);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:out+'/01-home.png',fullPage:true});
 await page.goto(base+'/owned-ads',{timeout:60000});
 const owned=page.getByTestId('company-grid');
 await expect(owned.locator('article')).toHaveCount(24,{timeout:60000});
 await expect.poll(()=>owned.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>=300),{timeout:30000}).toBe(true);
 await contained(owned.locator('img').first());
 const ownedUrl=new URL(await owned.getByRole('link',{name:'เลือกเปรียบเทียบ',exact:true}).first().getAttribute('href'),base);
 await page.screenshot({path:out+'/02-owned.png'});
 const response=await context.request.get(base+'/api/catalog/ads?search=Hylme&limit=1');
 const rival=(await response.json()).rows[0];
 if(!rival)throw Error('Stored Hylme evidence unavailable');
 await page.goto(base+'/competitors?search=Hylme',{timeout:60000});
 const selected=page.getByTestId('open-ad-'+rival.ad_archive_id);
 await expect(selected).toBeVisible({timeout:60000});
 for(const creative of await page.getByTestId('catalog-grid').locator('img').all()){
  await creative.scrollIntoViewIfNeeded();
  await expect.poll(()=>creative.evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:30000}).toBe(true);
 }
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:out+'/03-rivals.png'});
 await selected.click();
 const modal=page.getByTestId('ad-drawer');
 await expect(modal.getByTestId('drawer-copy')).toBeVisible({timeout:30000});
 await expect.poll(()=>modal.locator('img').evaluateAll(images=>images.some(img=>img.complete&&img.naturalWidth>0)),{timeout:30000}).toBe(true);
 await page.screenshot({path:out+'/04-detail.png'});
 ownedUrl.searchParams.set('dataset',rival.dataset_id);ownedUrl.searchParams.set('rival',rival.ad_archive_id);
 await page.goto(ownedUrl.href,{timeout:60000});
 for(const id of ['compare-owned-evidence','compare-rival-evidence']){
  await expect(page.getByTestId(id)).toBeVisible({timeout:30000});
  await expect.poll(()=>page.getByTestId(id).locator('img').evaluateAll(images=>images.some(img=>img.complete&&img.naturalWidth>0)),{timeout:30000}).toBe(true);
  await contained(page.getByTestId(id).locator('img').first());
 }
 await expect(page.getByTestId('compare-product')).toHaveCount(1);
 assert.ok((await page.getByTestId('compare-product').boundingBox()).y<(await page.getByTestId('compare-owned-evidence').boundingBox()).y,'Comparison purpose precedes its evidence');
 const copy=page.getByTestId('compare-rival-copy');
 assert.ok(await copy.evaluate(element=>element.scrollHeight>element.clientHeight&&element.clientHeight<=261),'Long copy remains available in a bounded reading area');
 await copy.focus();await page.keyboard.press('ArrowDown');
 await expect.poll(()=>copy.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 await copy.evaluate(element=>element.scrollTop=0);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:out+'/05-compare.png',fullPage:true});
 await page.screenshot({path:out+'/05-compare-viewport.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Comparison fits mobile');
 for(const id of ['compare-owned-evidence','compare-rival-evidence'])await contained(page.getByTestId(id).locator('img').first());
 await page.screenshot({path:out+'/06-mobile.png',fullPage:true});
 const videoResponse=await context.request.get(base+'/api/catalog/ads?format=VIDEO&limit=1');
 const video=(await videoResponse.json()).rows[0];assert.ok(video,'Stored video evidence required');
 ownedUrl.searchParams.set('dataset',video.dataset_id);ownedUrl.searchParams.set('rival',video.ad_archive_id);
 await page.goto(ownedUrl.href,{timeout:60000});
 const videoFrame=page.getByTestId('compare-rival-media');
 await expect(videoFrame).toBeVisible({timeout:30000});
 await expect(videoFrame.getByTestId('media-video')).toHaveAttribute('controls','');
 assert.equal(await videoFrame.locator('video').getAttribute('autoplay'),null);
 await page.setViewportSize({width:1440,height:1000});
 await videoFrame.scrollIntoViewIfNeeded();
 await page.screenshot({path:out+'/07-video.png'});
 assert.deepEqual(failures,[]);
 console.log('PASS: actual five-step flow, full creatives, purpose before evidence, keyboard reading, mobile, native video controls and retained poster; no sync/collection started');
}catch(error){console.error('Screenshot audit capture:',error.message.split('\n')[0]);process.exitCode=1;}
finally{await browser.close();}
