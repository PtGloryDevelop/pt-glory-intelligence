import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServerClient} from '@supabase/ssr';

// Browser fixtures intercept all collection/category writes: this proof buys no provider runs.
const origin=process.env.QUEUE_CHECK_URL??'http://localhost:3188';
let jar=JSON.parse(fs.readFileSync(process.env.QUEUE_CHECK_AUTH??'e2e/.auth/me.json','utf8')).cookies;
const db=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>jar,setAll:items=>{for(const item of items){jar=jar.filter(c=>c.name!==item.name);jar.push(item);}}}});
const user=(await db.auth.getUser()).data.user;
assert.ok(user,'An existing authorized session is required');
const storedRead=await db.from('collection_request_status').select('id').eq('status','succeeded').order('created_at',{ascending:false}).limit(1).maybeSingle();
assert.ok(storedRead.data?.id,'A real completed own collection is required for the cached standalone navigation proof');
const storedId=storedRead.data.id;
const browser=await chromium.launch({channel:process.env.QUEUE_CHECK_BROWSER_CHANNEL??'chrome'});
const submissions=[];
const fixtures=new Map();
try{
  const bypass=[];
  if(process.env.QUEUE_CHECK_DEPLOYMENT==='1'){
    assert.ok(process.env.QUEUE_CHECK_VERCEL_CLI,'Set QUEUE_CHECK_VERCEL_CLI to the installed Vercel CLI vc.js path');
    const project=JSON.parse(fs.readFileSync(join('.vercel','project.json'),'utf8'));
    const headers=execFileSync(process.execPath,[process.env.QUEUE_CHECK_VERCEL_CLI,'curl','/api/version','--deployment',origin,'--scope',project.orgId,'--','--header','x-vercel-set-bypass-cookie: true','--dump-header','-','--output',process.platform==='win32'?'NUL':'/dev/null','--silent','--max-time','30'],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});
    const match=headers.match(/^set-cookie:\s*(_vercel_jwt)=([^;\r\n]+)/im);
    assert.ok(match);bypass.push({name:match[1],value:match[2],domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([...bypass,...jar.map(({name,value})=>({name,value,domain:new URL(origin).hostname,path:'/',httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax'}))]);
  await context.route('**/api/categories',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    return route.fulfill({status:201,json:{id:'11111111-1111-4111-8111-111111111111'}});
  });
  await context.route('**/api/collections**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='POST'&&url.pathname==='/api/collections'){
      const input=request.postDataJSON(),id=randomUUID(),now=new Date().toISOString();
      submissions.push(input);
      const dto={id,requestedBy:user.id,status:'queued',statusLabel:'รอคิวเก็บข้อมูล',requiresAdmin:false,
        keyword:input.keyword,country:input.country,activeStatus:input.activeStatus,maxRecords:input.maxRecords,
        pageId:input.pageId??null,unitId:input.unitId??null,unitName:input.unitName??null,categoryId:input.categoryId,
        datasetName:input.datasetName,sourceUrl:null,itemCount:null,result:null,stopReason:null,datasetId:null,collectionRunId:null,
        createdAt:now,startedAt:null,finishedAt:null,updatedAt:now};
      fixtures.set(id,dto);return route.fulfill({status:201,json:dto});
    }
    if(request.method()==='GET'&&url.pathname==='/api/collections')return route.fulfill({json:{collections:[...fixtures.values()]}});
    if(request.method()==='GET')return route.fulfill({json:fixtures.get(url.pathname.split('/').at(-1))??{error:'not found'}});
    throw new Error('Unexpected collection mutation');
  });
  // Present one stored completed round as queued in browser responses only, to exercise the standalone screen.
  await context.route('**/collect/'+storedId+'*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replaceAll('"status":"succeeded"','"status":"queued"')
      .replaceAll('"statusLabel":"เสร็จสิ้น"','"statusLabel":"รอคิวเก็บข้อมูล"');
    await route.fulfill({response,body});
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/collect',{waitUntil:'domcontentloaded',timeout:60000});
  const submit=async keyword=>{
    await expect(page.getByTestId('collect-form')).toBeVisible({timeout:45000});
    await page.getByTestId('keyword').fill(keyword);
    if(await page.getByTestId('unit-select').count()){
      const value=await page.getByTestId('unit-select').locator('option').evaluateAll(options=>options.find(o=>o.value&&!o.disabled)?.value);
      await page.getByTestId('unit-select').selectOption(value);
    }else{
      const value=await page.getByTestId('category-select').locator('option').evaluateAll(options=>options.find(o=>o.value&&!o.disabled)?.value);
      await page.getByTestId('category-select').selectOption(value);
    }
    await page.getByTestId('collect-submit').click();
    await expect(page.getByTestId('collect-progress')).toHaveAttribute('data-status','queued');
    await expect(page.getByText(/รอรอบเก็บข้อมูลว่างและงบประมาณพร้อม/)).toBeVisible();
    await expect(page.getByTestId('collect-again')).toBeVisible();
  };
  await submit('queue browser fixture one');
  await page.screenshot({path:'test-artifacts/collection-queue-progress.png',fullPage:true});
  await page.getByTestId('collect-again').click();
  await submit('queue browser fixture two');
  assert.equal(submissions.length,2);
  assert.notEqual(submissions[0].requestKey,submissions[1].requestKey,'A new round must receive a fresh server key');
  fixtures.set(storedId,{...[...fixtures.values()][0],id:storedId});
  await page.getByTestId('recent-'+storedId).click();
  await expect(page.getByTestId('collect-progress')).toHaveAttribute('data-status','queued');
  await page.getByTestId('collect-again').click();
  await submit('queue browser standalone fixture');
  assert.notEqual(submissions[1].requestKey,submissions[2].requestKey,'Standalone progress must also fetch a fresh form key');
  assert.deepEqual(errors,[]);
  const anon=await browser.newContext();await anon.addCookies(bypass);
  const guest=await anon.newPage();await guest.goto(origin+'/collect',{waitUntil:'domcontentloaded'});
  assert.equal(new URL(guest.url()).pathname,'/login');await anon.close();
  await context.close();
  console.log('PASS: real form, three queued browser submissions, waiting guidance, fresh keys from inline and cached standalone progress, anonymous redirect, no browser exceptions. Collection/category POSTs and one progress status were browser fixtures; zero paid runs.');
}finally{await browser.close();}
