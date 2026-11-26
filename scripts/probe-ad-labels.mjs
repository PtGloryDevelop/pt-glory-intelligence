// Ticket 1 of docs/superpowers/specs/2026-11-26-rival-ad-labels.md, the gate: label a sample of rival
// creatives with each Claude model through the Message Batches API, so the team can check the labels
// and the lists before anything else is built. Three steps, each resumable from the files in --out:
//   node --conditions=react-server --experimental-strip-types --env-file=.env.local scripts/probe-ad-labels.mjs --out <dir> --prepare
//   ... --out <dir> --submit     creates one batch per model: this is the step that costs money
//   ... --out <dir> --collect    asks once; writes results.json when every batch has ended
// --prepare reads the pilot data and the stored pictures, and hears the first 5 seconds of a read clip
// with gpt-transcribe (kept in ai_analyses exactly as Compare keeps it, so it is paid for once).
// Nothing else is written to the database: the labels go to results.json only.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import {attemptUsd} from '../lib/ai/anthropic.ts';
import {LABEL_FORMAT, LABEL_PROMPT, LABELS_VERSION, creativeKey, labelText, proofOf, readLabels} from '../lib/ai/labels-shared.ts';
import {TRANSCRIBE_MODEL, transcribeAudio} from '../lib/ai/openai.ts';
import {transcriptKey} from '../lib/ai/video-input.ts';
import {closePool, withTransaction} from '../lib/db/privileged.ts';
import {supabaseArchiveStore, videoDownloader} from '../lib/media/store-supabase.ts';

const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const has = name => process.argv.includes(`--${name}`);
const out = arg('out');
if (!out || !(has('prepare') || has('submit') || has('collect'))) throw Error('--out <dir> and one of --prepare, --submit, --collect are required');
mkdirSync(join(out, 'img'), {recursive: true});
const file = name => join(out, name);
const load = name => JSON.parse(readFileSync(file(name), 'utf8'));
const save = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 1));

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
// Six creatives from each unit with enough confirmed rival ads, what there is from the small ones: 60 in all.
const PER_UNIT = 6, SMALL_UNITS = {U18: 3, U14: 2, U8: 1}, FRAMES = 3, COVER_PX = 768;
const query = (sql, params = []) => withTransaction(client => client.query(sql, params)).then(result => result.rows);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function prepare() {
  // The latest observation of every ad on a page the team confirmed as a unit's rival, one row per distinct creative.
  const rows = await query(`
    with latest as (
      select distinct on (o.ad_ref) o.id obs_id, o.display_format, coalesce(o.title, '') title, coalesce(o.body_text, '') body, a.ad_archive_id, p.page_id, p.id page_ref
        from public.ad_observations o join public.ads a on a.id = o.ad_ref join public.pages p on p.id = a.page_ref
       order by o.ad_ref, o.observed_at desc),
    confirmed as (select page_id, min(unit_name) unit_name from public.rival_page_units where relation in ('direct', 'substitute') group by 1),
    candidates as (
      select l.*, c.unit_name, m.storage_path, m.sha256 cover_sha, r.frames, r.has_audio, r.hook_audio_path, r.hook_audio_sha256,
             (select po.page_name from public.page_observations po where po.page_ref = l.page_ref order by po.observed_at desc limit 1) page_name,
             row_number() over (partition by md5(l.title || E'\\n' || l.body), m.sha256 order by l.obs_id) copy_of
        from latest l join confirmed c using (page_id)
        join lateral (select m.storage_path, m.sha256 from public.media_assets m
                       where m.ad_observation_id = l.obs_id and m.archive_status = 'archived' order by m.created_at limit 1) m on true
        left join public.ad_video_readings r on r.ad_observation_id = l.obs_id and r.status = 'ready')
    select *, case when frames is not null then 'clip' when display_format = 'VIDEO' then 'video' else 'image' end kind,
           md5(obs_id::text) pick from candidates where copy_of = 1 order by unit_name, pick`);
  const chosen = [];
  for (const unit of [...new Set(rows.map(row => row.unit_name))]) {
    // A unit whose rivals reuse a few creatives across many ads gives what it has.
    const pool = rows.filter(row => row.unit_name === unit), quota = Math.min(SMALL_UNITS[unit] ?? PER_UNIT, pool.length);
    // Two of each kind where the unit has them, then whatever comes next in the fixed order.
    const picked = ['clip', 'video', 'image'].flatMap(kind => pool.filter(row => row.kind === kind).slice(0, Math.ceil(quota / 3)));
    for (const row of pool) if (picked.length < quota && !picked.includes(row)) picked.push(row);
    chosen.push(...picked.slice(0, quota));
  }
  const urls = await supabaseArchiveStore().getPresentationUrls(chosen.map(row => row.storage_path));
  const download = videoDownloader();
  const sample = [];
  let heardUsd = 0;
  for (const [n, row] of chosen.entries()) {
    const stored = Buffer.from(await (await fetch(urls.get(row.storage_path))).arrayBuffer());
    const cover = await sharp(stored).resize({width: COVER_PX, height: COVER_PX, fit: 'inside', withoutEnlargement: true}).jpeg({quality: 80}).toBuffer();
    writeFileSync(file(`img/${n}-cover.jpg`), cover);
    const pictures = [sha(cover)];
    let frames = 0, hookSpeech, hookAudio = null;
    if (row.kind === 'clip') {
      for (const [k, frame] of row.frames.slice(0, FRAMES).entries()) {
        const bytes = await download(frame.path);
        writeFileSync(file(`img/${n}-f${k}.jpg`), bytes); pictures.push(sha(bytes)); frames += 1;
      }
      if (row.has_audio && row.hook_audio_path && row.hook_audio_sha256) {
        const key = transcriptKey(String(row.obs_id), 'hook', row.hook_audio_sha256);
        const [kept] = await query(`select result->>'text' text from public.ai_analyses where key = $1`, [key]);
        if (kept) hookSpeech = kept.text ?? '';
        else {
          const heard = await transcribeAudio(await download(row.hook_audio_path));
          heardUsd += heard.usd; hookSpeech = heard.text;
          await query(`insert into public.ai_analyses (key, kind, model, result, input_tokens, output_tokens, usd) values ($1, 'transcript', $2, $3::jsonb, 0, 0, $4)
            on conflict (key) do nothing`, [key, TRANSCRIBE_MODEL, JSON.stringify({text: heard.text, seconds: heard.seconds}), heard.usd.toFixed(6)]);
        }
        hookAudio = row.hook_audio_sha256;
      }
    }
    const copy = `${row.title}\n${row.body}`.trim();
    sample.push({n, unit: row.unit_name, kind: row.kind, format: row.display_format, page_id: row.page_id, page_name: row.page_name, ad_archive_id: row.ad_archive_id,
      obs_id: String(row.obs_id), copy, frames, hookSpeech, key: creativeKey({copy, pictures, hookAudio})});
  }
  save('sample.json', sample);
  const by = key => Object.entries(Object.groupBy(sample, item => item[key])).map(([name, items]) => `${name} ${items.length}`).join(' · ');
  console.log(`sample: ${sample.length} creatives · ${by('unit')}`);
  console.log(`kinds: ${by('kind')} · opening speech heard now for USD ${heardUsd.toFixed(4)} (OpenAI)`);
}

const image = path => ({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: readFileSync(path).toString('base64')}});
/** Exactly what one creative's call carries; the server will build the same in Ticket 3. */
function contentOf(item) {
  const pictures = [image(file(`img/${item.n}-cover.jpg`)), ...Array.from({length: item.frames}, (_, k) => image(file(`img/${item.n}-f${k}.jpg`)))];
  return [{type: 'text', text: labelText({format: item.format, copy: item.copy, hookSpeech: item.hookSpeech, frames: item.frames || undefined})}, ...pictures];
}

async function submit() {
  if (existsSync(file('batches.json'))) throw Error('batches.json exists: these batches were already submitted (use --collect)');
  const sample = load('sample.json'), client = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
  const batches = [];
  for (const model of MODELS) {
    const batch = await client.messages.batches.create({requests: sample.map(item => ({
      custom_id: `ad-${item.n}`,
      params: {model, max_tokens: 4000, system: LABEL_PROMPT, messages: [{role: 'user', content: contentOf(item)}],
        output_config: {effort: 'low', format: {type: 'json_schema', schema: LABEL_FORMAT.schema}}},
    }))});
    batches.push({model, id: batch.id, created_at: batch.created_at});
    save('batches.json', batches);
    console.log(`submitted ${model}: ${batch.id} (${sample.length} requests)`);
  }
}

async function collect() {
  const sample = load('sample.json'), batches = load('batches.json'), client = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
  const states = await Promise.all(batches.map(batch => client.messages.batches.retrieve(batch.id)));
  for (const [index, state] of states.entries()) console.log(`${batches[index].model}: ${state.processing_status} ${JSON.stringify(state.request_counts)}`);
  if (states.some(state => state.processing_status !== 'ended')) { console.log('NOT ENDED'); return; }
  const results = {version: LABELS_VERSION, models: {}};
  for (const batch of batches) {
    const rows = {};
    for await (const entry of await client.messages.batches.results(batch.id)) {
      const item = sample[Number(entry.custom_id.slice(3))];
      if (entry.result.type !== 'succeeded') { rows[item.n] = {error: entry.result.type}; continue; }
      const message = entry.result.message, usage = message.usage;
      const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('');
      let labels = null;
      try { labels = readLabels(JSON.parse(text)); } catch { /* kept as unreadable below */ }
      const row = {stop: message.stop_reason, input: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output: usage.output_tokens,
        // A batch is billed at half the model's rates.
        usd: attemptUsd(batch.model, usage) / 2, labels, error: labels ? null : message.stop_reason === 'refusal' ? 'refusal' : 'unreadable'};
      if (labels) row.proof = {hook: proofOf(labels.hook, item), angles: labels.angles.map(angle => proofOf(angle, item)),
        pains: labels.pains.map(pain => proofOf(pain, item)), claims: labels.claims.map(claim => proofOf(claim, item))};
      rows[item.n] = row;
    }
    results.models[batch.model] = rows;
  }
  save('results.json', results);
  const table = {};
  for (const [model, rows] of Object.entries(results.models)) {
    const read = Object.values(rows).filter(row => row.labels), proofs = read.flatMap(row => [row.proof.hook, ...row.proof.angles, ...row.proof.pains, ...row.proof.claims]);
    const mean = key => Math.round(read.reduce((sum, row) => sum + row[key], 0) / Math.max(read.length, 1));
    table[model] = {read: `${read.length}/${sample.length}`, avg_in: mean('input'), avg_out: mean('output'), usd: Object.values(rows).reduce((sum, row) => sum + (row.usd ?? 0), 0).toFixed(4),
      quotes: proofs.length, verified: proofs.filter(proof => proof === 'verified').length, from_picture: proofs.filter(proof => proof === 'image').length,
      broken: proofs.filter(proof => proof === 'unverified').length, no_evidence: proofs.filter(proof => proof === 'none').length,
      hook_other: read.filter(row => row.labels.hook.type === 'other').length};
  }
  console.table(table);
  const [haiku, sonnet, opus] = MODELS.map(model => results.models[model]);
  const agree = (a, b) => { const both = sample.filter(item => a[item.n]?.labels && b[item.n]?.labels); return `${both.filter(item => a[item.n].labels.hook.type === b[item.n].labels.hook.type).length}/${both.length}`; };
  console.log(`same opening type: haiku/sonnet ${agree(haiku, sonnet)} · haiku/opus ${agree(haiku, opus)} · sonnet/opus ${agree(sonnet, opus)}`);
  console.log('ENDED');
}

try {
  if (has('prepare')) await prepare();
  if (has('submit')) await submit();
  if (has('collect')) await collect();
} finally { await closePool(); }
