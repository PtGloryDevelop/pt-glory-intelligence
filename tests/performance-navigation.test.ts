import assert from 'node:assert/strict';
import test from 'node:test';
import {legacyPerformanceHref,isPerformanceReturn} from '../lib/owned-ads/performance-navigation.ts';

test('old performance bookmarks retain every filter and duplicate value after homepage move',()=>{
  assert.equal(legacyPerformanceHref({}),null);
  assert.equal(legacyPerformanceHref({dataset:'example'}),null);
  const target=legacyPerformanceHref({period:'custom',from:'2026-09-27',to:'2026-10-03',q:'ชา',page:'2',unit:['U3','U11'],extra:'keep'});
  assert.ok(target);
  const url=new URL(target,'https://pt-glory.invalid');
  assert.equal(url.pathname,'/owned-ads/performance');
  assert.equal(url.searchParams.get('q'),'ชา');
  assert.equal(url.searchParams.get('page'),'2');
  assert.equal(url.searchParams.get('from'),'2026-09-27');
  assert.equal(url.searchParams.get('to'),'2026-10-03');
  assert.deepEqual(url.searchParams.getAll('unit'),['U3','U11']);
  assert.equal(url.searchParams.get('extra'),'keep');
});

test('comparison keeps daily filters separate from overview snapshot performance',()=>{
  for(const path of ['/','/market-overview','/?dataset=example','/owned-ads','/competitors'])assert.equal(isPerformanceReturn(path),false,path);
  for(const path of ['/owned-ads/performance','/owned-ads/performance?period=14d&page=2','/command-center?sort=roas','/?period=7d','/?q=ชา'])assert.equal(isPerformanceReturn(path),true,path);
});
