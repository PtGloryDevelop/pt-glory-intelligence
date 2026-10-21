/**
 * The menu entry a URL belongs to.
 *
 * Kept apart from nav.ts so the client shell can use it without bundling the
 * whole menu model, admin entries included, into every browser.
 *
 * `/competitors` is two entries told apart by its query: the full library
 * (`view=all`, a period, a search or a dataset) is ส่องแอด; the bare board is
 * ติดตามคู่แข่ง.
 */
export function activeHref(
  items: { href: string; also?: string[] }[],
  pathname: string,
  search: URLSearchParams,
): string | undefined {
  const path = pathname === "/" ? "/market-overview" : pathname;
  if (path === "/competitors") {
    const library = search.get("view") === "all" || ["period", "search", "dataset"].some((key) => search.has(key));
    const wanted = library ? "/competitors?view=all" : "/competitors";
    return items.some((item) => item.href === wanted) ? wanted : undefined;
  }
  const matches = (base: string) => path === base || path.startsWith(`${base}/`);
  return items
    .flatMap((item) => [item.href, ...(item.also ?? [])]
      .filter((base) => !base.includes("?") && matches(base))
      .map((base) => ({ href: item.href, length: base.length })))
    .sort((a, b) => b.length - a.length)[0]?.href;
}
