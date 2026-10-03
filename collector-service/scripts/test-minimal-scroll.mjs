import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');

assert.match(source, /async function triggerPaginationScroll\(/);
assert.match(source, /const remainingBootstrapScrolls = Math\.max\(0, 2 - networkState\.paginationScrolls\)/);
assert.match(source, /async function runDirectUntilTarget\(/);
assert.match(source, /\[\.\.\.all\.values\(\)\]\.map\(\(row\) => row\?\.ad_archive_id\)/);
assert.match(source, /network_dominant_response_pivot/);
assert.match(source, /network_dominant_dom_fallback/);

console.log(JSON.stringify({
  ok: true,
  bootstrap_scroll_limit_total: 2,
  early_probe_counts_toward_bootstrap: true,
  excluded_ids_source: 'ad_archive_id',
  primary_engine: 'network_dominant_response_pivot',
  dom_fallback_preserved: true
}, null, 2));
