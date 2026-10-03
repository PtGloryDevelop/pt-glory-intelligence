# Design QA — PT Glory, 2026-10-02

## Earlier market-overview phase

The findings and passed result below describe the earlier market-first design, now available at `/market-overview`. They do not certify the new daily-performance home or Command Center. The team-flow phase now has imported daily data and date-effective Unit relations; the earlier statement about future Unit integration no longer applies. A business product label still requires a source label. Null/outage scenarios in the earlier browser checks were intercepted responses; the actual daily snapshot currently has no missing-metric case to verify.

Source visual truth:
- test-artifacts/design-references/settle-dashboard.png (2766 × 1632)
- test-artifacts/design-references/foreplay-library.png (1917 × 950)
- test-artifacts/design-references/foreplay-ad-drawer.png (1913 × 947)

Implementation: localhost:3188, authenticated analyst; Thai content and real stored ads.
Viewport: desktop 1440 × 1000 CSS px, deviceScaleFactor 1; mobile 390 × 844.
Reference CSS viewport/density is unavailable. The downloaded reference screenshots were proportionally normalized to a maximum 1000 × 1000 per panel for composition comparison; this is an adaptation of hierarchy and workflow, not a pixel clone of the finance/English ad products.

Rendered evidence:
- test-artifacts/dashboard/desktop-viewport.png (1440 × 1000)
- test-artifacts/dashboard/desktop.png (full page)
- test-artifacts/dashboard/rival-detail.png (1440 × 1000, actual media loaded)
- test-artifacts/dashboard/own-detail.png (native modal)
- test-artifacts/dashboard/mobile.png
- test-artifacts/dashboard/mobile-action.png (390 × 844, focused summary and weekly action)
- test-artifacts/library-redesign/owned-desktop.png
- test-artifacts/library-redesign/rivals-desktop.png
- test-artifacts/comparison-flow/desktop.png and mobile.png

Combined comparison inputs inspected:
- test-artifacts/design-qa/dashboard-comparison.png
- test-artifacts/design-qa/drawer-comparison.png
- test-artifacts/design-qa/drawer-focus.png (image/copy regions, separately cropped from each source)
- test-artifacts/design-qa/library-comparison.png

Browser evidence was captured by the existing runnable Playwright project checks. The in-app Node REPL failed before initialization (kernel assets path); these are isolated local-browser captures, not a claim of an in-app inspection.

## Findings and iteration history

1. [P1, resolved] First capture used new markup while the dashboard stylesheet was still being completed, causing wide cropped own images and a narrow rival column.
   Evidence: initial desktop capture before stylesheet integration.
   Fix: complete dashboard CSS contract, use 160px own-image column with contained images, two 280px rival previews, and a full-width responsive stack.
   Post-fix: desktop-viewport.png and dashboard-comparison.png; whole creative images remain visible.

2. [P2, resolved] Rival modal capture occurred before the signed preview loaded.
   Evidence: first rival-detail capture showed the empty stage during image loading.
   Fix: wait for actual image completion in the runnable visual capture; preserve truthful unavailable/error states.
   Post-fix: rival-detail.png and drawer-focus.png show the stored creative at readable size. This was a capture timing issue, not fabricated missing media.

3. [P2, resolved] Draft verification read the server-rendered form before browser draft hydration.
   Fix: verify the restored values with retrying assertions, including direct links and reload. No waiting timeout was used as a substitute for user input.
   Post-fix: check-business-comparison.mjs passes exact-pair/user isolation, navigation/reload restoration, storage-denied fallback, and export.

4. [P3] The highest-spend own ad has a source-generated campaign label. The short ad name now falls back to available title/campaign text; a business product label requires the Unit integration described in the added document.

5. [P2, resolved] Mobile weekly-action link collapsed into a narrow vertical button because responsive grid rules still targeted the previous button element.
   Evidence: mobile.png at 390 × 844.
   Fix: target the shared primary link and span both grid columns on phones; remove unused button-only styles. Added a runnable mobile geometry assertion and focused capture.
   Post-fix: mobile-action.png was visually inspected; the button is wide, readable and touchable. The geometry assertion passes.

6. [P2, resolved] Long spend amount split its final decimal digit onto a second line in the 390px mobile summary card.
   Evidence: the first mobile-action.png post-button fix.
   Fix: render currency on a separate line and use the existing smaller type role for the money figure on phones. Added a number-line/containment assertion.
   Post-fix: recaptured mobile-action.png and visually inspected the same 390 × 844 viewport. Full spend figure stays on one line; currency remains explicit underneath. The number-line/containment assertion and complete dashboard flow pass. Desktop was recaptured and compared with the reference composition again.

## Required fidelity surfaces

- Fonts/typography: existing Thai font stack retained; all modules use the existing nine type-scale roles. Readable heading/body/metadata hierarchy; card copy is open in the compare workspace rather than hidden in disclosure controls.
- Spacing/layout rhythm: neutral sidebar, four summary cards, single next-step banner, evidence panels, restrained 12px cards. Desktop modal uses a wide image stage with 400px detail column; mobile stacks and scrolls within the native dialog.
- Colors/tokens: white/neutral surfaces, dark text, cobalt primary actions and keyboard focus; semantic status colors retained. Finance charts were intentionally replaced with real ad evidence because no time-series business dataset is available in this scope.
- Image quality/assets: existing PT Glory brand asset and actual Meta/archive ad previews reused; no generated/fake ads. Images are contained, sharp and larger; references' advertisers/logos were intentionally not copied into this company's product.
- Copy/content: home now begins with ads first found in the last 7 days, states the observed window and capture dates, and separates first found from Meta start date. No inferred competitor revenue/ROAS or AI conclusions. Page/brand identities remain distinct.
- Icons: existing app icon set reused for consistency; no replacement of source imagery with CSS drawings.
- Interaction/accessibility: native modal focus, Escape, backdrop closing and focus return checked; background stays in place. Partial source outages and null metrics remain truthful. Mobile navigation and no horizontal overflow checked.
- Responsive states: 1440 desktop, 390 mobile; comparison also checked at 320 and 768. Actual empty/failed/missing financial states were exercised.

Intentional adaptations: finance data → real ad evidence, English → Thai, Foreplay dark sidebar → requested light neutral sidebar, local manual draft retained until a shared-team data model is added.

## Implementation checklist
- [x] Real summary and 7-day first-found evidence
- [x] Whole catalog search, paging and exact snapshot comparison links
- [x] Own spend filter with full inventory retained
- [x] Native wide detail overlays and preserved context
- [x] Draft restore and user/pair isolation
- [x] Desktop/mobile evidence and focused image/copy comparison

No actionable P0/P1/P2 visual findings remain in the verified surfaces.
final result: passed

## Team-flow phase — final review 2026-10-03

The latest handwritten team flow is implemented for analyst/admin at `/` and `/command-center`. Viewer still receives the market overview without financial data. The home begins with own-ad period KPIs, followed by search and date/Unit/Page/status/sort controls and full-image creative cards. Comparison retains the selected period, exact changed pair and return filters after reload and session restoration. CRM closing rate remains unavailable; AI is not enabled.

Actual-source verification on 2026-10-02:

- `scripts/check-owned-performance.mjs` passed all nine date presets (three simultaneous requests per batch), real caption/title search and filters, all seven ranking modes, actual pagination, custom dates, out-of-range recovery, reload, keyboard detail, changed own-ad URL/session restoration, same-period comparison and exact return. No fixture, sync, collection or autoplay was used.
- `scripts/check-owned-daily.mjs` passed weighted currency-separated totals, complete summary across pages, imported coverage/start dates/newest sorting and financial access restrictions, in a read-only transaction followed by rollback. The tested populated window had no missing-metric case.
- Production build, relevant focused lint/tests, privileged-import checks and previous catalog/dashboard/comparison regression checks passed. This does not certify the whole project's release gate; existing baseline failures remain outside this report.
- RPC performance changes 0049–0053 preserved the full response in measured before/after cases and removed the observed simultaneous-read timeout. See `docs/SCREENSHOT_FLOW_AUDIT_2026-10-02.md` for measurement scope and limitations.

Rendered evidence inspected at desktop 1440×1000 and mobile 390×844:

- `test-artifacts/owned-performance/home-desktop.png`
- `test-artifacts/owned-performance/library-desktop-viewport.png`
- `test-artifacts/owned-performance/creative-card.png`
- `test-artifacts/owned-performance/detail.png`
- `test-artifacts/owned-performance/rankings-desktop.png`
- `test-artifacts/owned-performance/library-mobile.png`
- `test-artifacts/owned-performance/home-creative-mobile.png`
- `test-artifacts/owned-performance/rankings-mobile.png`

Independent review found no actionable layout issue in the inspected home/card/ranking surfaces. The very tall mobile ranking image is downscaled by the image viewer, so fine text was additionally inspected in actual-size phone captures on 2026-10-03: `rankings-mobile-viewport.png` and `ranking-card-mobile.png`. Full creative, readable number lines, native controls, intact action buttons and no horizontal overflow were verified. The card element capture includes the sticky page header over its top edge; this is capture context, not cropping of the creative in the application.

The restarted local server passed an authenticated home/API/mobile ranking smoke check on 2026-10-03, including today's Bangkok date without moving it back to the last imported day. Source data still ends on 2026-10-02; later dates require another import. The local server has network access for authentication/source reads. The app has not been deployed in this phase.

Limits: source-generated labels remain where a business label is unavailable; actual source playback of every own video is unverified; unavailable Meta video permissions retain a poster. Real missing metrics/outages were not present in the daily snapshot. Earlier browser null/outage assertions used intercepted responses and are scoped to that earlier phase.

Team-flow result: passed for the verified data, interaction and visual surfaces.

