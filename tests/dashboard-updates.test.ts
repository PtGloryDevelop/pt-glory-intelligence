import assert from 'node:assert/strict';
import test from 'node:test';
import {buildUpdates} from '../lib/dashboard/updates.ts';
import type {OwnedPerformanceRow,OwnedPerformanceSummary} from '../lib/owned-ads/performance.ts';

const summary={currency:'THB',cost_per_conversation:72.72,roas:2.23} as OwnedPerformanceSummary;
const row=(over:Partial<OwnedPerformanceRow>)=>({account_id:'act_1',ad_id:'1',ad_name:'AD',account_name:'U1 - acct',unit_names:['U1'],status:'ACTIVE',spend:5000,conversations:100,cost_per_conversation:50,purchase_value:15000,...over}) as OwnedPerformanceRow;

test('dashboard updates come from real thresholds, one per ad, strongest first', () => {
  const rows=[
    row({ad_id:'hi',ad_name:'VDO277',cost_per_conversation:92.08,conversations:66,spend:6077,purchase_value:10635}),        // high cost per chat
    row({ad_id:'few',ad_name:'TINY',cost_per_conversation:200,conversations:5,spend:9000}),            // too few chats to judge
    row({ad_id:'cheap',ad_name:'VDO 140',cost_per_conversation:43.1,purchase_value:6458,conversations:135,spend:5818,unit_names:[]}),
    row({ad_id:'up',ad_name:'VDO 105',cost_per_conversation:52.99,spend:5987,purchase_value:22811,status:'ADSET_PAUSED'}),
  ];
  const series={'act_1:up':{points:[],previousSpend:1118,change:435.4},'act_1:hi':{points:[],previousSpend:3166,change:92}};
  const out=buildUpdates({summary,rows,series,rivals:{newAds:10,tracked:0}});
  const titles=out.map(item=>item.title);
  assert.ok(titles.some(t=>t.startsWith('VDO277 ค่าทัก 92.08')),'high cost per chat is flagged');
  assert.ok(!titles.some(t=>t.startsWith('TINY')),'five chats is not evidence');
  assert.ok(titles.some(t=>t.startsWith('VDO 140 ทักถูก')),'cheap chats with weak ROAS is flagged');
  const up=out.find(item=>item.title.startsWith('VDO 105'));
  assert.equal(up?.severity,'good');assert.match(up!.body,/ตั้งใจหยุด/);
  assert.equal(out.filter(item=>item.ad?.ad_id==='hi').length,1,'one line per ad even when two rules match');
  assert.ok(titles.includes('1 ใน 4 แอดงบสูงสุดยังไม่ผูกยูนิต'));
  assert.ok(out.some(item=>item.id==='rival:untracked'));
  assert.deepEqual(out.map(i=>i.weight),[...out.map(i=>i.weight)].sort((a,b)=>b-a));
});

test('no summary means no ratio judgments, only data lines', () => {
  const out=buildUpdates({summary:undefined,rows:[row({unit_names:[]})],series:null,rivals:null});
  assert.deepEqual(out.map(item=>item.kind),['data']);
});
