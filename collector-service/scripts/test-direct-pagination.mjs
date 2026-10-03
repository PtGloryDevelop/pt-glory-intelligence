import assert from 'node:assert/strict';
import { buildDirectPaginationBody } from '../src/network-extractor.mjs';

const original = new URLSearchParams({
  fb_api_req_friendly_name: 'AdLibrarySearchPaginationQuery',
  doc_id: '24922295957467452',
  __req: 'a',
  variables: JSON.stringify({
    queryString: 'ฮายอง',
    cursor: 'OLD_CURSOR',
    first: 30,
    excludedIDs: ['111111111111111']
  })
}).toString();

const next = buildDirectPaginationBody(
  original,
  'application/x-www-form-urlencoded',
  'NEXT_CURSOR_ABC_123456789',
  ['111111111111111', '222222222222222', '333333333333333']
);
assert.ok(next);
assert.equal(next.cursorPath, 'cursor');
assert.equal(next.excludedIdsPath, 'excludedIDs');
const params = new URLSearchParams(next.body);
const variables = JSON.parse(params.get('variables'));
assert.equal(variables.cursor, 'NEXT_CURSOR_ABC_123456789');
assert.deepEqual(variables.excludedIDs, [
  '111111111111111',
  '222222222222222',
  '333333333333333'
]);
assert.equal(params.get('doc_id'), '24922295957467452');
assert.equal(params.get('__req'), 'b');
assert.equal(params.get('fb_api_req_friendly_name'), 'AdLibrarySearchPaginationQuery');

console.log(JSON.stringify({
  ok: true,
  cursor_path: next.cursorPath,
  excluded_ids_path: next.excludedIdsPath,
  excluded_ids_added: next.excludedIdsAdded,
  preserved_doc_id: params.get('doc_id'),
  next_req_sequence: params.get('__req')
}, null, 2));
