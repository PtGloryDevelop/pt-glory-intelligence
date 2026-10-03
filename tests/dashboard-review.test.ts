import assert from 'node:assert/strict';
import test from 'node:test';
import {latestReviewPeriod,parseReviewOptions,reviewChange,reviewReturnHref} from '../lib/dashboard/review-model.ts';
import type {OwnedPerformanceData,OwnedPerformanceSummary} from '../lib/owned-ads/performance.ts';
import {isPerformanceReturn,legacyPerformanceHref} from '../lib/owned-ads/performance-navigation.ts';

const summary=(currency='THB',spend=100):OwnedPerformanceSummary=>({currency,ad_count:2,daily_rows:14,spend,conversations:10,purchases:2,purchase_value:300,impressions:1000,video_views:100,roas:300/spend,cost_per_conversation:spend/10,hook_rate:0.1,close_rate:null,coverage:Object.fromEntries(['spend','conversations','purchase_value','roas','hook_rate'].map(field=>[field,{present:14,total:14}])) as OwnedPerformanceSummary['coverage']});
const report=():OwnedPerformanceData=>({ready:true,snapshot:null,coverage:{from:'2026-09-01',to:'2026-10-02'},period:{from:'2026-09-26',to:'2026-10-02'},filters:{units:[],pages:[]},summary:[summary('THB',150)],rows:[],total:2,page:0,pageSize:24,previous:{period:{from:'2026-09-19',to:'2026-09-25'},summary:[summary()]}});

test('overview windows end at imported history, never today, and preserve full requested length',()=>{
 const now=new Date('2026-10-03T05:00:00Z');
 assert.deepEqual(latestReviewPeriod({from:'2026-09-01',to:'2026-10-03'},7,now),{from:'2026-09-26',to:'2026-10-02'});
 assert.deepEqual(latestReviewPeriod({from:'2026-09-01',to:'2026-09-30'},14,now),{from:'2026-09-17',to:'2026-09-30'});
});
test('percent changes require matching currency, source fields, period length and imported bounds',()=>{
 const data=report();assert.equal(reviewChange(data,data.summary[0],'spend'),50);
 assert.equal(reviewChange(data,data.summary[0],'cost_per_conversation'),50);
 data.previous!.summary=[summary('USD')];assert.equal(reviewChange(data,data.summary[0],'spend'),null);
 data.previous!.summary=[summary()];data.previous!.summary[0].coverage.spend.present=13;assert.equal(reviewChange(data,data.summary[0],'spend'),null);
 data.previous!.summary=[summary('THB',0)];assert.equal(reviewChange(data,data.summary[0],'spend'),null);
 data.previous!.summary=[summary()];data.coverage!.from='2026-09-20';assert.equal(reviewChange(data,data.summary[0],'spend'),null);
 data.coverage!.from='2026-09-01';data.previous!.period.from='2026-09-20';assert.equal(reviewChange(data,data.summary[0],'spend'),null);
 data.previous!.period.from='2026-09-19';data.previous!.summary[0].spend=1e-300;data.summary[0].spend=1e300;assert.equal(reviewChange(data,data.summary[0],'spend'),null);
});
test('dashboard return preserves daily dates and sorting without invoking the legacy redirect',()=>{
 const data=report(),options=parseReviewOptions(new URLSearchParams('window=14&sort=roas'));
 const href=reviewReturnHref(data,options),url=new URL(href,'https://pt-glory.invalid');
 assert.equal(isPerformanceReturn(href),true);
 assert.equal(legacyPerformanceHref(Object.fromEntries(url.searchParams)),null);
 assert.equal(parseReviewOptions(url.searchParams).period?.from,data.period.from);
 assert.equal(parseReviewOptions(url.searchParams).sort,'roas');
 assert.throws(()=>parseReviewOptions(new URLSearchParams('window=7&window=14')));
 assert.throws(()=>parseReviewOptions(new URLSearchParams('period=custom&from=2026-02-30&to=2026-03-01')));
 assert.throws(()=>parseReviewOptions(new URLSearchParams('sort=spend&sort=roas')));
});
