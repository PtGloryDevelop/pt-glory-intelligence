import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPaginationState } from '../src/network-extractor.mjs';

const terminal = { data: { ad_library_main: { search_results_connection: { page_info: { end_cursor: null, has_next_page: false } } } } };
const open = { data: { ad_library_main: { search_results_connection: { page_info: { end_cursor: 'CURSOR-12345678', has_next_page: true } } } } };
assert.equal(findPaginationState(terminal)[0]?.has_next_page, false);
assert.equal(findPaginationState(terminal)[0]?.end_cursor, null);
assert.equal(findPaginationState(open)[0]?.has_next_page, true);
assert.equal(findPaginationState(open)[0]?.end_cursor, 'CURSOR-12345678');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'collector.mjs'), 'utf8');
assert.match(source, /directEventParseSkips/);
assert.match(source, /verifyLongRunPagination/);
assert.match(source, /source_exhausted_signal/);
assert.match(source, /cursor_cycle_detected/);
assert.match(source, /duplicate_page_cycle/);
assert.match(source, /maxLongRunContinuationEpochs/);
assert.match(source, /target >= 500 \? 8/);
console.log('long-run pagination: PASS');
