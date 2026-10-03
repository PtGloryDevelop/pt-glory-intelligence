import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';

// Read-only: use one stored observation; stub browser listing pages for repeatable navigation.
const origin=process.env.LIBRARY_CHECK_URL??'http://localhost:3188';
const browser=await chromium.launch();
let stage='stored rival seed';
try{
 const context=await browser.newContext({storageState:process.env.LIBRARY_CHECK_AUTH??'e2e/.auth/trial.json'});
 const page=await context.newPage();
 await page.goto(origin+'/competitors',{waitUntil:'domcontentloaded'});
 const seedResponse=await context.request.get(origin+'/api/catalog/ads?limit=1');
 assert.equal(seedResponse.status(),200,'An authenticated stored rival is required');
 const seed=(await seedResponse.json()).rows[0];
 assert.ok(seed?.dataset_id&&seed?.ad_archive_id,'The catalog needs one real observation');
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message.split('\n')[0]));
 await page.route('**/api/catalog/ads?*',route=>{
  const params=new URL(route.request().url()).searchParams;
  requests.push(params);
  const offset=Number(params.get('offset')??0);
  return route.fulfill({json:{rows:offset<72?[seed]:[],total:72,limit:24,offset,lastCollectedAt:seed.collected_at}});
 });
 const saved=new URL('/competitors',origin);
 saved.search=new URLSearchParams({search:'catalog-return-fixture',period:'week',active:'inactive',offset:'24'}).toString();
 async function restored(offset){
  await expect(page.getByTestId('catalog-search')).toHaveValue('catalog-return-fixture');
  await expect(page.getByRole('combobox',{name:'ช่วงที่พบ'})).toHaveValue('week');
  await expect(page.getByRole('combobox',{name:'สถานะแอดคู่แข่ง'})).toHaveValue('inactive');
  await expect(page.getByTestId('catalog-count')).toContainText(`หน้า ${Math.floor(offset/24)+1}`);
  assert.equal(requests.at(-1).get('offset'),String(offset));
  assert.equal(requests.at(-1).get('search'),'catalog-return-fixture');
  assert.equal(requests.at(-1).get('period'),'week');
  assert.equal(requests.at(-1).get('active'),'inactive');
 }
 stage='saved status and second page';
 await page.goto(saved.href,{waitUntil:'domcontentloaded'});
 await restored(24);
 stage='next page and reload';
 await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
 await restored(48);
 await page.reload({waitUntil:'domcontentloaded'});
 await restored(48);
 const returnUrl=new URL(page.url());
 async function openComparison(){
  await page.getByTestId('catalog-grid').locator('button[data-testid^="open-ad-"]').first().click();
  const compare=page.getByTestId('ad-drawer').getByRole('link',{name:'เทียบกับแอดของเรา →',exact:true});
  await compare.waitFor();
  const href=new URL(await compare.getAttribute('href'),origin);
  assert.equal(href.searchParams.get('dataset'),seed.dataset_id);
  assert.equal(href.searchParams.get('rival'),seed.ad_archive_id);
  const back=new URL(href.searchParams.get('returnTo'),origin);
  assert.equal(back.pathname,'/competitors');
  assert.deepEqual([...back.searchParams].sort(),[...returnUrl.searchParams].sort());
  await compare.click();
  await page.waitForURL(url=>url.pathname==='/compare/ads');
 }
 stage='comparison pin and cached browser return';
 await openComparison();
 await page.goBack({waitUntil:'domcontentloaded'});
 await restored(48);
 if(await page.getByTestId('ad-drawer').count())await page.keyboard.press('Escape');
 stage='explicit comparison return';
 await openComparison();
 const back=page.getByTestId('comparison-return');
 await expect(back).toBeVisible();
 assert.deepEqual([...new URL(await back.getAttribute('href'),origin).searchParams].sort(),[...returnUrl.searchParams].sort());
 await back.click();
 await page.waitForURL(url=>url.pathname==='/competitors');
 await restored(48);
 stage='filter reset preserves the other filters';
 await page.getByRole('combobox',{name:'สถานะแอดคู่แข่ง'}).selectOption('unknown');
 await expect(page.getByTestId('catalog-count')).toContainText('หน้า 1');
 assert.equal(requests.at(-1).get('active'),'unknown');
 assert.equal(requests.at(-1).get('period'),'week');
 assert.equal(requests.at(-1).get('search'),'catalog-return-fixture');
 await page.getByTestId('catalog-search').fill('updated query');
 await page.getByRole('button',{name:'ค้นหาแอด',exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('search')==='updated query');
 await expect(page.getByTestId('catalog-count')).toContainText('หน้า 1');
 assert.equal(requests.at(-1).get('active'),'unknown');
 assert.equal(requests.at(-1).get('period'),'week');
 stage='invalid filters and empty saved page';
 await page.goto(origin+'/competitors?active=invalid&period=invalid&offset=Infinity',{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('catalog-count')).toContainText('หน้า 1');
 assert.equal(requests.at(-1).get('active'),null);
 assert.equal(requests.at(-1).get('period'),null);
 await page.goto(origin+'/competitors?active=inactive&offset=999999999',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('button',{name:'กลับหน้าแรก',exact:true})).toBeVisible();
 assert.equal(requests.at(-1).get('offset'),'100000');
 await page.getByRole('button',{name:'กลับหน้าแรก',exact:true}).click();
 await expect(page.getByTestId('catalog-count')).toContainText('หน้า 1');
 assert.equal(requests.at(-1).get('active'),'inactive');
 assert.equal(requests.at(-1).get('offset'),'0');
 assert.deepEqual(errors,[]);
 console.log('PASS: saved catalog filters, pagination, reload, cached Back, exact comparison pin, explicit return, invalid URL normalization and empty-page recovery. Listing responses are local browser fixtures; stored data is read only.');
 await context.close();
}catch(error){
 console.error(`Catalog return failed (${stage}):`,error.message.split('\n')[0]);
 process.exitCode=1;
}finally{
 await browser.close();
}
