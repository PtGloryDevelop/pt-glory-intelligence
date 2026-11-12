import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type {DatasetListRow} from '../lib/read/queries.ts';

const require=createRequire(import.meta.url);
const source=ts.transpileModule(readFileSync('app/(app)/competitors/page.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const timeout={code:'57014',message:'canceling statement due to statement timeout'};
const dataset={dataset_id:'11111111-1111-4111-8111-111111111111',dataset_name:'Stored round',collected_at:'2026-11-12T00:00:00Z',ads_in_dataset:3} as DatasetListRow;

/** Execute the actual page with only its I/O and child components replaced. */
function pageHarness({failDatasets=false,analyst=false}={}){
  let datasetReads=0;
  const board={units:[],unitsWithoutKeywords:[],tracked:0,canEdit:analyst,lastCollectedAt:null,newThisWeek:0};
  const dependencies:Record<string,unknown>={
    '@/lib/auth/roles':{requireActorOrRedirect:async()=>({userId:'reader',role:analyst?'analyst':'viewer'}),satisfies:()=>analyst},
    '@/lib/db/user':{dbUser:async()=>({from:()=>({select:()=>({order:async()=>({data:[],error:null})})})})},
    '@/lib/read/queries':{
      listDatasets:async()=>{datasetReads++;if(failDatasets)throw timeout;return [dataset];},
      listCategories:async()=>[],getDatasetQuality:async()=>[],
    },
    '@/lib/collect/read':{listCollections:async()=>[]},
    '@/lib/collect/form-settings':{collectorFormSettings:async()=>({enabled:false,countries:[],maxRecordsPerRun:null})},
    '../collect/collect-launcher':{CollectLauncherProvider:'CollectLauncherProvider',CollectLaunchButton:'CollectLaunchButton'},
    '@/lib/format/date':{thaiDateTime:(value:string)=>value},
    '@/components/shell/PageHeader':{PageHeader:'PageHeader'},
    '../datasets/[id]/explorer':{Explorer:'Explorer',EXPLORER_PAGE_SIZE:24},
    '@/lib/read/dataset-ads':{datasetAdsPage:async()=>({rows:[],total:0,facets:[]})},
    '@/lib/read/request':{isUuid:(value:string)=>value===dataset.dataset_id},
    '@/lib/explorer/filters':{DEFAULT_SORT:'new',fromQuery:()=>({filters:{},sort:'new',offset:0}),toQuery:()=>new URLSearchParams()},
    './catalog-library':{CatalogLibrary:'CatalogLibrary'},
    './rival-board':{RivalBoard:'RivalBoard'},
    '@/lib/rivals/board':{getRivalBoard:async()=>board,listRivalUnits:async()=>[]},
    '@/lib/rivals/strips-read':{readStrips:async()=>({})},
    '@/components/shell/icons':{Icon:'Icon'},
    './competitors.module.css':{},
    'next/link':{__esModule:true,default:'Link'},
  };
  const pageModule={exports:{}};
  runInNewContext(source,{exports:pageModule.exports,require:(name:string)=>{
    if(name in dependencies)return dependencies[name];
    if(name==='react/jsx-runtime'||name==='node:crypto')return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  },URLSearchParams});
  const render=(pageModule.exports as {default:(props:{searchParams:Promise<Record<string,string>>})=>Promise<unknown>}).default;
  return {render:(params:Record<string,string>={})=>render({searchParams:Promise.resolve(params)}),datasetReads:()=>datasetReads};
}

type Node={type?:unknown;props?:{children?:unknown;[key:string]:unknown}};
function find(node:unknown,type:string):Node|undefined{
  if(Array.isArray(node))return node.map(child=>find(child,type)).find(Boolean);
  if(!node||typeof node!=='object')return undefined;
  const element=node as Node;
  return element.type===type?element:find(element.props?.children,type);
}

for(const analyst of [false,true])test(`rival board survives dataset_list timeout without calling it (${analyst?'analyst':'viewer'})`,async()=>{
  const page=pageHarness({failDatasets:true,analyst});
  const output=await page.render();
  assert.ok(find(output,'RivalBoard'));
  assert.equal(page.datasetReads(),0);
  assert.equal(Boolean(find(output,'CollectLauncherProvider')),analyst);
});

test('library still loads stored rounds and reports a dataset read failure',async()=>{
  const page=pageHarness();
  const output=await page.render({view:'all'});
  assert.equal(page.datasetReads(),1);
  const rounds=find(output,'CatalogLibrary')?.props?.datasets as {id:string}[];
  assert.equal(rounds[0].id,dataset.dataset_id);
  await assert.rejects(pageHarness({failDatasets:true}).render({view:'all'}),error=>error===timeout);
});

test('a selected round still opens its own explorer',async()=>{
  const page=pageHarness();
  const output=await page.render({dataset:dataset.dataset_id});
  assert.equal(page.datasetReads(),1);
  assert.equal(find(output,'Explorer')?.props?.datasetId,dataset.dataset_id);
  assert.equal(find(output,'RivalBoard'),undefined);
});

test('a missing round still falls back to the library',async()=>{
  const page=pageHarness();
  const output=await page.render({dataset:'missing'});
  assert.equal(page.datasetReads(),1);
  assert.ok(find(output,'CatalogLibrary'));
  assert.equal(find(output,'Explorer'),undefined);
});
