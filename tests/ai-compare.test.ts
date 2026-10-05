import assert from 'node:assert/strict';
import test from 'node:test';
import {adRefId, parseAdRefs} from '../lib/ai/compare-shared.ts';

const own = {kind: 'own', account: 'act_123', ad: '120244621593930490'};
const rival = {kind: 'rival', dataset: '5755eb87-b46a-41f9-bb0c-90cf4b558440', ad: '1873272776786708'};

test('AI compare takes 2–5 ads with at least one of ours', () => {
  assert.deepEqual(parseAdRefs([own, rival])?.map(adRefId), ['own:act_123:120244621593930490', 'rival:5755eb87-b46a-41f9-bb0c-90cf4b558440:1873272776786708']);
  assert.equal(parseAdRefs([own]), null, 'one ad is not a comparison');
  assert.equal(parseAdRefs([rival, {...rival, ad: '1'}]), null, 'needs one of ours');
  assert.equal(parseAdRefs([own, own]), null, 'no duplicates');
  assert.equal(parseAdRefs([own, ...Array.from({length: 5}, (_, i) => ({...rival, ad: String(i + 1)}))]), null, 'at most five');
});

test('AI compare refuses ids that are not ids', () => {
  assert.equal(parseAdRefs([own, {...rival, dataset: 'x'}]), null);
  assert.equal(parseAdRefs([{...own, account: 'act_1; drop'}, rival]), null);
  assert.equal(parseAdRefs([own, {...rival, kind: 'other'}]), null);
  assert.equal(parseAdRefs('nope'), null);
});
