import { getCatalogAds, type CatalogOptions, type CatalogPage } from '../read/catalog.ts';
import type { RivalBoard } from './board.ts';
import { stripPages, stripUrl, type Strip } from './strips.ts';

/**
 * Both strips as the board first shows them (4 ads each), read on the server with the page. Each carries the URL
 * the browser would have asked for, so the board skips exactly that fetch. A failed read is left to the browser.
 */
export async function readStrips(board: RivalBoard, unitId: string): Promise<Partial<Record<Strip, { url: string; data: CatalogPage }>>> {
  const pages = stripPages(board, unitId);
  if (!pages) return {};
  const read = (strip: Strip, options: CatalogOptions) => getCatalogAds({ ...options, pageIds: pages.split(','), limit: 4 })
    .then(data => ({ url: stripUrl(strip, pages, 4), data }), () => undefined);
  const [fresh, long] = await Promise.all([
    // Same window as the route's period=week.
    read('new', { firstSeenSince: new Date(Date.now() - 7 * 86_400_000).toISOString(), sort: 'new' }),
    read('age', { active: 'active', sort: 'age' }),
  ]);
  return { new: fresh, age: long };
}
