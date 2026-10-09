import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonSelectionKey, comparisonReturnHref, mergeComparisonSelection, parseComparisonSelection } from '../app/(app)/compare/ads/selection.ts';

test('comparison returns preserve library filters and reject external or unrelated destinations', () => {
  for (const path of ['/', '/market-overview', '/owned-ads/performance?period=7d&unit=example&page=2', '/?period=7d&unit=example&page=2', '/command-center?sort=roas&period=14d', '/competitors?search=ผงผัก&active=active&offset=24', '/owned-ads?spend=all&status=PAUSED&page=2']) {
    assert.equal(comparisonReturnHref(path), new URL(path, 'https://pt-glory.invalid').pathname + new URL(path, 'https://pt-glory.invalid').search);
  }
  for (const value of [null, ['/owned-ads'], 'https://evil.example/owned-ads', '//evil.example/owned-ads', '/\\evil.example/owned-ads', '/\\[invalid', 'javascript:alert(1)', '/collect', '/login', '/competitors/' + 'x'.repeat(2048)]) assert.equal(comparisonReturnHref(value), '/');
});

test('comparison links validate identifiers and replace only their own side', () => {
  const saved = parseComparisonSelection({ account: 'act_123', owned: '456', dataset: '99cad727-2ecf-4cb7-b572-8fbcd9f4c7aa', rival: '789' });
  const competitorLink = parseComparisonSelection({ dataset: '5755eb87-b46a-41f9-bb0c-90cf4b558440', rival: '987' });
  assert.deepEqual(mergeComparisonSelection(saved, competitorLink), { account: 'act_123', owned: '456', dataset: competitorLink.dataset, rival: '987' });
  const ownedLink = parseComparisonSelection({ account: 'act_321', owned: '654' });
  const next = mergeComparisonSelection(saved, ownedLink);
  assert.equal(next.rival, '789'); assert.equal(next.dataset, saved.dataset); assert.equal(next.owned, '654');
  assert.deepEqual(parseComparisonSelection({ account: 'bad account', owned: '456', dataset: 'bad-id', rival: '789' }), { account: '', owned: '', dataset: '', rival: '' });
  assert.equal(parseComparisonSelection({ rival: '789' }).rival, '', 'No silent switch to master data');
  assert.equal(parseComparisonSelection({ account: ['act_123'], owned: '456' }).owned, '');
});

test('comparison selections are stored per user', () => {
  const user = '22222222-2222-4222-8222-222222222222';
  assert.equal(comparisonSelectionKey(''), null);
  assert.notEqual(comparisonSelectionKey(user), comparisonSelectionKey('33333333-3333-4333-8333-333333333333'));
});

test('our ad has one name everywhere, and a catalog template is never printed as copy', async () => {
  const { ownedName, rivalCopy } = await import('../app/(app)/compare/ads/selection.ts');
  assert.equal(ownedName({ ad_name: 'U11', title: null, campaign_name: 'Test Gen Code U11' }), 'Test Gen Code U11');
  assert.equal(ownedName({ ad_name: 'VDO 58', title: 'อื่น', campaign_name: null }), 'VDO 58');
  assert.equal(rivalCopy('{{product.brand}}').template, true);
  assert.equal(rivalCopy('ลด 40% {{product.name}} วันนี้วันเดียว ส่งฟรีทั่วไทย').template, false);
  assert.equal(rivalCopy(null).text, 'ไม่มีข้อความที่บันทึกไว้');
});

test('codes on the compare screen read in Thai, and unknown codes are kept', async () => {
  const { ctaLabel, formatLabel, ownedStatus, platformLabel } = await import('../app/(app)/compare/ads/labels.ts');
  assert.equal(ctaLabel('SEND MESSAGE', null), 'ส่งข้อความ');
  assert.equal(ctaLabel(null, 'LEARN_MORE'), 'ดูเพิ่มเติม');
  assert.equal(ctaLabel('ทักเลย', 'SEND_MESSAGE'), 'ทักเลย');
  assert.equal(ctaLabel(null, null), 'ไม่มีปุ่ม');
  assert.equal(ownedStatus('ADSET_PAUSED'), 'หยุดชุดแอด');
  assert.equal(formatLabel('MULTI_IMAGES'), 'ภาพหลายรูป');
  assert.equal(formatLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(platformLabel(['FACEBOOK', 'AUDIENCE_NETWORK']), 'Facebook · Audience Network');
});
