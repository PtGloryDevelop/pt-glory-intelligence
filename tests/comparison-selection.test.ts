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

test('the rival picker narrows the unit to one page and a media type, and clearing asks for all of it again', async () => {
  const { rivalPickerUrl } = await import('../app/(app)/compare/ads/selection.ts');
  const read = (changes: Partial<Parameters<typeof rivalPickerUrl>[0]>) => {
    const url = new URL(rivalPickerUrl({ dataset: '', pageIds: ['11', '22'], pageId: '', sort: 'age', media: '', search: '', offset: 0, ...changes }), 'https://pt-glory.invalid');
    return { path: url.pathname, ...Object.fromEntries(url.searchParams) };
  };
  const all = { path: '/api/catalog/ads', search: '', limit: '24', offset: '0', sort: 'age', pages: '11,22' };
  assert.deepEqual(read({}), all);
  assert.deepEqual(read({ pageId: '22', media: 'video', sort: 'new', search: 'ครีม', offset: 24 }),
    { ...all, pages: '22', media: 'video', sort: 'new', search: 'ครีม', offset: '24' });
  assert.deepEqual(read({ pageId: '', media: '' }), all);
  assert.equal(new URL(rivalPickerUrl({ dataset: '', pageIds: Array.from({ length: 70 }, (_, index) => String(index)), pageId: '', sort: 'age', media: '', search: '', offset: 0 }), 'https://pt-glory.invalid').searchParams.get('pages')?.split(',').length, 60, 'the API takes 60 pages');
  // "ดูทุกหมวด": no unit, so no page list; a page left over cannot narrow it.
  assert.equal('pages' in read({ pageIds: null, pageId: '22' }), false);
});

test('a single round asks what the media holds, since its read only knows exact formats', async () => {
  const { rivalPickerUrl } = await import('../app/(app)/compare/ads/selection.ts');
  const read = (media: 'image' | 'video' | 'other' | '') => {
    const url = new URL(rivalPickerUrl({ dataset: 'abc', pageIds: null, pageId: '', sort: 'age', media, search: 'x', offset: 0 }), 'https://pt-glory.invalid');
    assert.equal(url.pathname, '/api/datasets/abc/ads');
    assert.equal(url.searchParams.get('search'), 'x');
    return [url.searchParams.get('hasImage'), url.searchParams.get('hasVideo')];
  };
  assert.deepEqual(read(''), [null, null]);
  assert.deepEqual(read('image'), ['true', null]);
  assert.deepEqual(read('video'), [null, 'true']);
  assert.deepEqual(read('other'), ['false', 'false']);
});

test('the page list reads by name, and a page without a name still has something to pick', async () => {
  const { rivalPageOptions } = await import('../app/(app)/compare/ads/selection.ts');
  assert.deepEqual(rivalPageOptions([{ page_id: '3', page_name: 'ครีมข' }, { page_id: '1', page_name: null }, { page_id: '2', page_name: 'ครีมก' }]),
    [{ id: '1', name: '1' }, { id: '2', name: 'ครีมก' }, { id: '3', name: 'ครีมข' }]);
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
  const { ctaLabel, formatLabel, ownedStatus, platformLabel } = await import('../lib/ad-labels.ts');
  assert.equal(ctaLabel('SEND MESSAGE', null), 'ส่งข้อความ');
  assert.equal(ctaLabel(null, 'LEARN_MORE'), 'ดูเพิ่มเติม');
  assert.equal(ctaLabel('ทักเลย', 'SEND_MESSAGE'), 'ทักเลย');
  assert.equal(ctaLabel(null, null), 'ไม่มีปุ่ม');
  assert.equal(ownedStatus('ADSET_PAUSED'), 'หยุดชุดแอด');
  assert.equal(formatLabel('MULTI_IMAGES'), 'ภาพหลายรูป');
  assert.equal(formatLabel('MULTI_VIDEOS'), 'วิดีโอหลายคลิป');
  assert.equal(formatLabel('MULTI_MEDIAS'), 'ภาพและวิดีโอ');
  assert.equal(formatLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(platformLabel(['FACEBOOK', 'AUDIENCE_NETWORK']), 'Facebook · Audience Network');
});

test('Ad Library codes AI repeats are shown in Thai', async () => {
  const { thaiCodes } = await import('../lib/ad-labels.ts');
  assert.equal(thaiCodes('IMAGE รูปสินค้า ขวดและกล่อง'), 'ภาพ รูปสินค้า ขวดและกล่อง');
  assert.equal(thaiCodes('MULTI_IMAGES และ VIDEO'), 'ภาพหลายรูป และ วิดีโอ');
  assert.equal(thaiCodes('ภาพนิ่ง ไม่มีรหัส'), 'ภาพนิ่ง ไม่มีรหัส');
});
