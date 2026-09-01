# PT Glory Intelligence — Project Instructions

## Mission

Build an internal company system named **PT Glory Intelligence** for collecting, storing, searching, comparing, and analyzing Meta Ads Library data collected by PT Glory.

This is not a generic analytics dashboard and not a public SaaS product. It is an internal Competitive Advertising Intelligence system.

## Mandatory Operating Rules

### 1. Investigate before changing code

Before making claims about existing implementation, open and inspect the relevant files. Never speculate about code that has not been read.

### 2. Real-data-only UI

Every KPI, chart, badge, percentage, table column, and AI claim must trace back to either:

- a real stored source field, or
- a deterministic formula documented from real fields, or
- an explicitly labeled AI interpretation with evidence.

If a metric cannot be traced, do not implement it.

### 3. Never invent unavailable performance data

Unless a future source explicitly provides it, the system must NOT claim or display:

- Ad engagement
- Ad reactions / likes
- Comments
- Shares
- Reach
- Impressions
- Spend
- CTR
- CPC
- CPA
- ROAS
- Sales
- Conversion
- Market share

Do not infer any of these from ad count, ad age, collation, page likes, or creative reuse.

### 4. Internal-only product

Do not build:

- billing
- subscriptions
- packages
- user credits
- referral programs
- invite-for-credit
- upgrade-to-pro flows

Authentication and internal role permissions are allowed and expected.

### 5. Facts vs AI interpretation

Always separate:

- **FACT** = database value or deterministic calculation
- **AI INTERPRETATION** = model-generated classification or strategic interpretation

AI must not generate its own denominators, counts, or percentages.

### 6. Evidence-first AI

Every AI insight must retain evidence references to the ads/dataset records used to support it.

Example:

- Hook: Fear / Problem
- Found in: 173 / 500 ads
- Percentage: 34.6%
- Evidence: list of `ad_archive_id`

### 7. Data quality matters

Never present a partial field as if it covers the entire dataset.

Example:

- Correct: `CTA readable 485 / 500 ads (97% coverage); among readable ads, 42% use Send Message.`
- Incorrect: `42% of all market ads use Send Message.`

### 8. Multi-value fields

`publisher_platform` and `page_categories` are multi-value fields.

Their percentages do not have to add up to 100%. Do not visualize them as mutually exclusive shares unless transformed into a documented exclusive grouping.

### 9. Page is not Brand

A Brand can map to multiple Pages. Do not treat `page_name` as the definitive brand identity.

Human-reviewable Page → Brand mapping is required.

### 10. One Ad can belong to many Datasets

Use a master Ad entity plus dataset membership. Do not duplicate the master ad every time the same `ad_archive_id` appears in another collection or search.

### 11. Historical observations are first-class data

Keep observations over time for fields that can change, including:

- active state
- page likes
- collation count
- observed media/copy metadata
- first seen
- last seen

Do not overwrite history with only the latest value.

### 12. Avoid overengineering

Implement only what is required by the approved spec/ticket. Do not create speculative abstractions or extra features.

### 13. Vertical slices

Prefer complete user journeys over building all database/backend/frontend layers separately.

Example first vertical slice:

JSON Import → Supabase → Dataset → Ads Explorer → Ad Detail Drawer

## Source of Truth Order

1. Actual Collector JSON / actual production database
2. `docs/DATA_CONTRACT.md`
3. `docs/PRODUCT_SPEC.md`
4. `docs/ARCHITECTURE.md`
5. Approved ticket/spec
6. `docs/UX_SPEC.md`
7. Mockups
8. AI assumptions

If sources conflict, stop and report the conflict instead of guessing.

## Required Development Workflow

### Small task

`/ptg-grill` → implement → tests → `/ptg-code-review`

### Large feature

`/ptg-grill`
→ `/ptg-spec`
→ `/ptg-architecture`
→ `/ptg-tickets`
→ implement one ticket at a time
→ `/ptg-edgecase`
→ tests
→ `/ptg-code-review`
→ `/ptg-security`
→ `/ptg-playwright`
→ `/ptg-release-gate`
→ `/ptg-golive`

### Bug

`/ptg-debug`
→ reproduce
→ add failing regression test
→ fix root cause
→ run regression
→ review

### Database change

`/ptg-db-change`
→ migration
→ test against database
→ rollback plan
→ review
→ deploy

### AI change

`/ptg-ai-change`
→ golden/evaluation dataset
→ prompt/model change
→ evaluation
→ evidence check
→ token/cost check
→ deploy

## Production Test Expectations

Production-grade work should include as applicable:

- Unit tests
- Integration tests
- E2E tests through a real browser
- Database integration tests
- Deterministic fixtures
- External provider mocks
- Lint
- Type check
- Build
- Authentication tests
- Authorization tests
- Server-side business-rule tests
- Migration verification
- Rollback plan
- Regression tests

Tests must prove critical journeys work. A high test count alone is not success.

## Security Rules

Never expose these to client/browser code:

- SocialAPIs secret/token
- AI provider secret
- Supabase service-role key
- Meta session cookie
- Meta authorization/session tokens
- CSRF/session material captured from browser traffic

Validate authorization and business rules on the server, not only in the UI.

## UX Direction

Main visual direction:

- Thai-first language
- warm cream/off-white background
- gold accent
- dark text
- left sidebar
- compact context bar
- rounded cards
- dense but readable analytical layout
- tables + charts + cards
- evidence drill-down
- right-side Ad Detail Drawer

The UI style may be inspired by social-listening/intelligence dashboards, but metrics must be replaced with PT Glory's actual data model.

## Product Navigation

### Main

- หน้าหลัก
- Deep Search

### Data

- หมวดหมู่
- Dataset
- Ads Explorer
- เพจ / แบรนด์
- Creatives

### Intelligence

- ภาพรวมตลาด
- คู่แข่ง
- Creative Intelligence
- Pain Point / Hook / Offer
- ราคา & Promotion
- แนวโน้ม
- Compare
- Watchlist

### System

- นำเข้าข้อมูล
- Collection Runs
- Data Quality
- AI Analysis History
- Unmapped Pages
- Settings

## Core Build Order

1. Foundation and schema
2. Import pipeline
3. Ads Explorer + Ad Detail Drawer
4. Overview dashboard
5. Deterministic intelligence
6. AI analysis
7. Deep Search
8. Competitor intelligence
9. Creative intelligence
10. Compare
11. Watchlist
12. Historical analysis
13. Optional future Voice of Customer only when a real comment/post source exists

## Before Coding Any Large Feature

Produce and get approval for:

1. Goal and user journey
2. Inputs and outputs
3. Real source fields used
4. Derived formulas
5. Data-quality requirements
6. Database/API impact
7. Security impact
8. Edge cases
9. Acceptance criteria
10. Test plan
11. What cannot be supported by current data

Do not start implementation until the feature is sufficiently specified.
