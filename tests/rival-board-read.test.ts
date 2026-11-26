import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Regression for 2026-11-26: the board asked the database for each unit's rivals separately and all at
// once. With 16 units the slowest of those reads passed the 8 s statement limit after a new round, and
// "ติดตามคู่แข่ง" answered 503 for everyone. The board now asks once, for every unit.
const source=ts.transpileModule(readFileSync('lib/rivals/board.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText;

type Keyword={id:string;unit_id:string;unit_name:string;keyword:string};
type Relation={page_id:string;unit_id:string;unit_name:string;relation:string};
const page=(id:string,matched:number)=>({page_id:id,page_name:`เพจ ${id}`,matched_ads:matched,new_matched_7d:1,ads_total:matched+2,active_ads:matched,longest_days:30,last_seen_at:'2026-11-26T03:00:00Z',sample:'ตัวอย่าง'});

/** The real getRivalBoard with only its I/O replaced: what it asks the database, and what it keeps. */
function boardHarness({keywords,relations=[],matched={},rpcError=null}:{keywords:Keyword[];relations?:Relation[];matched?:Record<string,unknown[]>;rpcError?:{code:string}|null}){
  const rpcs:{name:string;args:Record<string,unknown>}[]=[],kept:string[]=[];
  const rows=(data:unknown[])=>{const query={select:()=>query,order:()=>query,eq:()=>query,in:()=>query,then:(done:(value:unknown)=>unknown)=>done({data,error:null})};return query;};
  const tables:Record<string,unknown[]>={unit_keywords:keywords,rival_page_units:relations,rival_tracked_pages:[],page_pictures:[]};
  const db={
    from:(name:string)=>rows(tables[name]??[]),
    rpc:async(name:string,args:Record<string,unknown>)=>{
      rpcs.push({name,args});
      if(name==='rival_keyword_pages_by_unit')return rpcError?{data:null,error:rpcError}:{data:matched,error:null};
      if(name==='rival_pages_by_id')return {data:[],error:null};
      return {data:[],error:null};
    },
  };
  const dependencies:Record<string,unknown>={
    'server-only':{},
    '../db/user.ts':{dbUser:async()=>db},
    '../auth/role-model.ts':{satisfies:()=>true},
    '../media/store-supabase.ts':{supabaseArchiveStore:()=>({getPresentationUrls:async()=>new Map()})},
    '../owned-ads/unit-summary.ts':{getUnitSummary:async()=>({units:[]})},
    '../read/latest-round.ts':{readLatestRound:async()=>({lastCollectedAt:'2026-11-26T03:29:54Z',stamp:'9:2026-11-26T03:29:54Z'})},
    '../read/shared-cache.ts':{sharedCache:()=>(key:string,read:()=>Promise<unknown>)=>{kept.push(key);return read();}},
  };
  const board={exports:{} as {getRivalBoard:(actor:{userId:string;role:string})=>Promise<{units:{id:string;name:string;pages:{page_id:string}[]}[]}>}};
  runInNewContext(source,{exports:board.exports,URLSearchParams,console:{error:()=>{}},require:(name:string)=>{
    if(name in dependencies)return dependencies[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }});
  return {read:()=>board.exports.getRivalBoard({userId:'reader',role:'analyst'}),rpcs,kept};
}

const unitId=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const sixteen:Keyword[]=Array.from({length:16},(_,index)=>[
  {id:`k${index}a`,unit_id:unitId(index),unit_name:`U${index}`,keyword:`คำ${index}`},
  {id:`k${index}b`,unit_id:unitId(index),unit_name:`U${index}`,keyword:`Brand${index}`},
]).flat();

test('sixteen units are matched in one database read, not one read each', async()=>{
  const {read,rpcs}=boardHarness({keywords:sixteen});
  await read();
  const asked=rpcs.filter(call=>call.name.startsWith('rival_keyword_pages'));
  assert.deepEqual(asked.map(call=>call.name),['rival_keyword_pages_by_unit']);
  const units=JSON.parse(JSON.stringify(asked[0].args.p_units)) as {unit:string;keywords:string[]}[];
  assert.equal(units.length,16);
  assert.deepEqual(units.find(unit=>unit.unit===unitId(3)),{unit:unitId(3),keywords:['Brand3','คำ3']});
});

test('each unit gets its own pages, and a unit nothing matched is on the board with none', async()=>{
  const {read}=boardHarness({keywords:sixteen,matched:{[unitId(0)]:[page('100',9),page('101',4)],[unitId(5)]:[page('500',2)]}});
  const result=JSON.parse(JSON.stringify(await read())) as {units:{id:string;pages:{page_id:string;matched_ads:number}[]}[]};
  assert.equal(result.units.length,16);
  const pagesOf=(id:string)=>result.units.find(unit=>unit.id===id)!.pages.map(row=>row.page_id);
  assert.deepEqual(pagesOf(unitId(0)),['100','101']);
  assert.deepEqual(pagesOf(unitId(5)),['500']);
  assert.deepEqual(pagesOf(unitId(7)),[]);
});

test('a unit that only has confirmed pages is not sent for matching', async()=>{
  const only={page_id:'900',unit_id:unitId(99),unit_name:'U99',relation:'direct'};
  const {read,rpcs}=boardHarness({keywords:sixteen.slice(0,2),relations:[only]});
  const result=JSON.parse(JSON.stringify(await read())) as {units:{id:string}[]};
  const units=JSON.parse(JSON.stringify(rpcs.find(call=>call.name==='rival_keyword_pages_by_unit')!.args.p_units)) as {unit:string}[];
  assert.deepEqual(units.map(unit=>unit.unit),[unitId(0)]);
  assert.deepEqual(result.units.map(unit=>unit.id).sort(),[unitId(0),unitId(99)].sort());
});

test('no unit has keywords: nothing is asked of the matcher', async()=>{
  const {read,rpcs}=boardHarness({keywords:[]});
  await read();
  assert.equal(rpcs.filter(call=>call.name.startsWith('rival_keyword_pages')).length,0);
});

test('the answer is kept per round and keywords, whatever order the keywords were saved in', async()=>{
  const first=boardHarness({keywords:sixteen}),second=boardHarness({keywords:[...sixteen].reverse()});
  await first.read();await second.read();
  assert.equal(first.kept.length,1);
  assert.deepEqual(first.kept,second.kept);
  assert.ok(first.kept[0].startsWith('9:2026-11-26T03:29:54Z:'),'a new round asks again');
  const changed=boardHarness({keywords:[...sixteen.slice(1),{...sixteen[0],keyword:'คำใหม่'}]});
  await changed.read();
  assert.notDeepEqual(changed.kept,first.kept,'a changed keyword asks again');
});

test('a failed match fails the board; it is never shown as "no rivals"', async()=>{
  const {read}=boardHarness({keywords:sixteen,rpcError:{code:'57014'}});
  await assert.rejects(read(),/Rival suggestions unavailable/);
});

test('the one-pass matcher admits who the tables admit, and nobody else', ()=>{
  const up=readFileSync('supabase/migrations/0082_rival_keyword_pages_by_unit.sql','utf8');
  assert.match(up,/revoke all on function public\.rival_keyword_pages_by_unit\(jsonb\) from public, anon/);
  assert.match(up,/grant execute on function public\.rival_keyword_pages_by_unit\(jsonb\) to authenticated/);
  // It runs as its owner (no per-row policy lookups), so it must ask for the role row itself, first.
  assert.match(up,/security definer set search_path=public,pg_temp/);
  const body=up.slice(up.indexOf('begin'));
  assert.ok(body.indexOf("public.current_user_role() is null")>0&&body.indexOf("public.current_user_role() is null")<body.indexOf('with kw as'),'the role check comes before any read');
  assert.match(up,/errcode='42501'/);
  // No dynamic SQL: keywords are only ever compared.
  assert.doesNotMatch(up,/\bexecute\s+(format|')/i);
  assert.match(readFileSync('supabase/migrations/0082_rival_keyword_pages_by_unit.down.sql','utf8'),/drop function if exists public\.rival_keyword_pages_by_unit\(jsonb\)/);
});
