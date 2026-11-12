import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const settings={enabled:true,monthly_budget_usd:5,max_charge_per_run_usd:1,billing_cycle_anchor:'2020-01-01',billing_cycle_length_months:1,max_concurrent:5,max_records_per_run:500,actor_build:'2.7.25',countries:['TH']};
const source=ts.transpileModule(readFileSync('lib/collect/admission.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const input={requestedBy:'user',requestKey:'one-key',keyword:'real search',country:'TH',activeStatus:'active',maxRecords:100,categoryId:'category',datasetName:null};

function harness({running=0,spent=false,enabled=true}={}){
  const inserts:unknown[][]=[];
  const client={query:async(sql:string,values:unknown[]=[])=>{
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('where request_key'))return {rows:[]};
    if(sql.includes('from public.app_settings'))return {rows:Object.entries({...settings,enabled}).map(([key,value])=>({key:'collector.'+key,value}))};
    if(sql.includes('from public.categories'))return {rows:[{}],rowCount:1};
    if(sql.includes('select status from'))return {rows:Array.from({length:running},()=>({status:'running'}))};
    if(sql.includes('from public.collection_requests'))return {rows:spent?[{status:'succeeded',cost_status:'final',cost_reserved_usd:'5.000000',cost_final_usd:'5.000000',cost_provisional_usd:null,reservation_released_at:null,started_at:new Date().toISOString()}]:[]};
    if(sql.includes('insert into public.collection_requests')){inserts.push(values);return {rows:[{id:'queued-id'}]};}
    if(sql.includes('insert into public.audit_logs'))return {rows:[],rowCount:1};
    throw new Error('Unhandled admission SQL');
  }};
  const pageModule={exports:{}};
  runInNewContext(source,{exports:pageModule.exports,URL,URLSearchParams,require:(name:string)=>{
    if(name==='../db/privileged.ts')return {withTransaction:(fn:(db:unknown)=>unknown)=>fn(client)};
    return require('../lib/collect/'+name.replace(/^\.\//,''));
  }});
  const admit=(pageModule.exports as {admitCollection:(value:unknown)=>Promise<{ok:boolean;reservedUsd?:unknown;refusal?:string}>}).admitCollection;
  return {admit:()=>admit(input),inserts};
}

test('a full shared worker pool accepts another durable request without holding budget',async()=>{
  const run=harness({running:5});
  const result=await run.admit();
  assert.equal(result.ok,true);
  assert.equal(result.reservedUsd,null);
  assert.equal(run.inserts.length,1);
  assert.equal(run.inserts[0][6],null);
});

test('budget depletion queues a request without buying a run',async()=>{
  const run=harness({spent:true});
  const result=await run.admit();
  assert.equal(result.ok,true);
  assert.equal(run.inserts[0][6],null);
});

test('disabling collection still refuses before writing a queue row',async()=>{
  const run=harness({enabled:false});
  assert.equal((await run.admit()).refusal,'not_configured');
  assert.equal(run.inserts.length,0);
});
