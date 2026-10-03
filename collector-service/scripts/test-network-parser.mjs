import assert from 'node:assert/strict';
import { extractAdsFromPayload, findCursorCandidates, buildReplayBody, requestCursorShape, parseFacebookPayload } from '../src/network-extractor.mjs';

const payload = {
  data: {
    ad_library_main: {
      page_info: { end_cursor: 'CURSOR_NEXT_1234567890', has_next_page: true },
      edges: [
        { node: { adArchiveID: '111111111111111', pageID: '61570000000001', pageName: 'Test Page A', startDate: 1790000000, isActive: true, body: 'ฮายอง https://example.com/a', publisherPlatforms: ['FACEBOOK'], images: [{ original_image_url: 'https://cdn.example.com/a.jpg' }] } },
        { node: { ad_archive_id: '222222222222222', page_id: '61570000000002', page_name: 'Test Page B', start_date: 1790000000, status: 'active', ad_creative_body: 'Another ad', video_hd_url: 'https://cdn.example.com/b.mp4' } }
      ]
    }
  }
};

const sourceUrl = 'https://www.facebook.com/ads/library/?q=%E0%B8%AE%E0%B8%B2%E0%B8%A2%E0%B8%AD%E0%B8%87&country=TH';
const rows = extractAdsFromPayload(payload, sourceUrl);
assert.equal(rows.length, 2);
assert.deepEqual(new Set(rows.map((r) => r.ad_archive_id)), new Set(['111111111111111','222222222222222']));
assert.equal(rows[0].page_identity_key, 'page:61570000000001');
assert.ok(rows[0].body_urls.includes('https://example.com/a'));
assert.equal(rows[0].display_format, 'SINGLE_IMAGE');
assert.equal(rows[0].videos.length, 0);
assert.equal(rows[0].images.length, 1);
assert.equal(rows[1].display_format, 'VIDEO');
assert.equal(rows[1].images.length, 0);
assert.equal(rows[1].videos.length, 1);

const cursors = findCursorCandidates(payload);
assert.ok(cursors.some((x) => x.value === 'CURSOR_NEXT_1234567890'));

const postData = new URLSearchParams({
  doc_id: '123456',
  variables: JSON.stringify({ query: 'ฮายอง', cursor: null, count: 30 })
}).toString();
const shape = requestCursorShape(postData, 'application/x-www-form-urlencoded');
assert.equal(shape.replayable, true);
assert.ok(shape.cursorPaths.includes('cursor'));
const replay = buildReplayBody(postData, 'application/x-www-form-urlencoded', 'CURSOR_NEXT_1234567890');
assert.ok(replay);
const replayParams = new URLSearchParams(replay.body);
assert.equal(JSON.parse(replayParams.get('variables')).cursor, 'CURSOR_NEXT_1234567890');

const prefixed = `for (;;);${JSON.stringify(payload)}`;
assert.equal(parseFacebookPayload(prefixed).length, 1);
console.log(JSON.stringify({ ok: true, rows: rows.length, cursors: cursors.length, replay_cursor_path: replay.cursorPath }, null, 2));
