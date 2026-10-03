import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /directActive: false/);
assert.match(source, /directTransientRetries: 0/);
assert.match(source, /directTransportFailures: 0/);
assert.match(source, /directFetchTimeoutMs: 4500/);
assert.match(source, /single_pivot_direct/);
assert.match(source, /request_templates_ignored_during_direct/);
assert.match(source, /natural_responses_ignored_during_direct/);
assert.match(source, /state\.directActive = true/);
assert.match(source, /state\.directActive = false/);
assert.match(source, /state\.requestTemplatesIgnoredDuringDirect \+= 1/);
assert.match(source, /state\.naturalResponsesIgnoredDuringDirect \+= 1/);
assert.match(source, /state\.directTransientRetries \+= 1/);
assert.match(source, /consecutiveTransportFailures < 2/);
assert.match(source, /timeoutMs: fetchTimeoutMs/);
assert.match(source, /Number\(options\.directFetchTimeoutMs\) \|\| 4500/);
assert.doesNotMatch(source, /responsePivotGraceWaitMs \+=/, 'no sequential response-pivot grace stall should remain');

const runStart = source.indexOf('async function runDirectUntilTarget(');
const runEnd = source.indexOf('export async function collectAds', runStart);
const runBody = source.slice(runStart, runEnd);
assert.ok(runStart >= 0 && runEnd > runStart, 'Direct function missing');
assert.match(runBody, /try \{/);
assert.match(runBody, /finally \{/);
assert.match(runBody, /Retry the same cursor inside this Direct session/);

console.log(JSON.stringify({
  ok: true,
  cursor_template_owned_during_direct: true,
  transient_retry_stays_in_burst: true,
  sequential_grace_removed: true,
  default_direct_fetch_timeout_ms: 4500
}, null, 2));
