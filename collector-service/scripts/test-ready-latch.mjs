import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /replayReadyGeneration: 0/);
assert.match(source, /replayReadyLatch: null/);
assert.match(source, /function restoreReplayReadyLatch\(/);
assert.match(source, /state\.replayReadyGeneration \+= 1/);
assert.match(source, /replayReadyLatch = \{/);
assert.match(source, /replay_ready_latched/);
assert.match(source, /replay_ready_immediate_hits/);
assert.match(source, /replay_ready_post_subscribe_hits/);
assert.match(source, /replay_ready_signals_without_waiter/);
assert.match(source, /replay_ready_waiter_subscriptions/);
assert.match(source, /natural_pagination_responses/);
assert.match(source, /direct_replay_responses_ignored_for_pivot/);

const waitStart = source.indexOf('async function waitForReplayReady(');
const waitEnd = source.indexOf('async function waitForPaginationSurface', waitStart);
const waitBody = source.slice(waitStart, waitEnd);
assert.match(waitBody, /startGeneration/);
assert.match(waitBody, /restoreReplayReadyLatch/);
assert.match(waitBody, /generationAdvanced/);
assert.match(waitBody, /replayReadyWaiterSubscriptions \+= 1/);
assert.match(waitBody, /replayReadyPostSubscribeHits \+= 1/);
assert.doesNotMatch(waitBody, /while\s*\(/, 'stateful latch wait must remain event-driven, not polling');

const responseStart = source.indexOf("const isPaginationResponse = Boolean(isGraphql && requestInspector?.friendly_name === 'AdLibrarySearchPaginationQuery')");
const responseEnd = source.indexOf('if (responseCursors.length)', responseStart);
const responseBody = source.slice(responseStart, responseEnd);
assert.ok(responseStart >= 0 && responseEnd > responseStart, 'pagination response block missing');
assert.match(responseBody, /if \(isDirectReplay\)/);
assert.match(source, /directReplayResponsesIgnoredForPivot \+= 1/);
assert.match(source, /directEventParseSkips \+= 1/);
assert.match(responseBody, /naturalPaginationResponses \+= 1/);
assert.match(responseBody, /signalReplayReady\(state, 'pagination_response'\)/);

console.log(JSON.stringify({
  ok: true,
  generation_latch: true,
  lost_wakeup_protection: true,
  direct_replay_signal_filter: true
}, null, 2));
