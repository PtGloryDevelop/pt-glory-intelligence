import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.LIBRARY_CHECK_URL??'http://localhost:3188';
const browser=await chromium.launch();let stage='authentication';
try{
 const context=await browser.newContext({storageState:'e2e/.auth/trial.json',viewport:{width:1280,height:900}});
 // Name/filter checks do not need any Graph creative or image reads.
 await context.route('**/api/owned-ads/media',route=>route.fulfill({json:{items:[]}}));
 const page=await context.newPage();await page.goto(origin,{waitUntil:'domcontentloaded'});
 if(new URL(page.url()).pathname==='/login'){
  const login=JSON.parse(await readFile('e2e/.auth/trial-credentials.json','utf8'));
  await page.locator('input[name=email]').fill(login.email);await page.locator('input[name=password]').fill(login.password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(origin+'/**');await page.goto(origin);
 }
 await expect(page.getByTestId('performance-kpis')).toBeVisible({timeout:60000});await context.storageState({path:'e2e/.auth/trial.json'});
 stage='real Page choices';const picker=page.getByTestId('performance-page');
 const options=await picker.locator('option').evaluateAll(nodes=>nodes.slice(1).map(n=>({id:n.value,label:n.textContent})));
 assert.ok(options.length>0);assert.ok(options.every(p=>/^\d+$/.test(p.id)&&p.label!==p.id));
 const named=options.filter(p=>!p.label.startsWith('ยังไม่มีชื่อเพจ'));const unknown=options.filter(p=>p.label.startsWith('ยังไม่มีชื่อเพจ'));
 assert.ok(named.length>0&&unknown.length>0);assert.equal(options[0].id,named[0].id);
 stage='filter identity';const responsePromise=page.waitForResponse(r=>r.url().includes('/api/owned-ads/performance?')&&new URL(r.url()).searchParams.get('pageId')===named[0].id);
 await picker.selectOption(named[0].id);const response=await responsePromise;assert.equal(response.status(),200);
 const data=await response.json();assert.ok(data.rows.every(r=>r.page_id===named[0].id),'Every delivered ad must match the selected Page ID');
 if(!data.rows.length)await expect(page.getByText('ยังไม่มีแอดพร้อมผลลัพธ์ในช่วงนี้',{exact:true})).toBeVisible();
 assert.equal(new URL(page.url()).searchParams.get('pageId'),named[0].id);
 stage='refresh feedback fixture';
 // Exercise the denied/partial outcome without making another set of Meta reads.
 await page.route('**/api/owned-ads/page-names',route=>route.fulfill({json:{pages:142,named:3,unresolved:139}}));
 const urlBefore=page.url();await page.getByTestId('performance-refresh-names').click();
 await expect(page.getByRole('status')).toContainText('อีก 139 เพจยังอ่านชื่อไม่ได้');assert.equal(page.url(),urlBefore);
 stage='mobile';await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('performance-refresh-names')).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await mkdir('test-artifacts/page-names',{recursive:true});await page.getByTestId('performance-filters').screenshot({path:'test-artifacts/page-names/mobile.png'});
 const guest=await browser.newContext();const denied=await guest.request.post(origin+'/api/owned-ads/page-names');assert.equal(denied.status(),401);await guest.close();
 console.log(JSON.stringify({result:'PASS',pages:options.length,named:named.length,unresolved:unknown.length,checks:['real names first','explicit missing names','unchanged numeric filter identity','filtered ads match Page','partial refresh feedback fixture','mobile width','guest POST denied']}));
}catch(error){console.error('Owned Page-name check failed at '+stage+': '+error.message.split('\n')[0]);process.exitCode=1}finally{await browser.close()}
