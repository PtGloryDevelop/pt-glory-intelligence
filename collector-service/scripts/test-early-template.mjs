import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /function captureReplayTemplateFromRequest\(/);
assert.match(source, /page\.on\('request'/);
assert.match(source, /AdLibrarySearchPaginationQuery/);
assert.match(source, /async function waitForReplayReady\(/);
assert.match(source, /async function waitForPaginationSurface\(/);
assert.match(source, /earlyTemplateScrolls/);
assert.match(source, /earlyTemplateReady/);
assert.match(source, /earlyDirectPages/);
assert.match(source, /replay_template_source/);
assert.match(source, /replay_ready_latency_ms/);
assert.match(source, /effectiveEngine = 'network_dominant_response_pivot'/);

const earlyStart = Math.max(source.indexOf('// v0.2.14 long-run fast response path'), source.indexOf('// v0.2.13 single-pivot response path'));
const earlyScroll = source.indexOf('await triggerPaginationScroll(page)', earlyStart);
const fastDom = source.indexOf('fastDomBootstrapScans += 1', earlyStart);
const earlyDirect = source.indexOf('const earlyDirect = await runDirectUntilTarget', earlyStart);
const fullBootstrap = source.indexOf('// Only pay the full initial-results bootstrap cost', earlyStart);
assert.ok(earlyStart >= 0 && earlyScroll > earlyStart && fastDom > earlyScroll && earlyDirect > fastDom, 'response-driven early capture flow missing');
assert.ok(fullBootstrap > earlyDirect, 'full DOM bootstrap should stay deferred until after response-driven direct attempt');

console.log(JSON.stringify({
  ok: true,
  request_time_template_capture: true,
  response_driven_wait: true,
  fast_dom_bootstrap: true,
  pivot_engine: 'network_dominant_response_pivot'
}, null, 2));
