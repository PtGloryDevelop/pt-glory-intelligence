import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewAdKey,reviewDates,reviewSeries,seriesSegments,type ReviewDay} from '../lib/dashboard/series.ts';
import {reviewCsv} from '../lib/dashboard/export.ts';
import type {OwnedPerformanceRow} from '../lib/owned-ads/performance.ts';

const period={from:'2026-10-01',to:'2026-10-02'},previous={from:'2026-09-29',to:'2026-09-30'};
const ad={account_id:'account-a',ad_id:'123',currency:'THB',ad_name:'แอดทดสอบ',spend:30,purchase_value:90,conversations:3,cost_per_conversation:10} as OwnedPerformanceRow;
const day=(date:string,spend:ReviewDay['spend'],overrides:Partial<ReviewDay>={}):ReviewDay=>({account_id:ad.account_id,ad_id:ad.ad_id,currency:ad.currency,insight_date:date,spend,...overrides});

test('daily series isolates account, ad and currency and calculates complete equal-window changes',()=>{
 const days=[day('2026-09-29',5),day('2026-09-30','10'),day('2026-10-01',0),day('2026-10-02',30),day('2026-10-01',999,{account_id:'other'}),day('2026-10-02',999,{currency:'USD'}),day('2026-10-02',999,{ad_id:'other'})];
 const series=reviewSeries([ad],days,period,previous)[reviewAdKey(ad)];
 assert.deepEqual(series.points,[{date:period.from,value:0},{date:period.to,value:30}]);
 assert.equal(series.previousSpend,15);assert.equal(series.change,100);
});
test('absent, invalid and duplicate records remain unknown and suppress per-ad percent changes',()=>{
 for(const records of [[day(period.from,0)],[day(period.from,null),day(period.to,30)],[day(period.from,-1),day(period.to,30)],[day(period.from,'invalid'),day(period.to,30)],[day(period.from,1),day(period.from,2),day(period.to,30)]]){
  const series=reviewSeries([ad],[day(previous.from,5),day(previous.to,10),...records],period,previous)[reviewAdKey(ad)];
  assert.ok(series.points.some(point=>point.value===null));assert.equal(series.change,null);
 }
 assert.equal(reviewSeries([ad],[day(period.from,10),day(period.to,20),day(previous.from,5)],period,previous)[reviewAdKey(ad)].previousSpend,null);
 assert.equal(reviewSeries([ad],[day(period.from,10),day(period.to,20),day(previous.from,0),day(previous.to,0)],period,previous)[reviewAdKey(ad)].change,null);
 assert.deepEqual(reviewSeries([ad],[],period,{from:previous.from,to:previous.from}),{});
});
test('daily chart dates are bounded and paths do not bridge missing days or create variation in flat records',()=>{
 assert.deepEqual(reviewDates(period),['2026-10-01','2026-10-02']);
 assert.deepEqual(reviewDates({from:'invalid',to:period.to}),[]);
 assert.deepEqual(reviewDates({from:period.to,to:period.from}),[]);
 assert.deepEqual(reviewDates({from:'2026-08-01',to:period.to}),[]);
 assert.deepEqual(seriesSegments([null,null]),[]);
 assert.equal(seriesSegments([1,2,null,3,4]).length,2);
 assert.deepEqual(seriesSegments([0,0]),['4.0,16.0 116.0,16.0']);
 assert.deepEqual(seriesSegments([null,10,null]),['60.0,16.0']);
});
test('visible-row CSV retains dates, currency and unknowns while escaping multiline copy and spreadsheet formulas',()=>{
 const csv=reviewCsv([{...ad,ad_name:'=HYPERLINK("test")\nข้อความ',purchase_value:null,conversations:null,cost_per_conversation:null}],period);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""test"")\nข้อความ"'));
 assert.ok(csv.includes('"THB","2026-10-01","2026-10-02","30","","",""'));
 assert.equal(reviewCsv([ad],period).split('\r\n').length,2);
 assert.ok(reviewCsv([ad],period).endsWith('"30","3","3","10"'));
 assert.ok(reviewCsv([{...ad,ad_name:'  =SUM(1,2)'}],period).includes('"\'  =SUM(1,2)"'));
});
