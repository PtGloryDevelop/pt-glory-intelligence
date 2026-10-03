import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /effectiveEngine = 'network_dominant_reentry'/);
assert.match(source, /lateTemplateReentries/);
assert.match(source, /lateTemplateReentryPages/);
assert.match(source, /Fast GraphQL pivot after scroll/);
assert.match(source, /await waitForReplayReady\(networkState,[\s\S]{0,500}await drainNetwork\(networkState, 200\);[\s\S]{0,2600}networkState\.replayTemplate && networkState\.lastCursor[\s\S]{0,1800}runDirectUntilTarget/);

const fallbackStart = source.indexOf("effectiveEngine = 'network_dominant_dom_fallback'");
assert.ok(fallbackStart >= 0, 'fallback block missing');
const fallback = source.slice(fallbackStart, fallbackStart + 10000);
const precheck = fallback.indexOf('networkState.replayTemplate && networkState.lastCursor');
const firstScroll = fallback.indexOf('await rapidScroll(page)');
const firstDomScan = fallback.indexOf('snapshot = await domSnapshot(page)');
assert.ok(precheck >= 0 && firstScroll >= 0 && firstDomScan >= 0, 'fallback stages missing');
assert.ok(precheck < firstScroll, 're-entry must be checked before fallback scroll');
assert.ok(firstScroll < firstDomScan, 'network probe must happen before DOM scan');

console.log(JSON.stringify({
  ok: true,
  checks: ['pre_scroll_reentry', 'post_scroll_reentry', 'network_before_dom_scan'],
  pivot_engine: 'network_dominant_reentry',
  dom_fallback_preserved: true
}, null, 2));
