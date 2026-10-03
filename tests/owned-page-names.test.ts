import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedPageName,ownedPageChoices} from '../lib/owned-ads/page-names.ts';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {companyRows} from '../lib/owned-ads/source-rows.ts';

test('missing names remain explicit; duplicate names keep distinct Page filter identities',()=>{
 const pages=[{id:'100',name:'100'},{id:'300',name:' Brand '},{id:'200',name:'Brand'},{id:'400',name:' '}];
 const choices=ownedPageChoices(pages);
 assert.deepEqual(choices.map(p=>p.id),['200','300','100','400']);
 assert.equal(choices[0].label,'Brand · 200');assert.equal(choices[1].label,'Brand · 300');
 assert.equal(choices[2].label,'ยังไม่มีชื่อเพจ · 100');assert.equal(choices[3].name,null);
 assert.equal(pages[1].name,' Brand ');
 assert.equal(ownedPageName('100','100'),null);assert.equal(ownedPageName('100',null),null);
 assert.equal(ownedPageName('100','123'), '123');
});

test('shared names enrich inventory without replacing Page identity, currency or metrics',()=>{
 const rows=companyRows({metaAccountId:'act_1',name:'Account',currency:'THB'},[
  {meta_entity_id:'1',page_id:'100'}, {meta_entity_id:'2',page_id:'200'},
 ],[],[{meta_entity_id:'1',pageId:'999',pageName:'Different Page',spend:12}],new Map([['100','Brand']]));
 assert.equal(rows[0].page_id,'100');assert.equal(rows[0].page_name,'Brand');assert.equal(rows[0].spend,12);
 assert.equal(rows[1].page_name,null);assert.equal(rows[1].spend,null);
});

test('Page lookup stays in selected source scope, validates returned identity and retains known names on denial',async()=>{
 const source=readFileSync('scripts/owned-page-names.mjs','utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
 const tables:Record<string,unknown>={workspace_members:{role:'admin',status:'active'},workspace_config:{primary_connection_id:'connection'},meta_ad_accounts:[{id:'account'}],meta_account_page_directory:[{page_id:'100',page_name:'Known'},{page_id:'200',page_name:null},{page_id:'300',page_name:null}]};
 const calls:string[]=[];
 const db={from:(table:string)=>{
  const query={select:()=>query,eq:()=>query,in:(_column:string,values:string[])=>{assert.deepEqual([...values],['account']);return query},single:async()=>({data:tables[table]}),then:(accept:(result:unknown)=>unknown)=>Promise.resolve({data:tables[table]}).then(accept)};return query;
 }};
 for(const mode of ['success','denied','wrong-identity']){
  calls.length=0;
  const result=await runInNewContext(`(async()=>{${source}\nreturn readOwnedPageNames()})()`,{
   URL,AbortSignal,ownedPageName,process:{env:{OWNED_MANAGEMENT_PROJECT_PATH:'source',OWNED_MANAGEMENT_AUTHORIZED_EMAIL:'admin'}},
   resolve:(...args:string[])=>args.join('/'),parseEnv:()=>({SUPABASE_URL:'https://source.test',SUPABASE_SERVICE_ROLE_KEY:'test'}),
   readFile:async(path:string)=>path.endsWith('.env.local')?'test':'EAA'+'a'.repeat(60),createClient:()=>db,
   fetch:async(url:URL,options:{headers:{Authorization:string}})=>{
    const id=url.pathname.split('/').at(-1)!;calls.push(id);assert.equal(url.hostname,'graph.facebook.com');
    assert.equal(url.searchParams.get('fields'),'id,name');assert.equal(url.searchParams.has('access_token'),false);
    assert.ok(options.headers.Authorization.startsWith('Bearer '));
    return {ok:mode!=='denied',status:mode==='denied'?400:200,json:async()=>mode==='denied'?{error:{code:10}}:{id:mode==='wrong-identity'?'999':id,name:'Resolved '+id}};
   },
  });
  assert.deepEqual(calls.sort(),['200','300']);assert.equal(result.names.get('100'),'Known');
  assert.equal(result.names.size,mode==='success'?3:1);
  assert.equal(result.report.unresolved,mode==='success'?0:2);
 }
});
