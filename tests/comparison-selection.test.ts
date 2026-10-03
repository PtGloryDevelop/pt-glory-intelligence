import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonDraftKey, comparisonSelectionKey, comparisonReturnHref, mergeComparisonSelection, parseComparisonDraft, parseComparisonSelection } from '../app/(app)/compare/ads/selection.ts';

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

test('comparison drafts are isolated by user and exact pair, including the observed dataset', () => {
  const user = '22222222-2222-4222-8222-222222222222';
  const selection = parseComparisonSelection({ account: 'act_123', owned: '456', dataset: '99cad727-2ecf-4cb7-b572-8fbcd9f4c7aa', rival: '789' });
  const key = comparisonDraftKey(user, selection);
  assert.ok(key);
  assert.notEqual(key, comparisonDraftKey('33333333-3333-4333-8333-333333333333', selection));
  assert.notEqual(key, comparisonDraftKey(user, { ...selection, owned: '654' }));
  assert.notEqual(key, comparisonDraftKey(user, { ...selection, account: 'act_321' }));
  assert.notEqual(key, comparisonDraftKey(user, { ...selection, rival: '987' }));
  assert.notEqual(key, comparisonDraftKey(user, { ...selection, dataset: '5755eb87-b46a-41f9-bb0c-90cf4b558440' }));
  assert.equal(comparisonDraftKey(user, { ...selection, rival: '' }), null);
  assert.equal(comparisonSelectionKey(''), null);
  assert.notEqual(comparisonSelectionKey(user), comparisonSelectionKey('33333333-3333-4333-8333-333333333333'));
});

test('stored draft reads only bounded team-entered fields and never imports ad metrics', () => {
  const draft = parseComparisonDraft({ product: 'สินค้า', hypothesis: 'เหตุผล', success: 'เกณฑ์', ourOffer: 'ข้อเสนอเรา', theirOffer: 'ข้อเสนอเขา', decision: 'ทดลองข้อเสนอใหม่', spend: 500, roas: 9, financialPayload: { revenue: 1000 } });
  assert.deepEqual(draft, { product: 'สินค้า', ourOffer: 'ข้อเสนอเรา', theirOffer: 'ข้อเสนอเขา', decision: 'ทดลองข้อเสนอใหม่', hypothesis: 'เหตุผล', success: 'เกณฑ์' });
  assert.equal(parseComparisonDraft({ decision: 'เพิ่มงบทันที', hypothesis: 'x'.repeat(5000), product: 'x'.repeat(300) }).decision, '');
  assert.equal(parseComparisonDraft({ hypothesis: 'x'.repeat(5000) }).hypothesis.length, 4000);
  assert.equal(parseComparisonDraft({ product: 'x'.repeat(300) }).product.length, 200);
  assert.equal(parseComparisonDraft(null).hypothesis, '');
});
