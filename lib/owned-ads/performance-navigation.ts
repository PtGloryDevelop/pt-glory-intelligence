const FILTER_KEYS = ['period', 'from', 'to', 'unit', 'pageId', 'q', 'status', 'sort', 'page', 'compare'] as const;

/** Keep bookmarked performance filters when the homepage becomes a research overview. */
export function legacyPerformanceHref(params: Record<string, string | string[] | undefined>): string | null {
  if(params.dashboard==='1')return null;
  if (!FILTER_KEYS.some(key => params[key] !== undefined)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return `/owned-ads/performance?${query}`;
}

/** The overview uses snapshot totals; a filtered library uses the selected daily reporting period. */
export function isPerformanceReturn(href: string): boolean {
  const url = new URL(href, 'https://pt-glory.invalid');
  return ['/owned-ads/performance', '/command-center'].includes(url.pathname)
    || (url.pathname === '/' && FILTER_KEYS.some(key => url.searchParams.has(key)));
}
