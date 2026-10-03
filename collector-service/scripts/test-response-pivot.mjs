import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /function signalReplayReady\(/);
assert.match(source, /replayReadyWaiters: new Set\(\)/);
assert.match(source, /signalReplayReady\(state, 'pagination_response'\)/);
assert.match(source, /responsePivotWakeups/);
assert.match(source, /responsePivotGraceWaitMs/);
assert.doesNotMatch(source, /responsePivotGraceWaitMs \+=/, 'v0.2.13 must not add a sequential grace stall');
assert.match(source, /matchedPaginationResponses/);
assert.match(source, /fastDomBootstrapScans/);
assert.match(source, /response_pivot_wakeups/);
assert.match(source, /fast_dom_bootstrap_scans/);
assert.match(source, /effectiveEngine = 'network_dominant_response_pivot'/);

const waitStart = source.indexOf('async function waitForReplayReady(');
const waitEnd = source.indexOf('async function waitForPaginationSurface', waitStart);
const waitBody = source.slice(waitStart, waitEnd);
assert.match(waitBody, /new Promise/);
assert.match(waitBody, /replayReadyWaiters\.add/);
assert.match(waitBody, /setTimeout/);
assert.doesNotMatch(waitBody, /while\s*\(/, 'waitForReplayReady should not poll');

const fastPath = Math.max(source.indexOf('// v0.2.14 long-run fast response path'), source.indexOf('// v0.2.13 single-pivot response path'));
const fastDom = source.indexOf('fastDomBootstrapScans += 1', fastPath);
const earlyDirect = source.indexOf('const earlyDirect = await runDirectUntilTarget', fastPath);
const bootstrap = source.indexOf('const remainingBootstrapScrolls', fastPath);
assert.ok(fastPath >= 0 && fastDom > fastPath && earlyDirect > fastDom && bootstrap > earlyDirect, 'response-driven fast path order missing');

console.log(JSON.stringify({
  ok: true,
  response_signal: true,
  polling_removed: true,
  fast_dom_during_response_wait: true,
  sequential_grace_removed: true,
  engine: 'network_dominant_response_pivot'
}, null, 2));
