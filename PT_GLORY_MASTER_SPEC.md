# PT Glory Intelligence — Master System Specification

## 1. Product Definition

PT Glory Intelligence is an internal Competitive Advertising Intelligence platform focused initially on Meta Ads Library data.

The system should answer questions such as:

- Which pages/brands are increasing ad activity?
- Which creatives are newly found, long-running, or heavily reused?
- Which formats, CTAs, prices, promotions, hooks, pain points, and offers appear most often?
- How do Brand A and Brand B differ?
- How has a category changed between two datasets or time periods?
- Which ads support an AI-generated insight?

It must not pretend to know ad performance when the source does not provide performance data.

## 2. Collector Sources

Initial supported sources:

- PT Glory Chrome Extension — network-response observation from Meta Ads Library
- SocialAPIs — optional backend collector later
- Future collectors normalized into the same data contract

Secrets for third-party collectors must remain server-side.

## 3. Fields Proven Available from PT Glory Network Collector

Examples of fields already observed in real exports:

- `ad_archive_id`
- `collation_id`
- `collation_count`
- `page_id`
- `meta_page_id`
- `page_name`
- `page_profile_uri`
- `page_profile_numeric_id`
- `page_like_count`
- `page_categories[]`
- `is_active`
- `start_date`
- `network_end_date_raw`
- `display_format`
- `cta_type`
- `cta_text`
- `title`
- `body_text`
- `caption`
- `link_url`
- `link_description`
- `publisher_platform[]`
- `images[]`
- `videos[]`
- `cards[]`
- collection metadata

Media objects can contain original/resized image URLs and HD/SD/preview video URLs when provided by the upstream response.

## 4. Important Interpretation Rules

### Active ad end date

A network response may expose a date that resembles an end date while `is_active = true`. Do not interpret this raw network value as a confirmed ad-stop date.

Normalized rule:

- if active: normalized `end_date = null`
- keep source value separately as `network_end_date_raw`

### Meta Page ID vs Profile numeric ID

`page_id` / `meta_page_id` can differ from the numeric ID embedded in `page_profile_uri`.

Store them separately.

### Platform and categories

Both are arrays. One ad/page can belong to multiple values.

### Market activity vs market share

Ad count in a dataset may be described as:

- observed ad activity
- share of observed ads

Do not label it spend share, sales share, or true market share.

## 5. Core Entity Model

### Category

Business/research grouping such as `วิตามินผู้หญิง`.

### Dataset

A saved logical dataset/import used for analysis and comparison.

### Collection Run

One collection execution with source/query/config/status/timing/results.

### Ad

Master ad entity keyed primarily by `ad_archive_id`.

### Dataset Ad

Many-to-many membership connecting ads to datasets.

### Ad Observation

Point-in-time observation of changeable ad state.

### Page

Master Meta Ads Library page identity.

### Page Observation

Point-in-time page metrics such as page likes.

### Brand

Business entity manually/semiautomatically mapped from one or more pages.

### Creative

Normalized creative asset/fingerprint layer for reuse/creative analysis.

### AI Analysis Run

Versioned AI job with model, prompt version, filters, cost, result, evidence.

### AI Evidence

Links an AI insight back to source ads/observations.

### Tag / Taxonomy

Controlled classifications for pain point, hook, offer, angle, target, etc.

### Watchlist

Tracked page, brand, creative, ad, category, or query.

## 6. Suggested Database Tables

- `categories`
- `datasets`
- `collection_runs`
- `pages`
- `page_observations`
- `brands`
- `brand_pages`
- `ads`
- `ad_observations`
- `dataset_ads`
- `creatives`
- `creative_assets`
- `ad_creatives`
- `taxonomies`
- `tags`
- `ad_tags`
- `ai_analysis_runs`
- `ai_insights`
- `ai_evidence`
- `watchlists`
- `watchlist_items`
- `saved_views`
- `background_jobs`
- `audit_logs`

## 7. Deterministic Intelligence

Compute in code/SQL, not via AI:

- total ads
- unique pages
- unique mapped brands
- new ads 7/14/30 days
- first seen / last seen
- ad age
- active/inactive
- evergreen threshold
- creative reuse / collation
- newly found
- format distribution
- CTA distribution
- platform coverage
- category coverage
- ads per page
- ads per brand
- page-like statistics
- repeated copy
- extracted prices
- promotion-rule matches
- data field coverage
- collection completeness

## 8. AI Intelligence

Use AI for interpretation/classification:

- Pain Point
- Hook
- Offer
- Angle
- Message Strategy
- Positioning
- Creative Pattern
- Opportunity
- Recommendation

AI output should be structured and versioned.

Suggested insight fields:

- `insight_type`
- `label`
- `summary`
- `count`
- `denominator`
- `percentage`
- `coverage`
- `confidence`
- `evidence_ad_ids[]`
- `prompt_version`
- `model`

Counts/percentages should be calculated by deterministic code from classifications/evidence, not invented by model prose.

## 9. Deep Search

Primary interaction:

> วันนี้อยากรู้อะไรเกี่ยวกับตลาดนี้?

Flow:

1. Understand question
2. Resolve category/dataset/filter context
3. Query database
4. Compute deterministic metrics
5. Retrieve only relevant copy/records
6. Call AI if interpretation is needed
7. Validate evidence and denominators
8. Render a structured research answer
9. Save research history

Do not send full raw collector JSON including large media URLs/debug fields to the model by default.

## 10. Overview Dashboard

Context bar:

- Category
- Dataset
- Source
- Collected At
- Data Quality

Core KPIs:

- Ads ทั้งหมด
- Pages ที่พบ
- Ads ใหม่ 30 วัน
- Evergreen
- Creative Reuse

Recommended sections:

- Ads Started Timeline
- Format distribution
- CTA distribution
- Platform coverage
- Top Pages / mapped Brands
- Price / Promotion
- Creative Signals
- AI Intelligence with Evidence
- Recent Ads
- Recent Collection Runs

Avoid total Page Likes as a headline KPI unless the product explicitly needs it. Prefer median/top page likes or per-page values because summing likes across unrelated pages is usually not a meaningful market metric.

## 11. Creative Signals

### Emerging

Recently started and/or recently first-seen according to an explicit configurable rule.

### Evergreen

Active ad with age >= configurable threshold, e.g. 90 days.

### Most Reused

High `collation_count` / creative reuse evidence.

### Newly Found

First observed in latest collection run.

Do not call these "winning ads" without real performance data.

## 12. Ad Detail Drawer

Display only real/derived fields:

- Creative/media
- Ad Archive ID
- Page
- mapped Brand
- Page Likes
- Start Date
- Ad Age
- First Seen / Last Seen
- Active Status
- Format
- Platform
- CTA
- Collation
- Categories
- Copy
- Headline
- Destination
- Historical Observations
- AI Tags
- AI Evidence
- Watchlist control

## 13. Data Quality

Track coverage per dataset/run, at minimum:

- ad_archive_id
- page_id/page_name
- page_like_count
- start_date
- format
- CTA
- body copy
- title
- destination
- platform
- categories
- media
- collation

Quality rules:

- >= 80%: normal use
- 50–79%: partial/warning
- < 50%: avoid representative claims unless explicitly scoped to readable subset

These thresholds are defaults and should be configurable.

## 14. Import Pipeline

Flow:

Create/select Category
→ Import JSON
→ Validate schema
→ Preview
→ Normalize
→ Duplicate detection
→ Upsert master entities
→ Create dataset membership
→ Write observations
→ Compute quality
→ Save
→ Open Dataset

Default duplicate strategy:

- one master ad per `ad_archive_id`
- retain new observation history
- update current snapshot fields when appropriate
- never discard historical observation just because master ad already exists

## 15. Background Jobs

Long-running tasks should be modeled as jobs:

- queued
- running
- completed
- failed
- partial
- cancelled

Support retry/resume where appropriate.

Closing the browser should not corrupt an import/analysis job.

## 16. AI Run Versioning and Cost

Store:

- dataset/category context
- filters
- model
- prompt version
- input tokens
- output tokens
- estimated cost
- start/end time
- result
- evidence
- evaluation status

Cache/reuse an identical result when dataset version, filters, prompt version, and model inputs are unchanged.

## 17. Security

Keep external provider credentials server-side.

Use RLS/authorization for company users.

Never persist captured browser-session secrets from Meta network diagnostics into normal application data.

Use audit logging for destructive/important operations.

Use soft delete for business data where accidental deletion would be harmful.

## 18. Testing Strategy

Critical journeys need browser-level E2E tests.

Example journey:

Login
→ create/select Category
→ import 500-ad JSON
→ preview
→ save
→ open Dataset
→ filter Ads
→ open Ad Drawer
→ return Overview
→ run AI Analysis
→ open Evidence

Golden deterministic collector fixtures should detect parser/schema regressions.

AI evaluation datasets should detect prompt/model quality regressions.

## 19. Roadmap

### Phase 1

Foundation + schema + import pipeline + Ads Explorer

### Phase 2

Overview + deterministic intelligence + data quality

### Phase 3

AI analysis + evidence + history

### Phase 4

Deep Search

### Phase 5

Competitor + Creative Intelligence + Compare + Watchlist + Historical

### Later

Automatic SocialAPIs collection, alerts, semantic search, optional Voice of Customer if a legitimate post/comment source is proven.

## 20. Explicit Non-Goals Until Source Exists

Do not implement real-data UI for:

- Engagement
- Reaction
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

These can only be enabled later behind a source capability flag after a real provider supplies them.
