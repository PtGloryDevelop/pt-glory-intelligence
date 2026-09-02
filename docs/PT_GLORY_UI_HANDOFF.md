# PT GLORY UI HANDOFF
## Base44 Revision #2 → Claude Code Production Visual Refactor

**Status:** Final Base44 UI Reference — FROZEN  
**Purpose:** Recreate the approved Base44 visual/UX direction inside the real PT Glory production app without changing the verified Phase 1 engine.  
**Production baseline:** Phase 1 final approved at commit `71577e2` before release bookkeeping.  
**Base44 reference:** Revision #2, reviewed from final screen recording on 2 Sep 2026.

---

# 1. Core Handoff Rule

Base44 is a **visual and interaction reference only**.

Claude Code must **recreate** the approved presentation layer inside the real PT Glory application.

Claude Code must NOT:
- copy Base44 backend assumptions
- copy Base44 entities/data models
- replace existing APIs
- replace Supabase/RLS
- replace snapshot semantics
- replace import/normalization logic
- invent metrics to make the UI look complete
- change deterministic data rules for visual convenience

The verified PT Glory Phase 1 engine remains the source of truth.

---

# 2. What to Keep From Base44

Use Base44 Revision #2 as reference for:

- page composition
- visual hierarchy
- typography scale
- warm cream / off-white visual direction
- gold accent usage
- sidebar layout
- active navigation state
- context bar
- card hierarchy
- table density
- filter toolbar
- 4-column Ads Explorer grid
- grid/table switch
- 600px desktop Ad Detail Drawer
- section spacing
- quality warnings
- FACT vs AI INTERPRETATION treatment
- Page vs Brand labeling
- evidence-card interaction
- Compare two-column layout
- Watchlist collection-board feel
- loading / empty / warning / media-unavailable states

Do not aim for pixel-perfect cloning if it harms accessibility or production behavior.
Aim for the same visual hierarchy and workflow.

---

# 3. Production Invariants — MUST NOT CHANGE

These are protected by Phase 1 tests and are not part of the visual refactor.

## 3.1 Data / Snapshot

- Dataset reads are pinned to `dataset.collection_run_id`.
- Dataset Explorer must use the Dataset snapshot.
- Dataset Ad Drawer must use the observation from the Dataset's run.
- `GET /api/ads/:id?datasetId=X` must verify membership in `dataset_ads`.
- Non-member in dataset context returns 404.
- Never silently fall back from snapshot to latest master state.
- Global/no-dataset Ad Detail may show latest master state and must be labelled accordingly.

## 3.2 Unknown State

`is_active = null` means unknown.

Render:
- Active → active state
- Inactive → inactive state
- null → `—` or `ไม่ทราบ`

Never fold unknown into inactive.

## 3.3 Multi-value Fields

`publisher_platform` and `page_categories` are multi-value.

- filters mean "array contains selected value"
- displayed percentages may exceed 100%
- do not render them as mutually exclusive pie shares unless a separate documented transform exists

## 3.4 Page != Brand

A Meta Page is not automatically a Brand.

If no mapping exists:
`ยังไม่ได้เชื่อมกับแบรนด์`

Never silently display page_name as brand identity.

## 3.5 Data Quality

Every percentage derived from field coverage must preserve:
- `present_count`
- `total_count`
- `coverage`
- `tier`

Tiers:
- Normal: >= 80%
- Partial: 50–79%
- Low: < 50%

Never display a coverage percentage without denominator context.

## 3.6 Forbidden Metrics

Never introduce:
- Spend
- Reach
- Impressions
- Engagement
- Reactions
- Comments
- Shares
- CTR
- CPC
- CPA
- ROAS
- Sales
- Conversion
- Conversions
- true Market Share
- Winning Ads

Page Likes are allowed only as Page-level source data.
Do not create a Page Likes Sum KPI.

---

# 4. Global Visual System

## 4.1 Direction

Target feel:

> Enterprise marketing intelligence + modern creative research

Reference qualities:
- Foreplay-like ad browsing usability
- Motion-like creative intelligence hierarchy
- intelligence dashboard clarity
- Thai-first internal-tool practicality

## 4.2 Colors — ⚠️ SUPERSEDED

**This section is overridden by [Amendment A1 — Color System Override](#amendment-a1--color-system-override) at the end of this document (2026-09-02).**
Gold is no longer the brand accent. Orange `#F26522` is. Read A1 instead; the text
below is kept only so the change is traceable.

- App background: warm cream / off-white
- Main surface: near-white / warm white
- Primary text: dark charcoal
- Gold: accent only
- Muted secondary: taupe / warm gray
- Green: normal quality / active only
- Amber: partial / caution
- Red: error / low coverage only

Avoid:
- dark SaaS dashboard
- heavy gradients
- gold body copy
- decorative green/red chart colors without semantic meaning
- heavy shadows

## 4.3 Typography

Recommended:
- Page title: 22–26px
- Section title: 15–17px semibold
- Main body/table: 13–14px
- Metadata: 12–13px

Important information must not rely on 10–11px text.

## 4.4 Shape / Spacing

- Card radius: 10–12px
- Page gap: ~24px
- Section gap: 24–32px
- Card internal padding: 16–20px
- Borders: subtle 1px
- Shadows: soft and minimal

Do not wrap every section in a large card.

---

# 5. App Shell

## Base44 Reference

Desktop expanded sidebar:
- ~228px
- collapses to ~68px
- one clear active navigation state
- warm-gold active background
- small gold left indicator
- section headings separated clearly

## Production Implementation

Keep current production routing and authorization.

Sidebar information architecture:

### MAIN
- หน้าหลัก
- Deep Search

### DATA
- หมวดหมู่
- Dataset
- Ads Explorer
- เพจ / แบรนด์
- Creatives

### INTELLIGENCE
- ภาพรวมตลาด
- คู่แข่ง
- Creative Intelligence
- Pain Point / Hook / Offer
- ราคา & Promotion
- แนวโน้ม
- Compare
- Watchlist

### SYSTEM
- นำเข้าข้อมูล
- Collection Runs
- Data Quality
- AI Analysis History
- Unmapped Pages
- Settings

Phase 1 routes only need to be functional.
Future routes may remain disabled / reference-only until their real implementation phase.
Never populate future pages with unsupported production facts.

---

# 6. Shared Context Bar

Create/reuse one production `ContextBar` component.

Desktop order:

`Category | Dataset | Source | Collected At | Data Quality`

Design:
- compact single row
- label/value pairs or small chips
- Data Quality gets semantic badge
- may become sticky on long pages
- should answer: "ข้อมูลที่กำลังดูมาจากชุดไหน?"

Do not duplicate the same metadata again in a large card immediately below.

---

# 7. Screen Mapping — Phase 1 Production Surfaces

---

## 7.1 Login

### Production
Use existing authentication behavior.

### Visual Direction
- clean
- minimal
- warm off-white
- compact PT Glory identity
- no marketing landing-page content
- no pricing / upgrade / credits

### Must Preserve
- current auth flow
- server-side authorization behavior
- no-role = deny

---

## 7.2 Import

### Production Route
`/import`

### Production Behavior
Keep current:
- Category selection
- file upload
- validation
- preview
- confirm
- commit
- success / partial / rejected / failed
- open Dataset

### Base44 Visual Reference
Simple operational wizard.

Use stepper:

`Upload → Validate → Preview → Confirm → Done`

### Preview Layout
Show:
- file name
- query
- country
- collection method
- collected_at
- reported counts
- computed counts
- Ads
- Pages
- Existing
- New
- quarantine estimate
- coverage

Use side-by-side reported vs computed counts.

### Partial
Amber banner before confirm.

### Rejected
Show safe exact validation reason.

### Success
Primary action:
`เปิด Dataset`

### Must Not Change
- preview writes nothing
- commit authorization
- 25MB / 5000-record guards
- validator semantics
- reported-vs-computed rules
- transaction behavior
- quarantine behavior

---

## 7.3 Dataset List

### Reference
Operational data table, not a dashboard.

### Suggested Columns
- Dataset
- Category
- Query
- Country
- Source
- Collected At
- Ads
- Pages
- Run Status
- Data Quality

### UX
- compact rows
- clear clickable Dataset name
- subtle hover
- status badges
- search/filter only if already backed by real behavior
- avoid decorative KPI cards

---

## 7.4 Dataset Detail

### Production
Snapshot-pinned.

### Base44 Reference
Header + Context Bar + compact summary + compact Quality Strip.

### Top
- Dataset name
- Context Bar
- run metadata

### Summary
Compact:
- Ads
- Pages
- Collected At
- Run Status

### Quality
Show important fields first:
- Copy
- CTA
- Title
- Destination
- Platform
- Page data

Each:
`Field — present / total — % — tier`

Then:
`ดู Data Quality ทั้งหมด`

Avoid showing 15–20 full-width bars before useful content.

### Partial Run
Amber banner near top.

### Must Preserve
- canonical `dataset_quality`
- denominator
- snapshot context
- unresolved/quarantine count
- no Page Likes sum

---

## 7.5 Ads Explorer

### Production
Dataset-scoped SQL filtering.

### Base44 Final Reference
This is one of the strongest approved patterns.

### Layout
Top search
then sticky filter toolbar:

- Active
- Format
- CTA
- Platform
- Page Category
- Applied filter count
- Reset
- Sort
- Grid/Table toggle

### Responsive Grid
- wide desktop: 4 columns
- medium desktop: 3
- tablet: 2
- mobile: 1

Do not return to the old 5-column cramped grid.

### Ad Card Hierarchy
1. Creative preview
2. Page name + Active/Inactive/Unknown
3. Copy preview 2–3 lines
4. Format + CTA
5. Platforms
6. Start Date / Ad Age
7. small reuse/collation indicator if available

Avoid excessive badge density.

### Table Mode
Recommended columns:

`Creative | Page | Copy | Format | CTA | Platforms | Start Date | Ad Age | Active`

### Empty State
Clear explanation + `ล้างตัวกรอง`

### Must Preserve
- filters run server-side
- search runs server-side
- active unknown filter
- multi-value array semantics
- snapshot data
- total + denominators
- pagination server guard

---

## 7.6 Ad Detail Drawer

### Production
Keep right-side drawer behavior.

### Base44 Final Reference
Desktop width about 600px.

### Header
- Ad Detail
- Snapshot badge OR `สถานะล่าสุดจากทุกรอบ`
- Close

Header may stay sticky.

### Sections

#### Creative Preview
- large stable preview
- media fallback

#### Identity
- Ad Archive ID
- Page
- Page Likes
- Page Categories

#### Status & Timeline
- Active / Inactive / Unknown
- Format
- Platforms
- CTA
- Start Date
- Ad Age
- First Seen
- Last Seen
- Collation/reuse

#### Copy
- Body
- Title
- Caption

#### Destination
- Link / destination data

#### Historical Observations
- newest → oldest
- run identity
- observed_at

#### Provenance
Secondary/collapsible.
Do not visually dominate.

### Missing Data
Render `—`.
Do not hide silently.

### Must Preserve
Dataset mode:
- membership check
- dataset run observation
- same-run page observation
- snapshot label

Global mode:
- current/latest
- explicit latest label

No silent fallback.

---

# 8. Future Visual Reference Pages

These should guide later phases, but do not implement Phase 2 logic merely because Base44 contains the screen.

---

## 8.1 Home / Overview

Approved hierarchy:

1. Context
2. KPI strip
3. Activity Timeline — dominant
4. Format / CTA / Platform
5. Page ranking
6. Creative Signals / evidence

Allowed KPIs must come from real supported data.

---

## 8.2 Deep Search

Approved result structure:

`Question → Answer → FACT → AI INTERPRETATION → Evidence → Data Used`

### FACT
- neutral white
- evidence-backed
- deterministic tone

### AI INTERPRETATION
- light warm-gold
- explicit interpretation label
- never visually identical to FACT

### Evidence
Creative cards link to Ad Detail.

AI UI must not imply unsupported certainty.

---

## 8.3 Page / Brand Detail

Semantic requirement:
Page != Brand.

Header:
- Page
- Page Likes
- Categories
- Profile identity
- Mapped Brand OR `ยังไม่ได้เชื่อมกับแบรนด์`
- Observed Ads
- First / Last Seen

Tabs:
`Overview | Ads | Creative | Copy | History`

---

## 8.4 Creatives

Visual-first grid.

Possible filters:
- Format
- Reuse
- Active
- Page
- Date

Keep metadata concise.
Creative preview dominates.

---

## 8.5 Market Overview

Approved structure:
- Context
- Market summary
- Activity Timeline
- Format distribution
- CTA distribution
- Platform distribution
- Page/Brand ranking
- Creative Signals
- Evidence

Format may use donut.
Platform/category must not be exclusive pie shares.

Observed-ad proportions must never be labelled true Market Share.

---

## 8.6 Competitor

Motion-like hierarchy:

Directory:
- Page/Brand
- observed ad count
- last seen
- format mix
- recent activity

Detail:
`Overview | Ads | Creative | Copy | History`

Focus:
- creative examples
- longest running
- recently found
- format
- CTA
- activity

No invented performance score.

---

## 8.7 Creative Intelligence

Deterministic signals first:
- Emerging
- Evergreen
- Most Reused
- Newly Found

AI later:
- Creative Pattern
- Hook
- Pain Point
- Offer
- Angle

Every insight/group:
- count
- denominator if %
- Evidence
- `ดู Evidence`

Never use `Winning Ads`.

---

## 8.8 Pain Point / Hook / Offer

Use grouped collection cards/rows.

Each:
- group name
- count
- percentage only with denominator
- short interpretation
- evidence action

FACT and AI labels remain separate.

---

## 8.9 Price & Promotion

Approved layout with one correction.

Coverage warning must be explicit.

Do NOT show ambiguous combinations such as:
`246 / 500 (49%)` and `Coverage 4%`
without specifying they represent different fields.

Correct format example:

`ข้อความที่ใช้วิเคราะห์อ่านได้: 246 / 500 Ads (49%)`

`ข้อมูลราคาที่สกัดได้จริง: 21 / 500 Ads (4.2%)`

`ดังนั้นผลด้านราคามี Coverage ต่ำ และไม่ควรตีความเป็นตัวแทนทั้ง Dataset`

Always name the field represented by each denominator.

---

## 8.10 Trends

Use one dominant timeline.

Controls:
- Dataset
- Date period
- signal selector

Below:
- notable changes
- evidence

Avoid many tiny trend charts.

---

## 8.11 Compare

Approved two-column structure.

Sticky header:
`Page/Brand A VS Page/Brand B`

Aligned rows:
- observed ads
- recently found
- evergreen
- creative reuse
- format
- CTA
- ad age

Then:
Evidence creatives A | Evidence creatives B

No true Market Share.

---

## 8.12 Watchlist

Use collection/swipe-file feel.

Visual emphasis:
creative references.

Possible later:
- saved ads
- saved pages
- collections
- notes/tags

Do not turn it into another analytics dashboard.

---

# 9. Data Quality Component Language

Use one system-wide pattern.

## Normal
>= 80%
Green

## Partial
50–79%
Amber

## Low
< 50%
Red

Component shows:
- field
- present / total
- percentage
- tier

Green / amber / red are semantic.
Do not reuse them randomly for unrelated charts.

---

# 10. Media Placeholder

Approved Base44 Revision #2 direction:

- neutral warm gray / warm beige
- media icon
- type label (`Video`, `Image`, `Media unavailable`)
- no fake creative
- no dominant gold/brown gradients

Real media must dominate visually when available.

---

# 11. Responsive Rules

Desktop-first.

## >= 1440px
- sidebar expanded
- 4-column Explorer
- full Context Bar
- 520–600px Drawer

## 1024–1439px
- 3-column Explorer
- sidebar may compact

## Tablet
- 2-column
- filters may move into panel

## Mobile
- 1-column
- Drawer → full-screen sheet

Do not compromise desktop intelligence density to optimize mobile.

---

# 12. Component Map

Prefer reusable production components.

Suggested:
- `AppSidebar`
- `ContextBar`
- `PageHeader`
- `KPIStat`
- `QualityBadge`
- `QualityStrip`
- `FilterToolbar`
- `AdCard`
- `EvidenceCard`
- `StatusBadge`
- `EmptyState`
- `ErrorState`
- `LoadingSkeleton`
- `Tabs`
- `AdDetailDrawer`
- `FactBlock`
- `AIInterpretationBlock`
- `CoverageWarning`

Do not duplicate nearly identical page-local components.

---

# 13. Visual Refactor Boundaries

## MAY CHANGE
- layout
- CSS
- Tailwind tokens
- typography
- spacing
- responsive rules
- visual component composition
- card presentation
- table presentation
- filter presentation
- Drawer presentation
- empty/loading/error presentation

## MUST NOT CHANGE WITHOUT SEPARATE APPROVAL
- DB schema
- migrations
- RLS
- auth semantics
- import pipeline
- validator
- normalizer
- count formulas
- transaction behavior
- snapshot SQL
- API semantics
- data quality formulas
- duplicate rules
- historical observations
- Page identity rules

If a visual requirement seems to require an API/data change:
STOP and report it.
Do not silently change the engine.

---

# 14. Refactor Sequence

Implement as small visual slices.

Recommended:

## Slice V1 — Global shell
- visual tokens
- typography
- AppSidebar
- ContextBar
- PageHeader
- badges / common states

STOP → screenshots + tests

## Slice V2 — Import + Dataset
- Import
- Dataset list
- Dataset detail
- Quality Strip

STOP → screenshots + tests

## Slice V3 — Explorer
- Search
- sticky filters
- 4-column grid
- Table mode
- AdCard

STOP → screenshots + tests

## Slice V4 — Drawer
- 600px layout
- sections
- media fallback
- history
- snapshot/latest labels

STOP → screenshots + tests

## Slice V5 — Final consistency
- loading
- empty
- error
- responsive
- visual consistency

STOP → full test gate

Do not include Phase 2 feature implementation in these slices.

---

# 15. Acceptance Criteria

Visual refactor is accepted only if:

1. Phase 1 functional behavior remains unchanged.
2. Existing integration/security tests remain green.
3. Snapshot E2E still passes.
4. Old Dataset still shows old snapshot after newer import.
5. Dataset Drawer still shows dataset observation.
6. Cross-dataset ad remains 404.
7. Unknown active state remains unknown.
8. Explorer filtering still occurs server-side.
9. Preview still writes nothing.
10. Viewer still receives server 403 for commit.
11. Quality percentages retain denominators.
12. No forbidden metric appears.
13. No Page is automatically treated as Brand.
14. Base44-approved 4-column Explorer is recreated.
15. Ad Drawer is approximately 520–600px on desktop.
16. Media fallback remains safe.
17. XSS/security behavior remains unchanged.
18. No secret/client-bundle regression.
19. lint/typecheck/tests/Playwright/build all pass.
20. Visual screenshots are reviewed after each slice.

---

# 16. Visual Review Deliverables

After every slice, Claude should provide:
- routes changed
- components changed
- before/after screenshots
- any intentional difference from Base44
- tests run
- test counts
- issues discovered
- commit hash

If screenshots cannot be attached directly, store them under a dedicated test-artifact path and report the paths.

---

# 17. Final Instruction to Claude

Recreate the Base44 Revision #2 reference inside the existing PT Glory Phase 1 production app.

Treat Base44 as a UX/UI reference, not as a source of backend truth.

Preserve the existing engine and all verified business/data/security behavior.

When visual design and production behavior conflict, production correctness wins and the difference must be reported rather than silently resolved.

Do not start Phase 2.

---

# Amendment A1 — Color System Override

**Date:** 2026-09-02 · **Status:** approved, higher priority than §4.2
**Scope:** color tokens, brand accent, supporting chart/tag palette, surface treatments — **nothing else**

Everything else in this handoff stands unchanged: App Shell layout, Sidebar structure,
Context Bar, 4-column Ads Explorer, 600px Drawer, Deep Search hierarchy, Page != Brand,
FACT != AI, snapshot behavior, APIs, database, RLS, Phase 1 business rules.

## A1.1 Goal

สด · สนุก · จำง่าย · มี character — mood อ้างอิงจาก JUBI / JOY
แต่ยังเป็น professional internal intelligence tool ไม่ใช่ kids app

## A1.2 Palette

| Role | Token | Hex |
| --- | --- | --- |
| Base cream (app background) | `--paper` | `#F5EEDF` |
| Surface (cards, main) | `--surface` | `#FFF8F1` |
| Soft pink surface (AI, callout) | `--surface-pink` | `#F3E1E8` |
| Primary text | `--ink` | `#2C241F` |
| Secondary text | `--muted` | `#6C5D54` |
| Border | `--line` | `#E8DCCF` |
| **Brand accent** | `--brand` | `#F26522` |
| Brand pressed/hover | `--brand-deep` | `#E95A1F` |
| Coral | `--coral` | `#FF7A66` |
| Pink | `--accent-pink` | `#F2A3CC` |
| Blue | `--accent-blue` | `#19A7F2` |
| Green | `--accent-green` | `#27C98B` |
| Yellow | `--accent-yellow` | `#F5D437` |
| Lavender | `--accent-lavender` | `#B8B4F5` |
| Deep green | `--accent-green-deep` | `#2F5D2E` |

## A1.3 Rules

1. **Orange `#F26522` replaces gold** as the main brand accent — primary CTA, active
   navigation, selected tabs, selected filters, key interaction states, highlights.
2. **Large surfaces stay cream / warm white.** Never a saturated orange/pink/blue page background.
3. **Soft pink is the secondary surface** — AI Interpretation block, secondary callout,
   selected supporting panels, light contextual surfaces.
4. **Bright supporting colors are for charts, tags, categorical groups and signal
   differentiation only.** Not every colour in every card.
5. **Body text is always dark charcoal.** Never orange/pink/yellow for long copy.
6. **Semantic states stay semantic** — active = green, partial/warning = amber/yellow,
   low/error = red, unknown = neutral. Branding never overrides these.
7. **FACT vs AI stays visually distinct** — FACT on neutral warm white, AI on soft pink
   with an explicit AI label.
8. **Charts** may use orange / blue / green / pink / yellow / lavender / deep green,
   still respecting data semantics. Multi-value fields are still not exclusive shares.
9. **Media placeholders stay neutral.** Never colourful fake creative artwork.
10. **Overall:** playful colour + disciplined enterprise layout + dense intelligence
    usability. Not gold luxury SaaS, not pastel kids app, not rainbow dashboard, not
    gradient-heavy startup UI.

## A1.4 Contrast bindings — measured, not assumed

WCAG 2.1 ratios against this palette. These bindings are what make rule 5 and rule 6 work.

| Pairing | Ratio | Verdict |
| --- | --- | --- |
| `--ink` on `--paper` / `--surface` / `--surface-pink` | 13.18 / 14.46 / 12.14 | ✅ AAA |
| `--muted` on `--paper` | 5.46 | ✅ AA |
| `--ink` on `--brand` | 4.83 | ✅ AA — **this is the CTA pairing** |
| White on `--brand` | 3.15 | ❌ fails AA · large text only |
| `--brand` as text on `--paper` | 2.73 | ❌ never use orange for text |
| `--ink` on blue / green / coral / pink / lavender / yellow | 5.69 – 10.41 | ✅ AA on every fill |

**Binding rules that follow:**

- Bright colours are **fills**; charcoal is the text on top of them. This holds for every
  colour in the palette, which is what keeps rule 4 and rule 5 consistent.
- Primary CTA = orange fill + **charcoal** label, not white. A white-on-orange button
  would need `#B84213`, which reads brown and leaves the brand hue.
- Active nav = orange fill + charcoal label + orange left indicator, per §5.
- Colour is never the only carrier of meaning: every status also has text or an icon.

## A1.5 Three tokens the amendment does not supply

Added by necessity, flagged as deviations:

| Token | Hex | Why |
| --- | --- | --- |
| `--brand-ink` | `#A83C10` | Inline links and orange emphasis **as text**. `--brand` at 2.73 is unreadable; this is 5.48 on cream and keeps the hue. |
| `--danger` | `#B3261E` | Rule 6 requires red for low/error but no red is given. 5.66 on cream. |
| `--warn-ink` | `#8A5A00` | Rule 6 requires amber for partial. `--accent-yellow` as text is 1.27; yellow becomes the fill and this the text. 5.13 on cream. |

Semantic text colours: active `--accent-green-deep` (6.67), partial `--warn-ink` (5.13),
low/error `--danger` (5.66), unknown `--muted` (5.46).

`--focus` stays `#1d4ed8` — it is an accessibility affordance, not a brand colour, and
orange at 2.73 cannot serve as a focus ring. On an orange fill the ring needs its existing
`outline-offset` so it lands on cream.

## A1.6 Migration note

Implementation had **not** started when this amendment landed, so it applies from
V1 Global Shell onward. Nothing to rewrite.

Current gold usage is confined to two tokens in `app/globals.css` (`--gold`, `--gold-deep`)
and four call sites (`a` rule in globals, `app/login/page.tsx`, `app/import/import-client.tsx`).
Both gold tokens are removed in V1; the error-text call sites move to `--danger`, which is
what they should have been.
