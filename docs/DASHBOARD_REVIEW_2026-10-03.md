# Analytical homepage — approved reference direction

The user approved the Motion + MagicBrief + Foreplay direction in `docs/references/DESIGN_REFS_2026-10-03.md`. This slice changes the homepage from a gallery to a review workflow: review reported own results, inspect competitor evidence, compare, and draft an experiment.

## Delivered behavior

- Default own report: latest imported 7-day window ending before the current Bangkok day; selectable 14/30 days. Explicit dates survive comparison and return to the homepage. Older root performance bookmarks still open the daily library.
- One comparative report strip, followed by a ranked table rather than a wall of creative previews. Sort across stored records by spend, ROAS, cost per conversation or conversation count. At most six records from the first results page in the selected currency are shown; open the full daily library for more.
- Competitor feed shows stored copy/title, CTA, format and first-seen date. Open its exact dataset evidence before comparing. Page list is sorted by first observed ads in seven days. First observed does not mean newly launched or profitable.
- Personal watchlist remains separate from the overall market. An empty watchlist invites the user to select relevant pages; the homepage does not pretend to have scheduled monitoring or team recommendations.
- Existing comparison experiment drafts/download remain browser-local. No shared experiment results, automatic budget changes, AI classifications or CRM close rate have been fabricated.
- Existing high-resolution image delivery and on-demand video detail are preserved. Opening the homepage initializes no video player and starts no provider mutations. The selected reference refinement adds at most four small, lazy rival previews below the ranking; owned creative media still opens on demand.

## Sources and formulas

All reads use caller JWT/RLS. Existing `owned_performance_page` supplies recorded ad/day totals from a completed destination snapshot, and equal-length previous-window totals. No schema changes and no writes to the source Ads Management database.

- ROAS = summed reported purchase value / summed reported spend.
- Cost per conversation = summed reported spend / summed reported conversations.
- Percent change = (current − previous) / previous × 100, only for the same currency, same-length periods inside imported bounds, complete relevant recorded fields and a positive previous denominator.
- Imported date bounds and field coverage do not prove that every calendar day or every ad/day was reported. The page explicitly describes these as reported records and never fills absent days with zero.
- A changed aggregate or a position in the table does not, by itself, justify a budget decision. Performance eligibility is existing positive-spend source logic; latest inventory status is not historical status.

## Validation

- Focused unit checks: 19 pass, including missing fields, mismatched currencies, prior zero, out-of-bounds/equal-length periods, malformed query values and legacy/navigation compatibility.
- Targeted ESLint, privileged-import boundary check, TypeScript/production build pass.
- Real-browser production check passes: actual report window 26 September–2 October 2026, 3,812 eligible owned ads, 892 stored rival ads. Checks 14-day and ROAS controls, modal keyboard focus, exact dataset rival evidence, same-date comparison and return, free catalog search, section outages, anonymous API rejection and malformed-query rejection.
- Desktop 1440×1000 and mobile 390×844 inspected together. No horizontal page overflow; mobile table becomes compact records with 44px actions. A short competitor signal at the top keeps both review questions visible without scrolling through the ranked table.
- Opening the homepage initializes no video/iframes and starts no provider, sync or collection mutations. No source DB writes or paid Apify collection was performed.
- This is verified on localhost; it has not been deployed.

## Selected visual reference: user image 4

The user selected `ChatGPT Image Oct 3, 2026, 02_17_45 PM-1.png`: a light blue overview, independent white KPI cards, compact ranking table, small competitor evidence feed and watchlist. The date selector is in the header. Table controls retain real sorting, detail inspection and same-date comparison. Six visible authorized records can be exported as CSV with explicit dates/currency and spreadsheet formula escaping.

Visual content was adapted to actual source semantics: 40,190 is reported conversations, not the number of advertisements; 72.72 is cost per conversation. KPI comparison bars represent current versus prior totals, not an invented daily line. The table's daily spend lines come from `owned_library_daily`, pinned to the same completed snapshot and authenticated caller. Reads are bounded to the first 24 ranked identities and two pages of at most 1,000 records. Unknown days break the graph; known zero stays zero. Per-ad change requires a stored valid spend value on every day in both equal windows, and a positive previous total.

No mockup upgrade/billing controls, cross-platform spend splits, fake notifications, AI recommendations, budget actions or shared experiment results were added. Existing pages and comparison remain the routes used by the controls.

Four rival preview URLs in the tested dataset have expired. They fall back to an explicit inspect-data affordance; copy, date and exact dataset evidence remain available. This refinement does not automatically collect or archive paid provider data to replace them.

Focused model, series and navigation checks: nine pass. Production browser checks additionally verify the actual seven-day points, visible-row CSV, 14-day/ROAS controls, exact dataset evidence, same-date return, modal focus, mobile layout, partial outages and authentication. Desktop/mobile are inspected together in one round, then the density and touch targets are corrected in one batch and confirmed once. Local preview remains the release target.
