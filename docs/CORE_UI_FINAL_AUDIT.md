# Core UI — Final Audit

Closing document for the Phase 1 visual refactor (V1 → V5). It records what the
interface guarantees, what it deliberately does not, and what is still open.

Written 2026-09-08.

---

## 1. Frozen commits

| Slice | Commit | What it froze |
|---|---|---|
| V1 Global shell | `b4551c8` (+ `a295fad`) | Shell, Amendment A1 palette, brand mark, surface levels, PageHeader |
| V2 Import + shared components | `a2eb161` | Import stepper, QualityStrip, KPIStat, PartialBanner |
| V3 Explorer | `d033cdc` | Filters, chips, sort, grid/table, shareable URL |
| C1 Media truth | `dab0faa` | `mediaPresentation`, sticky layers, auth order |
| C1.7 Durable preview | `217b5c7` | `media_assets`, archival pipeline, SSRF defence |
| C1.8 Automatic drain | `2683a61` | pg_cron schedule, machine auth, lease + terminal states |
| C2 Explorer visual | `ac2546a` | Card composition, 4:5 cover, mobile browse layout |
| C3 Dataset + import visual | `6c49488` | Fact de-duplication, phone fit, header geometry |
| V4 Ad Detail Drawer | `be3c036` | Page-led header, contain-fit creative, dialog behaviour |
| **V5 Final consistency** | **this commit** | Type scale closure, error boundary, stale-build protection |

Tag `v0.1.0-phase1` marks the functional Phase 1 baseline that preceded the
visual work.

---

## 2. Core routes

| Route | Purpose | Width |
|---|---|---|
| `/login` | The one signed-out surface | 400px card, centred |
| `/` | Operational home: two destinations and real system counts | 1180px |
| `/import` | Upload → preview → commit | 1180px |
| `/datasets` | Every dataset with its own run's counts | 1180px |
| `/datasets/[id]` | Dataset context, quality, Explorer, Drawer | 1440px |

The dataset page is the only wide route, and it is a different token
(`--content-max-wide`), not a locally invented number. Asserted.

---

## 3. Design tokens

All tokens live in `app/globals.css`. Nothing else defines a colour or a size.

**Colour** — Amendment A1. Bright colours are fills; charcoal is the text on
them. Charcoal on `--brand` measures 4.83; white would be 3.15, so there is no
white-on-brand token. Orange as text is `--brand-ink`. Focus is blue
(`--focus`), because orange at 2.73 cannot serve as a focus ring. Semantic
tokens are never re-pointed at the brand.

V5 added two: `--line-pink` (the edge that is visible on `--surface-pink`) and
`--accent-blue-ink` (blue as a glyph, not as a fill). Both replaced hex literals
that had been sitting in modules where nothing measured them.

`tests/palette.test.ts` re-measures every pairing from the real stylesheet, and
now also fails if any `.module.css` contains a colour at all (`#000` and `#fff`
excepted: the video letterbox and a label over a photograph, neither of which
sits on a themed surface).

**Type** — nine roles, closed:

| Role | Size | Job |
|---|---|---|
| `--fs-page-title` | 24px | page titles, large figures |
| `--fs-title` | 19px | standalone card headline, brand name |
| `--fs-subhead` | 17px | card / panel headline in a page |
| `--fs-section` | 16px | section headings |
| `--fs-title-sm` | 15px | compact panel title, small figure |
| `--fs-body` | 14px | body, tables, navigation, controls |
| `--fs-meta` | 12.5px | metadata and helper text |
| `--fs-label` | 11.5px | form labels, table headers |
| `--fs-eyebrow` | 11px | uppercase section and stat labels |

Kanit carries the display voice — product name, page titles, headings, large
numerals. IBM Plex Sans Thai carries everything dense: body, tables, filters,
forms, metadata. `tests/typography.test.ts` fails on any font size in a module
that is not one of the nine (BrandMark's glyph sizes are exempt and commented as
geometry). `e2e/v5.spec.ts` re-checks the same rule against *rendered* text on
every route.

---

## 4. Responsive rules

| Boundary | What changes |
|---|---|
| ≤ 640px | Explorer cards become horizontal browse rows; QualityStrip restacks; drawer is a full-screen sheet |
| ≤ 900px | Sidebar leaves the flow and slides over the page; topbar appears |
| ≤ 1024px | Drawer becomes a `min(88vw, 680px)` sheet |
| ≤ 1439px | Sidebar collapses to a 68px rail; section headings become dividers |
| ≥ 1440px | Full sidebar; dataset page opens to 1440px |

Verified at 375 / 640 / 768 / 900 / 1024 / 1280 / 1440 on every route: no
page-level horizontal overflow, no sticky layer covering another.

---

## 5. Accepted trade-offs

- **V23-13 — badge families stay distinct.** StatusBadge, QualityBadge, filter
  chips and media overlays share shape and typographic discipline but not one
  merged component. A media overlay sits on a photograph and a status badge sits
  on paper; making them identical would cost legibility on one of the two.
- **V23-16 — closed in C2** as an accepted design trade-off.
- **Scroll position is not restored** when the drawer closes. Search, filters,
  sort, view mode and pagination all survive, because they live in the URL. The
  scroll offset does not, and adding it would mean a routing refactor this slice
  explicitly excluded.
- **The quality caveat is one footnote, not one sentence per row.** Repeated on
  every non-normal row it cost 413px before the reader reached an ad. The tier
  badge carries the level visually on each row; the sentence stays on the row for
  assistive technology.
- **The rail hides section names.** At 68px, "INTELLIGENCE" cannot be rendered
  legibly, so the heading becomes a rule. The text remains in the accessibility
  tree.

---

## 6. Snapshot guarantees

A dataset shows the values from **its own collection run**, always.

Proven end to end (`e2e/journey.spec.ts`, "an old dataset keeps its snapshot
after a newer import"): import run A, import run B changing the same ad, reopen
dataset A — the grid and the drawer still read A's values, and B appears in the
observation history as a separate row. The drawer marks which row is this
dataset's own observation, so a newer one above it cannot be mistaken for the
subject.

An ad that is not in the dataset is a 404, never a silent fall-back to the
latest state.

---

## 7. Media guarantees

Four states, four different sentences, on every surface (card, table row,
drawer):

| State | Meaning |
|---|---|
| archived | our own bytes in private storage; cannot expire |
| source | the collector's signed URL, good for about four days |
| unusable | media was captured but cannot be displayed |
| absent | nothing was captured for this ad |
| expired | a source URL that failed to load, with no archived copy |

What the ad **is** comes from `display_format` and never from the archived
file's type: a VIDEO ad whose durable preview is a JPEG poster is still a video
and says so. That rule now lives in one module (`lib/media/format.ts`); before
V5 the card, the table thumbnail and the drawer each had their own copy.

Presentation differs by surface on purpose: the grid crops to 4:5 (`cover`), the
table shows a compact thumbnail, the drawer contains the whole creative
(`contain`). Proven with the source CDN blocked: archived previews still render
(`e2e/durable-media.spec.ts`).

**Historical video playback was never promised.** The archive stores a poster,
not the video file. The drawer says so in plain words rather than as an error.

---

## 8. Data quality guarantees

- Tiers: normal ≥ 80%, partial 50–79%, low < 50%, unknown when nothing was
  measured. Unknown is neutral and never reads as "low".
- Every claim carries found / total / percentage / tier. A percentage without
  its denominator is not a fact anyone can check.
- No average coverage score anywhere: averaging coverage across fields invents a
  number with no referent.
- The caveat "may be claimed only within the readable subset, not the whole
  dataset" is attached to every non-normal field.

## 9. Forbidden metrics

Spend, reach, impressions, engagement, reactions, comments, shares, CTR, CPC,
CPA, ROAS, sales, conversion, market share and "winning ads" are refused in
three places: the collector contract rejects them as data, the filter allowlist
rejects them as query keys, and `tests/ui-vocabulary.test.ts` now rejects them as
words on a screen, in English and in Thai.

A Page is never presented as a Brand. The sidebar lists a future "เพจ / แบรนด์"
route, disabled, with no data behind it; nothing in the product maps one to the
other, and the same test enforces that.

---

## 10. Accessibility status

Verified:

- Keyboard-only path from the filters to a card, into the drawer and back out.
- Focus is visible wherever it lands: 3px blue ring, measured in the test.
- The drawer is a real dialog — `role="dialog"`, `aria-modal`, focus moved in,
  Tab trapped both directions, Escape closes, focus restored to the card that
  opened it.
- Status is never colour alone; every badge carries text.
- Icon-only controls carry accessible names.
- Disabled controls keep full-strength text on a dimmed surface (opacity 1), so
  "unavailable" never reads as "loading".
- Tables stay real tables, including where they restack on a phone.
- Thai text is not clipped by its own line box at 375 or 768.

Not done, and not attempted: a full WCAG audit, and any change that would need a
functional rewrite.

---

## 11. Security presentation status

- Untrusted copy renders as text; nothing from an uploaded file executes.
- Hostile media URLs (`javascript:`, `data:`) are dropped, leaving the honest
  placeholder.
- A destination URL is rendered as text, never as a followable link, and never
  fetched by the server. Only `http(s)` destinations are shortened to host+path
  — V5 found that shortening a `javascript:` URL stripped its scheme and made a
  hostile value read like an ordinary path.
- No secret reaches the client bundle; the scan runs over real build output.
- Signed storage URLs are minted per request and never persisted as canonical
  data.
- A route crash shows the product's own error state with a correlation id. The
  boundary is forbidden by test from rendering `error.message` or a stack.

---

## 12. Test infrastructure

The Playwright suite owns the server it tests.

Two gate runs were lost to a `next start` from an older build still holding port
3000: the suite attached to it and reported visual failures that did not exist in
the working tree. The protection is three-part, in `scripts/test-server.mjs` and
`playwright.config.ts`:

1. The suite runs on port **3177**, away from `npm run dev` on 3000.
2. `scripts/build-fingerprint.ts` hashes every file that can change what the
   browser is served (`app`, `components`, `lib`, `styles`, `public`, plus the
   Next and TypeScript config and the lockfile). If that hash differs from
   `.next/SOURCE_FINGERPRINT`, the server rebuilds before starting.
3. `reuseExistingServer: false`, and the launcher refuses to start if anything
   already holds the port — so a borrowed server is a loud error, not a silent
   substitution.

`e2e/build-guard.spec.ts` runs first in **every** project and fails in one line
if the running server was not built from the working tree.

Normal development is untouched: `npm run dev` still owns 3000, and a suite run
whose source has not changed skips the build.

---

## 13. Remaining risks

**The link to Supabase from this machine drops intermittently.** During the V5
gate, the Next server's `fetch` to the Supabase host failed with
`ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT)` after 10s, against Cloudflare
addresses `172.64.149.246` / `104.18.38.10`, while `curl` to the same host from
the same machine succeeded 30/30 with every connect under one second. It
surfaced three ways: a signed-out session, a dataset list that never populated,
and a 500 on a dataset route.

This is an environment fault, not a product one: no code change makes it
reproduce or disappear, and the same suite passes end to end when the link is
healthy. Every reported test count below is from a clean run, with no retries
configured and none added.

It is worth watching once there is a deployment — a hosted runtime on a
different network will either not see it or will see it clearly.

**Fresh media is required for the visual specs.** The C2/V4/V5 projects run
against a seeded dataset whose previews are archived
(`scripts/seed-explorer-dataset.mjs`). It needs a collector export whose signed
URLs are still inside their ~105-hour window; with an expired one the captures
show placeholders.

---

## 14. Deployment-only blockers

**C1.9 is still blocked.** Automatic archival cannot be production-proven until
the Next application has an externally reachable HTTPS deployment. The pg_cron
schedule, the machine authentication and the drain are implemented and tested,
but the database cannot call back into a localhost application, so the schedule
is deliberately off in DEV.

**Automatic media preservation is not production-proven.** Until it is, the
operating rule stands: after every fresh import used for development, drain the
media queue explicitly while the source URLs are still alive.

---

## 15. Deferred product work

Not started, by instruction: Page Intelligence, Brand mapping, Competitor
Timeline, Compare, Trends, Watchlist, Collections, Creative Intelligence,
Hook / Pain / Offer AI, Deep Search.

The sidebar lists them as disabled destinations so the shell reads as the
finished product. None of them is populated with a fact the engine cannot
support.
