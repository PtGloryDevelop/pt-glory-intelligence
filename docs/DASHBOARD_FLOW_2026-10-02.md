# Dashboard and simpler research flow

Home `/` is now the marketing dashboard. The primary navigation is overview,
owned ads, competitor ads, ad comparison, and personal watchlist. Existing page
analysis and administration tools remain under collapsed navigation groups.
Server-side role filtering remains in place.

## Working journey

1. Home shows company spend, weighted Meta ROAS, attributed purchase value and
   purchases, conversations and cost per conversation. It includes the report
   window, source freshness, inventory versus ads with reported results,
   highest-spend creatives, unique competitor counts, top pages, watches, and
   collection status. Currency groups are never added together.
   The team reference guides the light blue/white shell: a visible search field,
   four summary cards, four image-first owned ads, and a compact analysis rail.
   Clicking an image opens its details inline; comparison is one link from the
   card or inspector. The rail compares only the displayed ads with the same
   currency's weighted ROAS for the stated reporting period. Missing comparison
   data stays unavailable; no artificial percentage changes or AI claims appear.
2. Open an owned ad or competitor card and choose comparison directly. Main
   search remains visible; account, source-round, and detailed filters are folded.
   Competitor browsing identifies the selected collection round and also offers
   the existing all-pages catalog. The all-pages catalog searches page names/IDs;
   ad-copy search is scoped to the selected round.
3. Comparison uses visual cards and three steps: owned, rival, review. A link
   replaces its selected side and retains the other side through IDs-only session
   storage. Access is rechecked by authenticated read endpoints. The review shows
   source evidence and reporting dates, with a short experiment brief to download.
4. Watches remain personal. Completed collection links open the corresponding
   competitor round rather than the dashboard.

## Data and loading behavior

The dashboard read endpoint uses the caller's JWT. Company summary computation
occurs atomically when a source sync publishes its completed snapshot; opening
the dashboard does not scan all creative JSON or initiate source sync/collection.
Migration `0046_dashboard_summary.sql` backfills existing completed snapshots.
Failed sections show unavailable/retry states, not fabricated zero or empty data.
Missing reported metrics retain null and coverage; rival spend/sales/ROAS are not
invented. Creative loading uses the existing large-image endpoint and cache.

## Verified on 2026-10-02

- Current completed inventory: 73,218 company ads / 72 accounts, 12,456 ads with
  reported metrics for 2026-09-02 through 2026-10-01. Rival inventory: 892 unique
  ads / 357 pages across saved rounds.
- `scripts/check-dashboard.mjs`: transactional weighted ROAS, currencies, null
  coverage, publication boundary, viewer/anonymous permissions, rival dedup.
- `scripts/check-dashboard-flow.mjs`: actual summary, high-resolution images,
  direct selection links, mobile menu, and partial-outage states.
- `scripts/check-library-ui.mjs`: real cards, hidden filters, comparison links,
  detail dialogs, all-pages entry, mobile, and image pending/failure states.
- `scripts/check-business-comparison.mjs`: real two-sided selection, search
  retention, deep links, export, mobile layout, and unauthenticated redirect.
- TypeScript, import boundary checks, and relevant unit tests passed. ESLint
  has zero errors and two existing collector unused-function warnings.
- Production Build passed; dashboard, library, and comparison browser checks
  also passed against `next start` on the existing local port 3188.

Visual artifacts are under ignored `test-artifacts/dashboard`,
`test-artifacts/library-redesign`, and `test-artifacts/comparison-flow`.
