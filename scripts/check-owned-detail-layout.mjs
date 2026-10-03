import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

// Existing owned ad only: no collection, sync, source writes or signed URL logs.
const origin=process.env.LIBRARY_CHECK_URL??'http://localhost:3188';
const browser=await chromium.launch();
let page,stage='authentication';
try{
 const context=await browser.newContext({storageState:'e2e/.auth/trial.json',viewport:{width:1280,height:720}});
 page=await context.newPage();
 await page.goto(origin+'/?q=UP%20VDO%2075',{waitUntil:'domcontentloaded'});
 if(new URL(page.url()).pathname==='/login'){
  const credentials=JSON.parse(await readFile('e2e/.auth/trial-credentials.json','utf8'));
  await page.locator('input[name=email]').fill(credentials.email);await page.locator('input[name=password]').fill(credentials.password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(origin+'/**');
  await page.goto(origin+'/?q=UP%20VDO%2075');
 }
 await expect(page.getByTestId('performance-kpis')).toBeVisible({timeout:60000});
 await context.storageState({path:'e2e/.auth/trial.json'});
 const opener=page.getByRole('button',{name:/^ดูวิดีโอ UP VDO 75$/}).first();
 await expect(opener).toBeVisible({timeout:60000});await opener.click();
 const dialog=page.getByTestId('company-detail');
 await expect(dialog.getByTestId('owned-video-preview')).toBeVisible({timeout:60000});
 await expect(page.frameLocator('[data-testid=owned-video-preview]').locator('video').first()).toBeVisible({timeout:60000});
 await mkdir('test-artifacts/owned-detail-layout',{recursive:true});
 const results=[];
 for(const size of [{width:1280,height:720},{width:1152,height:864},{width:1440,height:1000},{width:390,height:844},{width:844,height:390}]){
  stage=`layout ${size.width}x${size.height}`;await page.setViewportSize(size);
  const compare=dialog.getByRole('link',{name:'เทียบแอดนี้กับคู่แข่ง →',exact:true});
  const boxes=await dialog.evaluate(element=>{
   const layout=element.querySelector('[class*="detailLayout"]');
   const info=element.querySelector('[class*="detailInfo"]');
   const media=element.querySelector('[class*="detailMedia"]');
   const button=element.querySelector('a[href^="/compare/ads"]');
   const box=node=>{const rect=node.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,height:rect.height};};
   return {dialog:box(element),layout:box(layout),info:box(info),media:box(media),preview:box(media.querySelector('iframe')),button:box(button),dialogScroll:{width:element.scrollWidth,clientWidth:element.clientWidth,height:element.scrollHeight,clientHeight:element.clientHeight}};
  });
  console.log(JSON.stringify({size,...boxes}));
  await dialog.screenshot({path:`test-artifacts/owned-detail-layout/${size.width}x${size.height}.png`});
  assert.ok(boxes.button.bottom<=boxes.dialog.bottom-1&&boxes.button.top>=boxes.dialog.top,'Comparison action must be entirely inside the dialog without scrolling');
  assert.ok(boxes.dialogScroll.width<=boxes.dialogScroll.clientWidth+1,'No horizontal dialog overflow');
  assert.ok(boxes.dialogScroll.height<=boxes.dialogScroll.clientHeight+1,'Dialog must not add an outer scrollbar');
  if(size.width>800){
   assert.ok(boxes.info.bottom<=boxes.layout.bottom+1,'Info scroll viewport must not extend below its layout');
   assert.ok(boxes.media.bottom<=boxes.layout.bottom+1,'Media must fit its available row');
  }
  assert.ok(boxes.preview.top>=boxes.media.top-1&&boxes.preview.bottom<=boxes.media.bottom+1,'Video preview must fit its pane without overlapping information');
  await expect(compare).toBeVisible();
  assert.ok(await compare.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));}),'Comparison action must be reachable');
  await dialog.locator('[class*="detailInfo"]').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await expect(compare).toBeVisible();
 }
 await dialog.getByRole('button',{name:'ปิดรายละเอียด',exact:true}).click();
 await expect(opener).toBeFocused();
 await opener.click();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await opener.click();
 const compare=dialog.getByRole('link',{name:'เทียบแอดนี้กับคู่แข่ง →',exact:true});
 const target=new URL(await compare.getAttribute('href'),origin);
 await compare.click();await page.waitForURL(url=>url.pathname==='/compare/ads');
 assert.equal(new URL(page.url()).searchParams.get('owned'),target.searchParams.get('owned'));
 assert.equal(new URL(page.url()).searchParams.get('returnTo'),target.searchParams.get('returnTo'));
 results.push('footer visible at all five sizes','no outer/horizontal overflow','bounded non-overlapping panes','focus return and Escape','comparison link keeps selected ad and return filters');
 console.log(JSON.stringify({result:'PASS',checks:results}));
}catch(error){
 if(page)await page.screenshot({path:'test-artifacts/owned-detail-layout/failure.png'}).catch(()=>{});
 console.error('Owned detail layout failed at '+stage+': '+error.message.split('\n')[0]);process.exitCode=1;
}finally{await browser.close();}
