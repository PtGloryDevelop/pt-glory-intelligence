// Builds the data the label review page reads (Ticket 1 of the rival ad labels spec) from a probe
// folder written by scripts/probe-ad-labels.mjs: the ads with review-size pictures, the lists with
// the same definitions AI was given, and each model's labels once results.json exists.
//   node --experimental-strip-types scripts/build-label-review.mjs --probe <probe dir> --out <review dir>
// The page itself (index.html) lives in the review folder and is not touched.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {ANGLES, ANGLE_NOTES, CLAIMS, CLAIM_NOTES, HOOKS, HOOK_NOTES, LABELS_VERSION, SOURCES} from '../lib/ai/labels-shared.ts';

const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const probe = arg('probe'), out = arg('out');
if (!probe || !out) throw Error('--probe and --out are required');
mkdirSync(join(out, 'img'), {recursive: true});
const sample = JSON.parse(readFileSync(join(probe, 'sample.json'), 'utf8'));

const small = async (from, to, width) => writeFileSync(join(out, 'img', to), await sharp(readFileSync(join(probe, 'img', from))).resize({width, withoutEnlargement: true}).jpeg({quality: 72}).toBuffer());
for (const item of sample) {
  await small(`${item.n}-cover.jpg`, `${item.n}-cover.jpg`, 520);
  for (let k = 0; k < item.frames; k++) await small(`${item.n}-f${k}.jpg`, `${item.n}-f${k}.jpg`, 220);
}
writeFileSync(join(out, 'ads.json'), JSON.stringify(sample.map(item => ({
  n: item.n, unit: item.unit, kind: item.kind, format: item.format, page: item.page_name ?? item.page_id, adId: item.ad_archive_id,
  copy: item.copy, frames: item.frames, hookSpeech: item.hookSpeech ?? null,
}))));
const listed = (labels, notes) => Object.entries(labels).map(([code, label]) => ({code, label, note: notes[code] ?? ''}));
writeFileSync(join(out, 'taxonomy.json'), JSON.stringify({version: LABELS_VERSION, hooks: listed(HOOKS, HOOK_NOTES), angles: listed(ANGLES, ANGLE_NOTES), claims: listed(CLAIMS, CLAIM_NOTES), sources: SOURCES}));

const NAMES = {'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5'};
let labels = {pending: true};
if (existsSync(join(probe, 'results.json'))) {
  const results = JSON.parse(readFileSync(join(probe, 'results.json'), 'utf8'));
  const withProof = (items, proofs) => items.map((item, index) => ({...item, proof: proofs[index]}));
  labels = {pending: false, models: Object.keys(results.models).map(id => ({id, name: NAMES[id] ?? id})), ads: Object.fromEntries(sample.map(item => [item.n,
    Object.fromEntries(Object.entries(results.models).map(([model, rows]) => {
      const row = rows[item.n];
      return [model, !row?.labels ? {error: row?.error ?? 'missing'} : {
        hook: {...row.labels.hook, proof: row.proof.hook}, angles: withProof(row.labels.angles, row.proof.angles),
        pains: withProof(row.labels.pains, row.proof.pains), claims: withProof(row.labels.claims, row.proof.claims),
      }];
    }))]))};
}
writeFileSync(join(out, 'labels.json'), JSON.stringify(labels));
console.log(`ads ${sample.length} · labels ${labels.pending ? 'pending' : 'ready'} · pictures in ${join(out, 'img')}`);
