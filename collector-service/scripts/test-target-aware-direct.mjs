import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /target_mode: 'accepted_union'/);
assert.match(source, /directStartAccepted/);
assert.match(source, /directStartNetwork/);
assert.match(source, /targetAwareStops/);
assert.match(source, /if \(all\.size < target && networkState\.replayTemplate && networkState\.lastCursor\)/);
assert.match(source, /state\.directStopReason = 'accepted_target_reached'/);
assert.match(source, /Target-aware Direct:/);
assert.doesNotMatch(source, /state\.uniqueAds\.size >= target \? 'network_target_reached'/);

const directStart = source.indexOf('async function runDirectUntilTarget');
const directEnd = source.indexOf('\nexport async function collectAds', directStart);
assert.ok(directStart >= 0 && directEnd > directStart, 'direct loop missing');
const direct = source.slice(directStart, directEnd);
assert.match(direct, /all\.size >= target/);
assert.match(direct, /all\.size < target/);
assert.doesNotMatch(direct, /state\.uniqueAds\.size < target/);
assert.doesNotMatch(direct, /state\.uniqueAds\.size >= target/);

console.log(JSON.stringify({
  ok: true,
  target_metric: 'accepted_union',
  unnecessary_network_target_removed: true,
  late_template_reentry_preserved: true
}, null, 2));
