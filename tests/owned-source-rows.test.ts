import test from "node:test";
import assert from "node:assert/strict";
import { companyRows } from "../lib/owned-ads/source-rows.ts";

test("all inventory and orphan delivery survive, absent metrics stay null, totals retain currency", () => {
  const rows = companyRows({metaAccountId:"act_1",name:"Account",currency:"USD"},[
    {meta_entity_id:"1",name:"Delivered",parent_meta_id:"10"}, {meta_entity_id:"2",name:"Undelivered"},
  ],[{meta_entity_id:"10",name:"Ad set",parent_meta_id:"20"},{meta_entity_id:"20",name:"Campaign"}], [
    {meta_entity_id:"1",spend:"1.5",impressions:100}, {meta_entity_id:"1",spend:"2.5",impressions:null},
    {meta_entity_id:"3",entity_name:"Orphan",spend:0},
  ]);
  assert.equal(rows.length,3); assert.equal(rows[0].spend,4); assert.equal(rows[0].impressions,null);
  assert.equal(rows[0].campaign_name,"Campaign"); assert.equal(rows[1].spend,null);
  assert.equal(rows[2].spend,0); assert.equal(rows[2].ad_name,"Orphan"); assert.equal(rows[2].currency,"USD");
});
