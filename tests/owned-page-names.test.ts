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
 const tables:Record<string,unknown>={workspace_members:{role:'admin',status:'active'},workspace_config:{primary_connection_id:'connection'},meta_ad_accounts:[{id:'account'}],meta_account_page_directory:[{page_id:'100',page_name:'Known'},{page_id:'200',page_name:null},{page_id:'300',page_name:null}],report_pancake_connection:{token_ciphertext:'pancake-cipher'}};
 const calls:string[]=[];let pancakeCalls=0;
 const db={from:(table:string)=>{
  const query={select:()=>query,eq:()=>query,in:(_column:string,values:string[])=>{assert.deepEqual([...values],['account']);return query},single:async()=>({data:tables[table]}),maybeSingle:async()=>({data:tables[table]??null}),then:(accept:(result:unknown)=>unknown)=>Promise.resolve({data:tables[table]}).then(accept)};return query;
 }};
 // denied / wrong-identity: Meta names nothing, so Pancake is asked. pancake-down: it cannot be asked.
 for(const mode of ['success','denied','wrong-identity','pancake-down']){
  calls.length=0;pancakeCalls=0;
  if(mode==='pancake-down')delete tables.report_pancake_connection;
  const result=await runInNewContext(`(async()=>{${source}\nreturn readOwnedPageNames({decrypt:decryptFake})})()`,{
   URL,AbortSignal,ownedPageName,process:{env:{OWNED_MANAGEMENT_PROJECT_PATH:'source',OWNED_MANAGEMENT_AUTHORIZED_EMAIL:'admin'}},
   resolve:(...args:string[])=>args.join('/'),parseEnv:()=>({SUPABASE_URL:'https://source.test',SUPABASE_SERVICE_ROLE_KEY:'test'}),
   sourceEnv:async()=>({SUPABASE_URL:'https://source.test',SUPABASE_SERVICE_ROLE_KEY:'test'}),
   readFile:async(path:string)=>path.endsWith('.env.local')?'test':'EAA'+'a'.repeat(60),createClient:()=>db,
   decryptFake:(ciphertext:string)=>`decrypted:${ciphertext}`,
   fetch:async(url:URL,options:{headers:Record<string,string>})=>{
    if(url.hostname==='pages.fm'){
     // Pancake: its own token, as its API takes it, and never the Meta token.
     pancakeCalls++;assert.equal(url.pathname,'/api/v1/pages');assert.equal(url.searchParams.get('fields'),'activated{id,name}');
     assert.equal(url.searchParams.get('access_token'),'decrypted:pancake-cipher');assert.equal(options.headers.Authorization,undefined);
     // 900 is not one of the selected accounts' Pages; 300's "name" is only its id.
     return {ok:true,status:200,json:async()=>({activated:[{id:'200',name:' Pancake 200 '},{id:'900',name:'Not ours'},{id:'300',name:'300'}]})};
    }
    const id=url.pathname.split('/').at(-1)!;calls.push(id);assert.equal(url.hostname,'graph.facebook.com');
    assert.equal(url.searchParams.get('fields'),'id,name');assert.equal(url.searchParams.has('access_token'),false);
    assert.ok(options.headers.Authorization.startsWith('Bearer '));
    const denied=mode==='denied'||mode==='pancake-down';
    return {ok:!denied,status:denied?400:200,json:async()=>denied?{error:{code:10}}:{id:mode==='wrong-identity'?'999':id,name:'Resolved '+id}};
   },
  });
  assert.deepEqual(calls.sort(),['200','300']);assert.equal(result.names.get('100'),'Known');
  assert.equal(result.names.has('900'),false,'Pancake never adds a Page outside the selected accounts');
  if(mode==='success'){
   assert.equal(pancakeCalls,0,'Pancake is not asked when Meta named every Page');
   assert.equal(result.names.size,3);assert.equal(result.report.unresolved,0);assert.deepEqual({...result.report.pancake},{named:0});
  }else if(mode==='pancake-down'){
   assert.equal(result.names.size,1);assert.equal(result.report.unresolved,2);assert.deepEqual({...result.report.pancake},{error:'unavailable'});
  }else{
   assert.equal(pancakeCalls,1);assert.equal(result.names.get('200'),'Pancake 200');
   assert.equal(result.names.size,2);assert.equal(result.report.unresolved,1);assert.deepEqual({...result.report.pancake},{named:1});
  }
 }
});

test('a name refresh rebuilds the whole-window totals, so the all-days view shows the new names too',()=>{
 const refresh=readFileSync('scripts/refresh-owned-page-names.mjs','utf8');
 // Only when names changed, and only where 0078 exists; inside the refresh's own transaction, before commit.
 const rebuild=refresh.indexOf("select public.owned_build_ad_totals($1) where to_regprocedure('public.owned_build_ad_totals(uuid)') is not null");
 assert.ok(rebuild>0);assert.ok(rebuild<refresh.indexOf("await db.query('commit')"));
 assert.match(refresh.slice(rebuild-80,rebuild),/if\(daily\.rowCount\|\|ads\.rowCount\)/);
});
