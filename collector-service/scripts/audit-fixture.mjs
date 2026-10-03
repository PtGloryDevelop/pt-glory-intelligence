import fs from 'node:fs';
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run audit:fixture -- /path/to/export.json');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = data.records || [];
const uniqueAds = new Set(rows.map((r) => r.ad_archive_id).filter(Boolean));
const pages = new Set(rows.map((r) => r.page_identity_key).filter(Boolean));
const formats = rows.reduce((acc, row) => ((acc[row.display_format || 'UNKNOWN'] = (acc[row.display_format || 'UNKNOWN'] || 0) + 1), acc), {});
console.log(JSON.stringify({ schema:data.schema, records:rows.length, unique_ads:uniqueAds.size, pages:pages.size, formats }, null, 2));
