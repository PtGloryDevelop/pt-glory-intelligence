'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { adRefId, type AdRef, type TeamView } from '@/lib/ai/compare-shared';
import type { NoteDraft, NoteItem } from '@/lib/ai/rounds-shared';
import { thaiDateTime } from '@/lib/format/date';
import styles from './round-chat.module.css';

type RoundAd = { id: string; ref: AdRef; side: string; label: string; facts: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; ads: number[]; createdAt: string; pending?: boolean };
type Round = {
  id: string; number: number; view: TeamView; ads: RoundAd[]; adKey: string; unitName: string | null;
  title: string | null; noteSeen: string | null; noteNext: NoteItem[]; notedAt: string | null;
  createdByName: string | null; createdAt: string; messages: Message[];
};
type Draft = { title: string; seen: string; next: { text: string; keep: boolean }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUGGESTIONS = ['แอดเราควรแก้อะไรก่อน', 'ทำไมคู่แข่งยิงแอดนี้ได้นาน', 'เขียนพาดหัวใหม่ให้แอดเรา 3 แบบ ไม่ผิด อย.', 'แอดเรามีคำไหนเสี่ยง อย.'];

async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'ทำรายการไม่สำเร็จ');
  return data as T;
}

/** The round's address, so a refresh or a shared link comes back to the same talk. */
function markRound(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('round', id); else url.searchParams.delete('round');
  window.history.replaceState(null, '', url.pathname + url.search);
}

/**
 * Talk to AI about the pair on screen, and keep the round (team feedback, 31 Oct).
 *
 * A round starts with the first question or note, never by opening a pair. Every answer says which ads it
 * leans on and is marked as AI interpretation; the facts it may use are the ones the comparison shows.
 * "บันทึกสรุปรอบนี้" has AI draft the round's note, which the team edits before keeping it.
 */
export function RoundChat({ ads, view, unitName }: { ads: AdRef[]; view: TeamView; unitName: string | null }) {
  const key = ads.map(adRefId).join('|');
  const asked = useSearchParams().get('round');
  const [round, setRound] = useState<Round | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'ask' | 'draft' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const opened = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // A round named in the address is opened once, if it is about this pair.
  useEffect(() => {
    if (!asked || !UUID.test(asked) || opened.current === asked) return;
    opened.current = asked;
    let live = true;
    call<{ round: Round }>(`/api/compare/rounds/${asked}`).then(({ round: found }) => {
      if (!live) return;
      if (found.adKey !== key) { markRound(null); return; }
      setRound(found); setMessages(found.messages);
    }).catch(() => { if (live) markRound(null); });
    return () => { live = false; };
  }, [asked, key]);

  // Another pair is another round.
  const current = round && round.adKey === key ? round : null;
  const shown = current ? messages : [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [shown.length]);

  async function ensureRound(): Promise<Round> {
    if (current) return current;
    const { round: created } = await call<{ round: Round }>('/api/compare/rounds', { ads, view, unitName });
    setRound(created); setMessages([]); markRound(created.id);
    return created;
  }

  async function send(text: string) {
    const asking = text.trim();
    if (!asking || busy) return;
    setBusy('ask'); setError(''); setQuestion('');
    const pending: Message = { id: 'pending', role: 'user', content: asking, ads: [], createdAt: new Date().toISOString(), pending: true };
    setMessages(list => [...(current ? list : []), pending]);
    try {
      const target = await ensureRound();
      const { messages: added } = await call<{ messages: Message[] }>(`/api/compare/rounds/${target.id}/messages`, { question: asking });
      setMessages(list => [...list.filter(item => !item.pending), ...added]);
    } catch (reason) {
      setMessages(list => list.filter(item => !item.pending));
      setQuestion(asking);
      setError((reason as Error).message);
    } finally { setBusy(null); }
  }

  async function startNote() {
    if (busy) return;
    setBusy('draft'); setError('');
    try {
      const target = await ensureRound();
      // A note already kept is edited as it is; a new one starts from AI's draft.
      if (target.notedAt && target.title && target.noteSeen) {
        setDraft({ title: target.title, seen: target.noteSeen, next: target.noteNext.map(item => ({ text: item.text, keep: true })) });
      } else {
        const { draft: made } = await call<{ draft: NoteDraft }>(`/api/compare/rounds/${target.id}/note`, { action: 'draft' });
        setDraft({ title: made.title, seen: made.seen, next: made.next.map(text => ({ text, keep: true })) });
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(null); }
  }

  async function saveNote(note: { title: string; seen: string; next: NoteItem[] }) {
    if (!current) return;
    setBusy('save'); setError('');
    try {
      const { round: saved } = await call<{ round: Round }>(`/api/compare/rounds/${current.id}/note`, { action: 'save', note });
      setRound(saved); setDraft(null);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(null); }
  }

  const done = (item: NoteItem) => current?.noteNext.find(saved => saved.text === item.text)?.done ?? false;
  const cite = (index: number) => {
    const ad = current?.ads[index];
    if (!ad) return null;
    const own = ad.side === 'แอดของเรา';
    return <span key={index} className={own ? styles.own : styles.rival}>แอด {index + 1} · {own ? 'ของเรา' : ad.label}</span>;
  };

  return <section className={styles.chat} aria-labelledby="round-chat-heading" data-testid="round-chat">
    <div className={styles.bar}>
      <div className={styles.barText}>
        {current ? <>
          <h2 id="round-chat-heading">รอบ #{current.number}</h2>
          <span className={styles.muted}>เริ่ม {thaiDateTime(current.createdAt)}{current.createdByName ? ` · โดย ${current.createdByName}` : ''} · บันทึกอัตโนมัติ</span>
          {current.unitName ? <span className={styles.own}>{current.unitName}</span> : null}
        </> : <>
          <h2 id="round-chat-heading">ถาม AI เรื่องแอดชุดนี้</h2>
          <span className={styles.muted}>เริ่มถามแล้วระบบจะบันทึกเป็นรอบใหม่ให้ทีมเห็นในประวัติ</span>
        </>}
      </div>
      <div className={styles.barActions}>
        <Link href="/compare/rounds" data-testid="round-history">ประวัติทุกรอบ</Link>
        <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => void startNote()} data-testid="round-note-start">
          {busy === 'draft' ? 'AI กำลังร่างสรุป…' : current?.notedAt ? 'แก้สรุปรอบนี้' : 'บันทึกสรุปรอบนี้'}
        </button>
      </div>
    </div>

    {error ? <p className={styles.error} role="alert">{error}</p> : null}

    {draft ? <form className={styles.note} data-testid="round-note-editor" onSubmit={event => {
      event.preventDefault();
      void saveNote({ title: draft.title, seen: draft.seen, next: draft.next.filter(item => item.keep && item.text.trim()).map(item => ({ text: item.text.trim(), done: done({ text: item.text.trim(), done: false }) })) });
    }}>
      <div className={styles.noteHead}><h3>สรุปรอบ #{current?.number}{current?.unitName ? ` · ${current.unitName}` : ''}</h3><span className={styles.ai}>AI ร่าง · แก้ได้</span></div>
      <label>ชื่อรอบ<input value={draft.title} maxLength={200} onChange={event => setDraft({ ...draft, title: event.target.value })} required /></label>
      <label>สิ่งที่เห็น<textarea value={draft.seen} maxLength={2000} onChange={event => setDraft({ ...draft, seen: event.target.value })} required /></label>
      <fieldset className={styles.next}><legend>สิ่งที่จะลองต่อ</legend>
        {draft.next.map((item, index) => <div key={index} className={styles.nextRow}>
          <input type="checkbox" checked={item.keep} aria-label={`เก็บข้อ ${index + 1} ไว้ในสรุป`} onChange={event => setDraft({ ...draft, next: draft.next.map((entry, at) => at === index ? { ...entry, keep: event.target.checked } : entry) })} />
          <input value={item.text} maxLength={300} aria-label={`สิ่งที่จะลองต่อ ข้อ ${index + 1}`} onChange={event => setDraft({ ...draft, next: draft.next.map((entry, at) => at === index ? { ...entry, text: event.target.value } : entry) })} />
        </div>)}
        {draft.next.length < 10 ? <button type="button" className={styles.link} onClick={() => setDraft({ ...draft, next: [...draft.next, { text: '', keep: true }] })}>+ เพิ่มข้อ</button> : null}
      </fieldset>
      <div className={styles.cites}>แอดในรอบนี้ {current?.ads.map((_, index) => cite(index))}</div>
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy !== null}>{busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกสรุป'}</button><button type="button" onClick={() => setDraft(null)}>ยกเลิก</button></div>
    </form> : current?.notedAt ? <div className={styles.saved} data-testid="round-note">
      <div className={styles.noteHead}><h3>{current.title}</h3><span className={styles.muted}>บันทึกเมื่อ {thaiDateTime(current.notedAt)}</span></div>
      <p>{current.noteSeen}</p>
      {current.noteNext.length ? <ul className={styles.todo}>{current.noteNext.map((item, index) => <li key={index}>
        <label><input type="checkbox" checked={item.done} disabled={busy !== null}
          onChange={event => void saveNote({ title: current.title ?? '', seen: current.noteSeen ?? '', next: current.noteNext.map((entry, at) => at === index ? { ...entry, done: event.target.checked } : entry) })} />
          <span className={item.done ? styles.struck : undefined}>{item.text}</span></label>
      </li>)}</ul> : null}
    </div> : null}

    <div className={styles.messages} aria-live="polite">
      {shown.map(message => message.role === 'user'
        ? <p key={message.id} className={styles.me}>{message.content}</p>
        : <div key={message.id} className={styles.bot}>
          <span className={styles.ai}>AI ตีความ</span>
          <p>{message.content}</p>
          {message.ads.length ? <div className={styles.cites}>อ้างอิง {message.ads.map(cite)}</div> : null}
        </div>)}
      {busy === 'ask' ? <p className={styles.muted} role="status">AI กำลังตอบ…</p> : null}
      <div ref={end} />
    </div>

    <div className={styles.suggest}>{SUGGESTIONS.map(text => <button key={text} type="button" disabled={busy !== null} onClick={() => void send(text)}>{text}</button>)}</div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(question); }}>
      <input value={question} maxLength={1000} onChange={event => setQuestion(event.target.value)} placeholder="พิมพ์คำถามเกี่ยวกับแอดชุดนี้…" aria-label="คำถามถึง AI" data-testid="round-question" disabled={busy !== null} />
      <button type="submit" className={styles.primary} disabled={busy !== null || !question.trim()} data-testid="round-send">ส่ง</button>
    </form>
    <p className={styles.muted}>AI รู้เฉพาะแอดในรอบนี้และตัวเลขที่หน้านี้แสดง · ราว 0.001 USD ต่อคำถาม ใช้งบ AI ก้อนเดียวกับการวิเคราะห์</p>
  </section>;
}
