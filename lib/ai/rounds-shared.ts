/** Shapes shared by the compare-round server code and the browser: what AI must answer, and a team note. */

export type NoteItem = {text: string; done: boolean};
export type NoteDraft = {title: string; seen: string; next: string[]};
export type Note = {title: string; seen: string; next: NoteItem[]};

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** An answer: text, and the indexes of the round's ads it cites (anything out of range dropped). */
export function readAnswer(raw: unknown, ads: number): {answer: string; ads: number[]} | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {answer?: unknown; ads?: unknown};
  const answer = text(value.answer, 3000);
  if (!answer) return null;
  const cited = Array.isArray(value.ads) ? value.ads.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < ads) : [];
  return {answer, ads: [...new Set(cited)]};
}

/** AI's draft of a note: a title, what was seen, and up to four things to try. */
export function readNoteDraft(raw: unknown): NoteDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {title?: unknown; seen?: unknown; next?: unknown};
  const title = text(value.title, 200), seen = text(value.seen, 2000);
  const next = Array.isArray(value.next) ? value.next.map(item => text(item, 300)).filter((item): item is string => Boolean(item)).slice(0, 4) : [];
  return title && seen ? {title, seen, next} : null;
}

/** A note as the team saves it: every field checked and cut to what the table allows. */
export function cleanNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {title?: unknown; seen?: unknown; next?: unknown};
  const title = text(value.title, 200), seen = text(value.seen, 2000);
  if (!title || !seen) return null;
  const next = Array.isArray(value.next) ? value.next.flatMap(item => {
    const entry = item as {text?: unknown; done?: unknown} | null;
    const line = text(entry?.text, 300);
    return line ? [{text: line, done: entry?.done === true}] : [];
  }).slice(0, 10) : [];
  return {title, seen, next};
}
