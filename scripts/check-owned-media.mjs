import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const origin='http://localhost:3188';
const browser=await chromium.launch();
try{
  const context=await browser.newContext({storageState:'e2e/.auth/trial.json'});
  const page=await context.newPage();
  let library=await context.request.get(`${origin}/api/owned-ads/library`);
  if(library.status()===401){
    const credentials=JSON.parse(await readFile('e2e/.auth/trial-credentials.json','utf8'));
    await page.goto(`${origin}/login`);
    await page.locator('input[name=email]').fill(credentials.email);
    await page.locator('input[name=password]').fill(credentials.password);
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/');
    await context.storageState({path:'e2e/.auth/trial.json'});
    library=await context.request.get(`${origin}/api/owned-ads/library`);
  }
  assert.equal(library.status(),200,'Library status');
  const rows=(await library.json()).rows;
  const bad=await context.request.post(`${origin}/api/owned-ads/media`,{data:{items:[{ad_id:'../invalid',account_id:'act_1'}]}});
  assert.equal(bad.status(),400);
  const anonymous=await browser.newContext();
  assert.equal((await anonymous.request.post(`${origin}/api/owned-ads/media`,{data:{items:[]}})).status(),401);
  if(process.argv.includes('--access-only')){console.log('Media authorization and input validation passed');await browser.close();process.exit(0);}
  const response=await context.request.post(`${origin}/api/owned-ads/media`,{data:{items:rows.map(({account_id,ad_id})=>({account_id,ad_id}))},timeout:120000});
  assert.equal(response.status(),200,`Media status ${response.status()}: ${await response.text()}`);
  const result=await response.json();
  assert.ok(result.items.some(x=>x.url),'Real source must return a full image');
  const warm=await context.request.get(`${origin}/api/owned-ads/library`);
  assert.equal(warm.status(),200);
  const warmedRows=(await warm.json()).rows;
  assert.ok(result.items.filter(x=>x.url).every(item=>warmedRows.find(x=>x.account_id===item.account_id&&x.ad_id===item.ad_id)?.creative_url===item.url),'Warm library must deliver cached large URLs immediately');
  const checks=[];
  for(const item of result.items.filter(x=>x.url)){
    const original=rows.find(x=>x.account_id===item.account_id&&x.ad_id===item.ad_id);
    const sizes=await page.evaluate(async urls=>Promise.all(urls.map(url=>new Promise(resolve=>{
      if(!url)return resolve(null);
      const img=new Image();const timeout=setTimeout(()=>resolve(null),15000);
      img.onload=()=>{clearTimeout(timeout);resolve({width:img.naturalWidth,height:img.naturalHeight});};
      img.onerror=()=>{clearTimeout(timeout);resolve(null);};img.referrerPolicy='no-referrer';img.src=url;
    }))),[original.creative_url,item.url]);
    checks.push({ad:item.ad_id,thumbnail:sizes[0],full:sizes[1]});
  }
  await writeFile('test-artifacts/owned-library/media-check.json',JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks));
  assert.equal(checks.length,rows.length,'Every visible ad must resolve');
  assert.ok(checks.every(x=>x.full && x.full.width>=300),'Every visible image must load above thumbnail resolution');
  assert.ok(checks.some(x=>x.full && x.full.width>=600),'Full image must actually load at useful resolution');
  await page.setViewportSize({width:1440,height:1100});
  await page.goto(`${origin}/owned-ads`);
  await page.waitForFunction(()=>{
    const images=[...document.querySelectorAll('[data-testid="company-grid"] img')].slice(0,3);
    return images.length===3&&images.every(image=>image.naturalWidth>=300);
  },{},{timeout:120000});
  await page.screenshot({path:'test-artifacts/owned-library/high-resolution.png'});
}catch(error){console.error('Media check failed',error.message.split('\n')[0]);process.exitCode=1;}
finally{await browser.close();}
