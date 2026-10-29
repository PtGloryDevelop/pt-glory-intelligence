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

/**
 * One ad's own page in the Ad Library. It keeps playing the creative long after
 * the CDN links we collected have expired, so it is where a video is watched.
 * Built from the numeric archive id only; anything else yields no link.
 */
export function adLibraryAdUrl(adArchiveId: string): string | null {
  return /^\d{1,32}$/.test(adArchiveId) ? `https://www.facebook.com/ads/library/?id=${adArchiveId}` : null;
}

export function buildAdLibraryUrl({ country, query, activeStatus }: AdLibrarySearch): string {
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`country must be an ISO 3166-1 alpha-2 code: ${country}`);
  if (activeStatus !== "active" && activeStatus !== "all") {
    throw new Error(`activeStatus must be "active" or "all": ${String(activeStatus)}`);
  }
  const q = query.trim();
  if (q === "") throw new Error("query must not be blank");

  // A query wrapped in double quotes is an exact-phrase search, the same URL the Ad Library builds for it.
  const exact = /^"[^"]+"$/.test(q);
  return "https://www.facebook.com/ads/library/"
    + `?active_status=${activeStatus}&ad_type=all&country=${country}&is_targeted_country=false`
    + `&media_type=all&q=${encodeURIComponent(q)}&search_type=${exact ? "keyword_exact_phrase" : "keyword_unordered"}`
    + "&sort_data[direction]=desc&sort_data[mode]=total_impressions";
}

/**
 * The reverse: a pasted Ad Library search link → the form's fields. Only keyword
 * searches can be represented (an advertiser/page link cannot), so anything else
 * is refused rather than guessed. An exact-phrase search comes back quoted.
 */
export function parseAdLibraryUrl(text: string): AdLibrarySearch | null {
  let url: URL;
  try { url = new URL(text.trim()); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|web)\./, "");
  if (url.protocol !== "https:" || host !== "facebook.com" || !url.pathname.startsWith("/ads/library")) return null;
  const searchType = url.searchParams.get("search_type") ?? "keyword_unordered";
  if (searchType !== "keyword_unordered" && searchType !== "keyword_exact_phrase") return null;
  const raw = (url.searchParams.get("q") ?? "").replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim();
  const country = (url.searchParams.get("country") ?? "").toUpperCase();
  if (raw === "" || !/^[A-Z]{2}$/.test(country)) return null;
  return {
    query: searchType === "keyword_exact_phrase" ? `"${raw}"` : raw,
    country,
    activeStatus: url.searchParams.get("active_status") === "all" ? "all" : "active",
  };
}

/**
 * Where a finished round's rivals are picked: ส่องแอด searching the round's words, where each page found is
 * answered ใช่ / ไม่ใช่ for a unit. Null when the words cannot be a search there (2–60 characters).
 */
export function pickRivalsHref(keyword: string | null): string | null {
  const word = (keyword ?? "").replace(/^"+|"+$/g, "").trim();
  return word.length >= 2 && word.length <= 60 ? `/competitors?${new URLSearchParams({ view: "all", search: word })}` : null;
}
