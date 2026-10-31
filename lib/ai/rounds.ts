import 'server-only';
import {dbUser} from '../db/user.ts';
import {adRefId, type AdContext, type AdRef, type AdsRun, type AiRun, type SetReading, type TeamView} from './compare-shared.ts';
import {runComparison, withinBudget} from './compare.ts';
import {AiError, MODEL, callDeepSeek, estimateUsd, type Message} from './deepseek.ts';
import {cleanNote, readAnswer, readNoteDraft, type NoteDraft, type NoteItem} from './rounds-shared.ts';
import {CHAT_PROMPT, NOTE_PROMPT} from './round-prompts.ts';
export type {NoteDraft, NoteItem} from './rounds-shared.ts';

/**
 * Compare rounds (team feedback, 31 Oct): talk to AI about a compared pair, and keep every round.
 *
 * A round holds the ads as the model was shown them (their order is the evidence numbering), the summary
 * it was based on, the questions and answers, and the team's note. Answers are AI interpretation; the only
 * facts the model is given are the ones the comparison already shows (our ad's Meta numbers, the rival's
 * status and days running), and it is told it has nothing else.
 */
export type RoundMessage = {id: string; role: 'user' | 'assistant'; content: string; ads: number[]; createdAt: string};
export type Round = {
  id: string; number: number; view: TeamView; ads: AdContext[]; adKey: string; unitName: string | null; summary: SetReading;
  title: string | null; noteSeen: string | null; noteNext: NoteItem[]; notedAt: string | null;
  createdByName: string | null; createdAt: string; messages: RoundMessage[];
};
export type RoundRow = Omit<Round, 'messages' | 'summary'> & {questions: number};

const COLUMNS = 'id,number,view,ads,ad_key,unit_name,summary,title,note_seen,note_next,noted_at,created_by_name,created_at';
type Row = {id: string; number: number | string; view: TeamView; ads: AdContext[]; ad_key: string; unit_name: string | null; summary: SetReading;
  title: string | null; note_seen: string | null; note_next: NoteItem[] | null; noted_at: string | null; created_by_name: string | null; created_at: string};
const fromRow = (row: Row) => ({
  id: row.id, number: Number(row.number), view: row.view, ads: row.ads, adKey: row.ad_key, unitName: row.unit_name, summary: row.summary,
  title: row.title, noteSeen: row.note_seen, noteNext: row.note_next ?? [], notedAt: row.noted_at, createdByName: row.created_by_name, createdAt: row.created_at,
});

// A question with the round's context is ~3k tokens in, a short answer ~0.6k out; a note draft about the same.
const EST_ASK = [3500, 700] as const, EST_NOTE = [3500, 600] as const;
const MAX_OUTPUT = 1500;
const HISTORY = 12;

/** The pair's readings, from the cache when the comparison has already run (it usually has: it runs on open). */
async function context(refs: AdRef[], view: TeamView) {
  const run = await runComparison(refs, false, view) as AiRun | AdsRun;
  const ads = run.context ?? [];
  return {ads, readings: ads.map(ad => run.ads[ad.id]), summary: run.summary};
}

async function authorName(db: Awaited<ReturnType<typeof dbUser>>): Promise<string | null> {
  const {data} = await db.auth.getUser();
  const user = data.user;
  const name = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
  return (name || user?.email?.split('@')[0] || '').slice(0, 120) || null;
}

/** A new round on a pair, from the summary on screen. Costs nothing when the comparison has run. */
export async function createRound(refs: AdRef[], view: TeamView, unitName: string | null): Promise<Round> {
  const db = await dbUser();
  const ctx = await context(refs, view);
  const {data, error} = await db.from('compare_rounds').insert({
    view, ads: ctx.ads, ad_key: refs.map(adRefId).join('|'), unit_name: unitName?.trim().slice(0, 120) || null,
    summary: ctx.summary, created_by_name: await authorName(db),
  }).select(COLUMNS).single();
  if (error || !data) throw new AiError('เริ่มรอบใหม่ไม่สำเร็จ', 503);
  return {...fromRow(data as Row), messages: []};
}

export async function getRound(id: string): Promise<Round | null> {
  const db = await dbUser();
  const [round, messages] = await Promise.all([
    db.from('compare_rounds').select(COLUMNS).eq('id', id).maybeSingle(),
    db.from('compare_messages').select('id,role,content,ads,created_at').eq('round_id', id).in('role', ['user', 'assistant']).order('created_at'),
  ]);
  if (round.error || messages.error) throw new AiError('เปิดรอบนี้ไม่สำเร็จ', 503);
  if (!round.data) return null;
  return {...fromRow(round.data as Row), messages: (messages.data ?? []).map(row => ({
    id: row.id, role: row.role as RoundMessage['role'], content: row.content, ads: (row.ads ?? []) as number[], createdAt: row.created_at,
  }))};
}

/** The team's rounds, newest first, with how many questions each had. */
export async function listRounds(filter: {unit?: string; noted?: boolean; mine?: boolean} = {}): Promise<RoundRow[]> {
  const db = await dbUser();
  let query = db.from('compare_rounds').select(`${COLUMNS},compare_messages(count)`).eq('compare_messages.role', 'user')
    .order('created_at', {ascending: false}).limit(200);
  if (filter.unit) query = query.eq('unit_name', filter.unit);
  if (filter.noted) query = query.not('noted_at', 'is', null);
  if (filter.mine) {
    const {data} = await db.auth.getUser();
    if (data.user) query = query.eq('created_by', data.user.id);
  }
  const {data, error} = await query;
  if (error) throw new AiError('เปิดประวัติการเทียบไม่สำเร็จ', 503);
  return (data ?? []).map(row => {
    const round: Partial<ReturnType<typeof fromRow>> = fromRow(row as unknown as Row);
    delete round.summary; // the list does not carry each round's summary
    const counted = (row as unknown as {compare_messages?: {count: number}[]}).compare_messages;
    return {...round as Omit<ReturnType<typeof fromRow>, 'summary'>, questions: counted?.[0]?.count ?? 0};
  });
}

/** What the model is shown about the round: the same facts and readings the comparison shows, nothing else. */
async function roundInput(round: Round) {
  const refs = round.ads.map(ad => ad.ref);
  const ctx = await context(refs, round.view);
  return {
    ads: round.ads.map((ad, index) => ({index, side: ad.side, name: ad.label, facts: ad.facts, reading: ctx.readings[index] ?? null})),
    summary: round.summary,
  };
}

async function record(roundId: string, rows: {role: 'user' | 'assistant' | 'note'; content: string; ads?: number[]; call?: {input: number; output: number; usd: number}}[]) {
  const db = await dbUser();
  const {data, error} = await db.from('compare_messages').insert(rows.map(row => ({
    round_id: roundId, role: row.role, content: row.content, ads: row.ads ?? [],
    model: row.call ? MODEL : null, input_tokens: row.call?.input ?? 0, output_tokens: row.call?.output ?? 0, usd: (row.call?.usd ?? 0).toFixed(6),
  }))).select('id,role,content,ads,created_at');
  if (error) throw new AiError('บันทึกบทสนทนาไม่สำเร็จ', 503);
  return (data ?? []).map(row => ({id: row.id, role: row.role, content: row.content, ads: (row.ads ?? []) as number[], createdAt: row.created_at}));
}

/** One question in a round: the answer, with the ads it cites, both kept. Within the shared AI caps. */
export async function ask(roundId: string, question: string): Promise<RoundMessage[]> {
  const round = await getRound(roundId);
  if (!round) throw new AiError('ไม่พบรอบนี้', 404);
  await withinBudget(estimateUsd(...EST_ASK));
  const input = await roundInput(round);
  const history: Message[] = round.messages.slice(-HISTORY).map(message => ({
    role: message.role, content: message.role === 'assistant' ? JSON.stringify({answer: message.content, ads: message.ads}) : message.content,
  }));
  const call = await callDeepSeek([
    {role: 'system', content: CHAT_PROMPT},
    {role: 'user', content: `ข้อมูลของรอบนี้:\n${JSON.stringify(input)}`},
    {role: 'assistant', content: JSON.stringify({answer: 'รับทราบ ถามเรื่องแอดชุดนี้ได้เลย', ads: []})},
    ...history,
    {role: 'user', content: question},
  ], MAX_OUTPUT);
  const answer = readAnswer(call.result, round.ads.length);
  if (!answer) throw new AiError('AI ตอบไม่ครบตามรูปแบบ ลองถามใหม่อีกครั้ง', 502);
  const saved = await record(round.id, [
    {role: 'user', content: question},
    {role: 'assistant', content: answer.answer, ads: answer.ads, call},
  ]);
  return saved as RoundMessage[];
}

/** AI's draft of the round's note, from the summary and the talk. Kept only as a cost record until saved. */
export async function draftNote(roundId: string): Promise<NoteDraft> {
  const round = await getRound(roundId);
  if (!round) throw new AiError('ไม่พบรอบนี้', 404);
  await withinBudget(estimateUsd(...EST_NOTE));
  const input = await roundInput(round);
  const talk = round.messages.slice(-20).map(message => ({from: message.role === 'user' ? 'ทีม' : 'AI', text: message.content}));
  const call = await callDeepSeek([
    {role: 'system', content: NOTE_PROMPT},
    {role: 'user', content: JSON.stringify({...input, talk})},
  ], MAX_OUTPUT);
  const draft = readNoteDraft(call.result);
  if (!draft) throw new AiError('AI ร่างสรุปไม่ครบ ลองใหม่อีกครั้ง', 502);
  await record(round.id, [{role: 'note', content: JSON.stringify(draft), call}]);
  return draft;
}

/** The team's note on the round, as edited. Anyone on the team may write it; the last save stands. */
export async function saveNote(roundId: string, raw: unknown): Promise<Round> {
  const note = cleanNote(raw);
  if (!note) throw new AiError('ข้อมูลสรุปไม่ถูกต้อง', 400);
  const db = await dbUser();
  const {data: user} = await db.auth.getUser();
  const {error} = await db.from('compare_rounds').update({
    title: note.title, note_seen: note.seen, note_next: note.next, noted_at: new Date().toISOString(), noted_by: user.user?.id ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', roundId);
  if (error) throw new AiError('บันทึกสรุปไม่สำเร็จ', 503);
  const round = await getRound(roundId);
  if (!round) throw new AiError('ไม่พบรอบนี้', 404);
  return round;
}
