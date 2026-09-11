# Grill — Phase 15: Collection UX, Apify first

Date: 2026-09-11 · Status: **grill complete, no implementation** · Next: owner go-ahead → `/ptg-spec`

## Goal

A researcher should be able to say "collect ads for this keyword in Thailand"
and get a Dataset, without knowing or choosing how the data is collected. PT
Glory owns that experience end to end. Apify becomes the primary collector
behind it; the Chrome Extension (Network Capture) and manual JSON import stay,
but only as admin/operator fallback and recovery. Whatever the provider, every
row still enters through the existing validator, normalizer and import engine,
so snapshot truth, quarantine, coverage and history behave exactly as they do
today. Provider-reported numbers remain provenance; server-recomputed numbers
remain canonical.

## User journey

**Analyst (start):** `เก็บข้อมูลใหม่` → keyword · country (Thailand) · status
(Active / All where the provider supports it) · maximum records · *category
(missing from the brief — see Q2)* → `เริ่มเก็บข้อมูล`.

**Analyst (wait):** `กำลังเก็บข้อมูล` — ads found so far · elapsed time ·
collector cost if the provider reports it reliably. Leaving the page does not
cancel the run; returning shows the same run.

**Analyst (done):** `เก็บข้อมูลสำเร็จ` — Ads · Pages · Quarantine · Collection
Run · Dataset → `เปิด Dataset`.

**Analyst (failure):** `ไม่สามารถเก็บข้อมูลรอบนี้ได้ · ลองใหม่อีกครั้ง`. No
provider names, run IDs or raw errors.

**Viewer:** sees the resulting Datasets and Collection Runs like any other; never
sees provider internals and cannot start a collection.

**Admin/Operator:** the same flow, plus an expandable technical panel (provider,
provider run ID, error class, duration, retry state — never a token), collector
usage, and the fallback paths (manual import of an Extension export).

## Real data sources

| Brief asks for | Source today | Status |
|---|---|---|
| keyword | `collection_runs.scope_query` | exists |
| country | `collection_runs.scope_country` | exists |
| status (Active/All) | `collection_runs.scope_active_status` | exists; provider support **unverified** |
| maximum records | provider input + `collection_runs.stop_reason` | exists; provider parameter **unverified** |
| category | `datasets.category_id` (required by import) | **not in the brief** |
| Ads / Pages (result) | `computed_unique_ads` / `computed_unique_pages` | exists (canonical) |
| Quarantine | `import_quarantine` + `computed_unresolved_count` | exists |
| Collection Run / Dataset | `collection_runs` / `datasets` rows | exists |
| Ads found (live) | provider run item count | **provider-reported**, provenance only |
| Pages found (live) | would need reading items mid-run | **not reliable** — propose showing at completion |
| Elapsed time | request start time | new column |
| Collector cost per run | provider run usage | **provider-reported, unverified** |
| Monthly usage / remaining credit | provider account API | **unverified** |
| Collection runs / ads collected | our DB (runs by provider) | derivable |
| Cost per run / per 1,000 ads | stored run cost ÷ `computed_unique_ads` × 1000 | derivable once cost is stored |

**Field mapping: now evidenced by a real run** — see
`SPIKE_2026-09-11_APIFY_SAMPLE.md`. One owner-run sample (59 items) covers every
displayed key, and the 27 ads it shares with the Pilot agree with the Extension
on every compared field. The mapping is a key allowlist, an epoch→ISO date
conversion and a forbidden-key strip.

## Derived rules

- Provider-reported counts go to `reported_*`; the import engine's recomputed
  `computed_*` stay canonical — as for the Extension today.
- Cost per 1,000 ads = stored run cost ÷ `computed_unique_ads` × 1000, shown
  only when the provider reported a cost for that run. Currency as reported;
  no invented exchange rate (Q5).
- A run that stopped at the maximum records is `partial` with a stop reason, not
  `completed`, because the provider was cut off, not exhausted.
- Collector cost is labelled `ค่าเก็บข้อมูล` / Collector usage. It is never
  called ad spend, media spend or advertising budget.

## Unsupported requests

- Any provider field resembling reach, impressions, spend ranges or other
  performance data is dropped at normalization (the existing `DROPPED` list) and
  never displayed.
- Live "Pages found" during a run — not reliable without per-item reads;
  proposed: Ads found live, Pages at completion.
- Roles "Ads", "Content" and "Operator" do not exist; the model is
  viewer / analyst / admin (Q4).
- "Remaining credit" depends on the Apify plan exposing it through its API —
  to verify against the real account.

## Architecture impact

- **Database:** a new `collection_method` value for Apify (today a CHECK list:
  `network_response_observation`, `user_initiated_dom_observation`,
  `socialapis_api`); a new `collection_requests` table (requested_by, provider,
  provider run ID, parameters, status, error class, admin-only error detail,
  timings, provider-reported count and cost, resulting run and dataset) with RLS
  and explicit grants in the 0036 style.
- **Server:** start endpoint (analyst) → provider start → store request;
  completion by provider webhook to a machine-authenticated callback (reusing
  `authenticateMachine`) or by a scheduled poll (pg_cron, as for the media
  drain); fetch results → provider adapter → existing `validate` → `normalize`
  → `commitImport` → existing media queue. Idempotent by provider run ID.
- **Runtime:** routes are capped at 300 s and a provider run takes minutes, so
  the run can never live inside one request.
- **Provider abstraction:** Collection Request → Collector Provider (Apify now)
  → normalized result → Import Engine. The manual file path remains the second
  implementation, admin-only.
- **UI:** a collection page (form → progress → result); role-aware navigation
  (`NavItem` has no role today); `นำเข้าข้อมูล` removed from normal navigation
  and `/import` moved to admin; admin diagnostics; a collector-usage view.
- **Security:** the Apify token is server-only, never `NEXT_PUBLIC_*`, never
  logged; the callback needs its own secret; raw provider errors and run IDs
  are admin-only; media URLs from Apify still pass the existing `fbcdn.net`-only
  allowlist; tests never call Apify (the zero-cloud watcher gains the Apify
  host; a provider mock is used, as TEST_STRATEGY already expects).

## Edge cases

Zero results · max records reached · provider run fails, times out or is aborted ·
provider unavailable · duplicate submission of the same query · two analysts
start the same query · webhook replayed or delivered before the request row
exists · callback never arrives · items without `ad_archive_id` (quarantine) ·
non-fbcdn media URLs (rejected) · provider output schema changes (pin the actor
build) · cost not reported · a very large run exceeding the import window ·
country other than Thailand · a viewer calling the start endpoint directly.

## Acceptance criteria

1. An analyst can start a collection from one form and reach the resulting
   Dataset without seeing a provider name.
2. Every collected row passes the existing validator, normalizer and import
   engine; no provider writes a product table.
3. Result counts are the server-recomputed ones; provider counts are stored only
   as provenance.
4. A failure shows the friendly message to non-admins and the technical panel
   to admins, with no secret in either.
5. Viewers cannot start a collection (server-enforced 403); only admins see
   diagnostics, fallback and manual import.
6. The Extension and manual import are absent from normal navigation and forms.
7. Cost is labelled as collector usage and appears only when reported.
8. Replayed or duplicate completions import once.
9. No test contacts Apify; the Apify token never reaches the client bundle.

## Test plan

Unit: adapter mapping against a fixture captured from a **real** run; error
mapping to user/admin messages; cost-per-1,000 formula. DB: `collection_requests`
RLS and grants; new `collection_method` value. Integration: mocked provider —
success, partial, failure, timeout, replay. E2E: form → progress → result on a
mocked provider; viewer 403; admin panel visibility. Security: token absent from
the client bundle; watcher shows no Apify contact during tests.

## Owner decisions (2026-09-11)

1. **Actor:** Claude researches public Meta Ad Library actors against the data
   contract from their published output schemas and recommends one. The owner
   approves before any paid run.
2. **Category:** a required `หมวดหมู่` select in the collection form, same list
   as today's import.
3. **Cost guardrails:** the server clamps maximum records per run and refuses
   new runs once an admin-set monthly budget is reached.
4. **Roles:** manual import becomes admin-only; no new role — admin covers
   Operator duties. Analysts start collections but lose manual file import.

5. **Primary actor:** `curious_coder/facebook-ads-library-scraper`;
   `apify/facebook-ads-scraper` is the second provider behind the same
   abstraction.
6. **Sample run:** the owner runs it once in the Apify Console with the input
   Claude supplies, exports the dataset as JSON and shares the file path. No
   Apify token passes through Claude or the server during the spike.

7. **Cost currency:** USD exactly as Apify reports it; no exchange rate.
8. **Collector usage view:** admin only. Analysts see only a refusal message
   when the monthly budget is reached.
9. **Dataset naming:** pre-filled as keyword · country · date, editable by the
   analyst before starting.

## Still open

- The actual charge of the 2026-09-11 sample run (from the Apify Console), to
  confirm the published price before the budget guard is specified.

## Actor research (2026-09-11, from published Apify Store pages — not yet from a run)

Scored against `lib/collector/contract.ts`: required `page_id`, `start_date`;
known snake_case `AD_KEYS`; `FORBIDDEN_KEYS` include `spend`, `currency`,
`reach_estimate`, `impressions_with_index`.

| Actor | Keeps the Ad Library `snapshot` | Coverage of our keys | Inputs | Price / 1,000 ads | Maintainer · users · rating |
|---|---|---|---|---|---|
| `curious_coder/facebook-ads-library-scraper` | yes, snake_case | collation, page likes, categories, display format, images, videos, cards | `urls` (Ad Library search/Page URLs, required), `limitPerSource` (may exceed by up to 30), `scrapeAdDetails` | $0.75 pay-per-event | community · 40.3k (5.5k monthly) · 4.77 · updated 2026-01-30 |
| `apify/facebook-ads-scraper` | yes, camelCase | same set | `startUrls` (required), `resultsLimit`, `activeStatus`, date range, `isDetailsPerAd`, `includeAboutPage`, `enrichWithEcommerceData` | $3.40–5.80 pay-per-result | Apify (official) · 35.6k · 4.19 |
| `automation-lab/facebook-ads-library` | flattened | no `collation_id`; cards only as a count | keywords, country, status, media; cap 500 | ~$0.50 + $0.005/run | community · 1.7k · 4.46 |
| `scrapeio/…-premium` | no | no snapshot, collation, page likes, display format | keyword, page, URL | $15.00 | community · 990 |
| `data_ops_main/meta-ads` | fields not stated | — | keyword, country | $1,000.00 | 64 users |

Every candidate emits spend / impressions / reach when Meta provides them (per
the actors, only for social-issue, electoral or political ads). The Graph-API
actors were not shortlisted: Meta's Ad Library API returns commercial ads only
for EU delivery, so Thai commercial ads are unlikely to be covered (to verify
if ever reconsidered).

**Recommendation:** `curious_coder/facebook-ads-library-scraper` as the primary
provider — it preserves Meta's own snapshot structure in snake_case (closest to
what the Extension already captures), covers every key the product displays,
is the cheapest and the most used. `apify/facebook-ads-scraper` is the second
provider behind the same abstraction, for continuity if the community actor
breaks. Pin the actor build; keep a captured fixture test on the adapter.

**Design consequences:**

- The validator rejects a whole file on any unknown or forbidden key
  (`unknown_field … carries forbidden metric`). The Apify adapter therefore maps
  an allowlist of `AD_KEYS` *before* validation and discards everything else;
  only the names of discarded keys are kept, as provenance.
- Neither finalist takes a keyword field; both take Ad Library search URLs. The
  server builds one deterministic URL from the form (keyword, country, status),
  stored in `collection_runs.source_url` and the `scope_*` columns.
- Forced off: `scrapeAdDetails` / `isDetailsPerAd` (EU reach, spend),
  `includeAboutPage` (Page profile crawling), `enrichWithEcommerceData`
  (advertiser landing-page crawling).
- Budget estimates use `limit + 30` for the curious_coder overshoot.

**Proposed sample run (needs owner approval — it costs credits):** one keyword
already in the Pilot, country TH, active only, limit 50 → about 80 ads ×
$0.75/1,000 ≈ **US$0.06**. Exported as JSON, it becomes the adapter fixture and
the field-coverage report.

## Recommended next step

Large feature. After answers: `/ptg-spec`, then `/ptg-architecture`, then
tickets. The first ticket should be a spike that captures one real Apify run
into a fixture and reports field coverage against the data contract — before
any UI is built.
