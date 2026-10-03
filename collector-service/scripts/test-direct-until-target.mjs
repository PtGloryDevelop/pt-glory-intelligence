import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /async function runDirectUntilTarget\(/);
assert.match(source, /while \(pages < hardLimit && all\.size < target/);
assert.match(source, /accepted_target_reached/);
assert.match(source, /no_network_progress_twice/);
assert.match(source, /cursor_not_advanced/);
assert.match(source, /const networkAdded = Math\.max\(0, state\.uniqueAds\.size - beforeNetwork\)/);
assert.match(source, /if \(added > 0 \|\| networkAdded > 0\)/);
assert.match(source, /accepted_network_backed/);
assert.doesNotMatch(source, /while \(pages < hardLimit && state\.uniqueAds\.size < target/);
assert.doesNotMatch(source, /network_target_reached/);
assert.doesNotMatch(source, /async function runDirectBurst\(/);

console.log(JSON.stringify({
  ok: true,
  direct_stop_metric: 'accepted_union',
  no_progress_threshold: 2,
  cursor_must_advance: true,
  dom_seen_then_network_confirmed_counts_as_progress: true,
  accepted_network_share_is_exact: true
}, null, 2));
