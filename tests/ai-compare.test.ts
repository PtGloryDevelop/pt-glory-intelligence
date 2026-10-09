import assert from 'node:assert/strict';
import test from 'node:test';
import {adRefId, biggestGap, cleanScores, fdaWatch, parseAdRefs, scoreLead, scoreLevel, scoreTotal} from '../lib/ai/compare-shared.ts';

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

const scores = (values: (number | null)[]) => cleanScores(Object.fromEntries(['hook', 'clarity', 'cta', 'emotion', 'offer', 'fit'].map((dim, i) => [dim, {score: values[i], why: dim}])));

test('scorecard keeps whole numbers 0–10 and null for nothing to judge', () => {
  const clean = scores([12, -3, 6.6, Number.NaN, 4, null]);
  assert.deepEqual(['hook', 'clarity', 'cta', 'emotion', 'offer', 'fit'].map(dim => clean[dim as keyof typeof clean].score), [10, 0, 7, null, 4, null]);
  assert.equal(cleanScores(undefined).hook.score, null);
  assert.equal(cleanScores(undefined).hook.why, '');
});

test('scorecard total counts only the parts that were judged', () => {
  assert.deepEqual(scoreTotal(scores([7, 6, 5, 4, 3, 8])), {got: 33, max: 60});
  assert.deepEqual(scoreTotal(scores([7, 6, 5, 4, 3, null])), {got: 25, max: 50});
});

test('biggest gap is where the rival beats us by the most', () => {
  assert.deepEqual(biggestGap(scores([5, 6, 5, 4, 3, 7]), scores([7, 6, 5, 4, 8, 7])), {dim: 'offer', ours: 3, theirs: 8});
  assert.equal(biggestGap(scores([9, 9, 9, 9, 9, 9]), scores([5, 5, 5, 5, 5, 5])), null, 'we lead everywhere');
  assert.deepEqual(biggestGap(scores([5, 5, 5, 5, 5, null]), scores([6, 5, 5, 5, 5, 10])), {dim: 'hook', ours: 5, theirs: 6}, 'unjudged parts are skipped');
});

test('FDA watch flags health claims in suggestions, not plain offers', () => {
  assert.deepEqual(fdaWatch('ผงผักเพื่อสุขภาพ ช่วยดูแลไขมันและหลอดเลือด ปลอดภัยแน่นอน'), ['แน่นอน', 'ไขมัน', 'หลอดเลือด']);
  assert.deepEqual(fdaWatch('ฟื้นฟูร่างกายใน 7 วัน'), ['ใน 7 วัน']);
  assert.deepEqual(fdaWatch('โปร 9.9 ลดจัดเต็ม 6 ชิ้น พร้อมแถมฟรีกระบอกน้ำ'), []);
  assert.deepEqual(fdaWatch('สะดวกสั่งง่าย ส่งฟรี มีปลายทาง'), []);
});

test('score words follow the rubric anchors', () => {
  assert.deepEqual([0, 3, 4, 6, 7, 8, 9, 10].map(scoreLevel), ['อ่อน', 'อ่อน', 'ธรรมดา', 'ธรรมดา', 'ดี', 'ดี', 'โดดเด่น', 'โดดเด่น']);
  assert.equal(scoreLevel(null), 'ไม่มีภาพให้ดู');
});

test('scorecard lead says who leads, by how much, and the widest gap', () => {
  assert.equal(scoreLead(scores([7, 7, 5, 6, 0, 7]), scores([7, 8, 7, 7, 8, 9])), 'แอดเราตามหลังคู่แข่ง 14 คะแนน · ห่างมากสุดที่ข้อเสนอ (เรา 0 · คู่แข่ง 8)');
  assert.equal(scoreLead(scores([9, 9, 9, 9, 9, 9]), scores([5, 5, 5, 5, 5, 5])), 'แอดเรานำคู่แข่ง 24 คะแนน · ไม่มีหัวข้อไหนที่คู่แข่งได้มากกว่า');
  assert.match(scoreLead(scores([7, 7, 5, 6, 4, null]), scores([7, 8, 7, 7, 8, 9])), /^แอดเราได้ 29\/50 คู่แข่งได้ 46\/60 \(AI ไม่เห็นภาพบางแอด/);
});
