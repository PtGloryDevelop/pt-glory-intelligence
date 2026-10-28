import type { RivalBoard } from './board.ts';

/**
 * The rival board's two ad strips, as the browser asks for them. The page reads the same URLs with its HTML,
 * so the strings must match exactly: the browser skips a fetch only for a URL the server already answered.
 */
export type Strip = 'new' | 'age';

/** Competitor pages in scope: one unit, or every unit with keywords; none for a unit that has no keywords yet. */
export function stripPages(board: RivalBoard, unitId: string): string {
  if (board.unitsWithoutKeywords.some(unit => unit.id === unitId)) return '';
  const scope = board.units.filter(unit => !unitId || unit.id === unitId);
  return [...new Set(scope.flatMap(unit => unit.pages.map(page => page.page_id)))].slice(0, 60).join(',');
}

export const stripUrl = (strip: Strip, pages: string, limit: number) => strip === 'new'
  ? `/api/catalog/ads?pages=${pages}&period=week&sort=new&limit=${limit}`
  : `/api/catalog/ads?pages=${pages}&active=active&sort=age&limit=${limit}`;
