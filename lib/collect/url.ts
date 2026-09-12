/**
 * The Ad Library search URL the server builds for a collection request (spec §7.1).
 *
 * The same shape as the Pilot's Extension runs and both C01 Apify runs. Written
 * out by hand rather than with URLSearchParams so `sort_data[...]` keeps the
 * literal brackets the proven URL has.
 */

export type AdLibrarySearch = {
  country: string;
  query: string;
  activeStatus: "active" | "all";
};

export function buildAdLibraryUrl({ country, query, activeStatus }: AdLibrarySearch): string {
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`country must be an ISO 3166-1 alpha-2 code: ${country}`);
  if (activeStatus !== "active" && activeStatus !== "all") {
    throw new Error(`activeStatus must be "active" or "all": ${String(activeStatus)}`);
  }
  const q = query.trim();
  if (q === "") throw new Error("query must not be blank");

  return "https://www.facebook.com/ads/library/"
    + `?active_status=${activeStatus}&ad_type=all&country=${country}&is_targeted_country=false`
    + `&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`
    + "&sort_data[direction]=desc&sort_data[mode]=total_impressions";
}
