import assert from 'node:assert/strict';
import { inspectGraphqlPayload, inspectGraphqlRequest } from '../src/network-extractor.mjs';

const payload = {
  data: {
    ad_library_main: {
      search_results_connection: {
        page_info: { end_cursor: 'CURSOR_ABC_123456789', has_next_page: true },
        edges: [
          { node: { ad_archive_id: '123456789012345', page_id: '61570000000001', page_name: 'Example', snapshot: { body: 'hello' } } },
          { node: { ad_archive_id: '223456789012345', page_id: '61570000000002', page_name: 'Example 2' } }
        ]
      }
    }
  }
};

const shape = inspectGraphqlPayload(payload);
assert.equal(shape.top_level_type, 'object');
assert.ok(shape.top_level_keys.includes('data'));
assert.ok(shape.direct_ad_object_paths.length >= 2);
assert.ok(shape.largest_arrays.some((x) => x.path.includes('edges') && x.length === 2));
assert.ok(shape.interesting_paths.some((x) => x.path.includes('page_info')));

const postData = new URLSearchParams({
  fb_api_req_friendly_name: 'AdLibrarySearchPaginationQuery',
  doc_id: '987654321',
  variables: JSON.stringify({ query: 'ฮายอง', count: 30, cursor: null })
}).toString();
const req = inspectGraphqlRequest(postData, { 'content-type': 'application/x-www-form-urlencoded' });
assert.equal(req.friendly_name, 'AdLibrarySearchPaginationQuery');
assert.equal(req.doc_id, '987654321');
assert.ok(req.variable_keys.includes('cursor'));
assert.ok(req.cursor_paths.includes('cursor'));
assert.equal(req.parse_mode, 'form');

console.log(JSON.stringify({ ok: true, direct_ad_paths: shape.direct_ad_object_paths.length, largest_arrays: shape.largest_arrays.length, friendly_name: req.friendly_name }, null, 2));
