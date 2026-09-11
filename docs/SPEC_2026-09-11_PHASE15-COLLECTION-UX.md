# Spec — Phase 15: Collection UX, Apify first

Date: 2026-09-11 · Status: **approved with amendments (2026-09-11) — no implementation** ·
Inputs: `GRILL_2026-09-11_PHASE15-COLLECTION-UX.md`, `SPIKE_2026-09-11_APIFY_SAMPLE.md`,
the owner's 15 frozen requirements (quoted as **R1–R15** below).

**Review outcome (owner, 2026-09-11).** Approved with amendments:
A — the progress-page nudge and the scheduled sweep share one idempotent state
machine with a DB claim/lease; no browser action can create provider cost twice.
B — provider internals are protected server-side through a user-safe projection,
never by UI hiding. Decisions: inactive `end_date` approved with guard;
zero-result creates no Dataset; `source_exhausted` approved; the budget window
follows a configurable billing-cycle anchor (not calendar months);
`max_concurrent` server-authoritative, initial 1; neutral provenance labels for
all non-admin views, including historical Extension data. The sample run's
actual cost stays TBD and does not block architecture.

---

## 1. Problem / Goal

Researchers get new Meta Ad Library data only by running the Chrome Extension
and uploading its file. Phase 15 gives them one PT Glory-owned action —
`เก็บข้อมูลใหม่` — that returns a Dataset without exposing how it was collected.
Apify (`curious_coder/facebook-ads-library-scraper`) does the collecting behind
a provider abstraction; every row still enters through the existing validator,
normalizer and import engine, so snapshot truth, quarantine, coverage and history
are unchanged.

## 2. Scope

- A collection form, progress view and result view for analysts and admins.
- A server-side provider abstraction with one production implementation (Apify,
  primary actor) and one test-only mock.
- The PT Glory Apify Adapter: Apify items → a PT Glory export file that the
  existing `previewImport` → `commitImport` → `enqueueRun` chain accepts
  unchanged.
- A `collection_requests` ledger table, a scheduled advance job, and admin-only
  diagnostics.
- Collector cost accounting in USD, a per-run cap and a monthly budget, all
  server-enforced.
- Role changes: manual import becomes admin-only; navigation becomes role-aware.
- Neutral display labels for collection provenance shown to non-admins.

## 3. Non-goals

- Implementing the backup actor (`apify/facebook-ads-scraper`). The abstraction
  admits it; nothing else is built for it now.
- Apify webhooks (the scheduled advance and advance-on-view are sufficient).
- Recurring or scheduled collections, alerts, auto-created categories.
- Countries other than Thailand in the first release (a config list, see §8).
- New canonical ad fields for Apify-only data (R5): `page_profile_picture_url`,
  `contains_digital_created_media`, `targeted_or_reached_countries`, etc.
- Displaying Apify account "remaining credit" (unverified API; the product's own
  ledger is the canonical accounting).
- Any change to the import engine contract (R6) or to the Extension itself.
- The pending `schema_migrations` exposure fix (separate, awaiting approval).

## 4. User journey

**Analyst — start.** Navigation shows `เก็บข้อมูลใหม่`. Form:

| Field | Control | Rule |
|---|---|---|
| คำค้น (keyword) | text | required, 1–100 chars, trimmed |
| ประเทศ (country) | select | allowlist from settings; first release: Thailand only |
| สถานะโฆษณา | select | `กำลังแสดง` (active) · `ทั้งหมด` (all) |
| จำนวนสูงสุด | number | 1 … `collector.max_records_per_run` |
| หมวดหมู่ | select | **required**, explicitly chosen, no default (R8) |
| ชื่อ Dataset | text | pre-filled `{keyword} · {country} · {Thai date}`, editable, 1–200 chars (R9) |

`เริ่มเก็บข้อมูล` → progress view.

**Analyst — wait.** `กำลังเก็บข้อมูล`: ads found so far (provider-reported,
labelled as such), elapsed time. Leaving the page does not stop anything;
returning (or opening it from the list of own collections) shows the same state.
No cost is shown to analysts (owner decision 8).

**Analyst — done.** `เก็บข้อมูลสำเร็จ`: Ads, Pages, Quarantine count, status
(complete / partial with reason), links to the Collection Run and
`เปิด Dataset`.

**Analyst — failure.** `ไม่สามารถเก็บข้อมูลรอบนี้ได้ · ลองใหม่อีกครั้ง` with a
`ลองใหม่` button that pre-fills the form. No provider name, run ID or error text.

**Analyst — refused.** Budget reached: `รอบเก็บข้อมูลของเดือนนี้เต็มแล้ว ติดต่อผู้ดูแลระบบ`.
Collection not yet configured: `ยังเปิดใช้การเก็บข้อมูลไม่ได้ ติดต่อผู้ดูแลระบบ`.

**Viewer.** Sees resulting Datasets and Collection Runs exactly as today. No
`เก็บข้อมูลใหม่`, no progress views, no provider internals. Direct API calls → 403.

**Admin.** Everything above, plus: an expandable technical panel on each request
(provider, actor, build, provider run ID, error class, duration, retry state,
reported cost — never a token); `ค่าเก็บข้อมูล` (Collector usage); collector
settings; `นำเข้าไฟล์ (กู้คืนระบบ)` — today's manual import, moved (R11, R15).

## 5. Data inputs

| Input | Source | Stored as |
|---|---|---|
| keyword, country, active status, max records | form, validated server-side | `collection_requests.params`; then `collection_runs.scope_*` via the export's `scope` |
| category | form | `collection_requests.category_id` → `commitImport.categoryId` |
| dataset name | form | `collection_requests.dataset_name` → `commitImport.datasetName` |
| Ad Library URL | built by the server (§7.1) | `collection_requests.source_url`; export `source.url` → `collection_runs.source_url` |
| Apify items | Apify dataset of the run | transient; never stored raw |
| Provider item count, run state, cost | Apify run object | `collection_requests` (admin columns) |
| Budget, cap, price estimate, actor build, countries | `app_settings` (admin) | read by the server |

Country comes from the request scope, never from `snapshot.country_iso_code` (R7).

## 6. Source field map (adapter)

Evidence: `SPIKE_2026-09-11_APIFY_SAMPLE.md` (59 items; 27/27 agreement with the
Extension on every compared field).

### 6.1 File level (PT Glory export, `lib/collector/contract.ts`)

| Export key | Value |
|---|---|
| `schema_version` | `SCHEMA_VERSION` (`pt-glory-meta-ad-library-export.v1`) |
| `generated_at` | ISO time the adapter finished reading the provider dataset |
| `source.product` | `PT Glory Collector` (neutral) |
| `source.collection_method` | `apify_actor_run` (new, §9) |
| `source.url` | the server-built Ad Library URL |
| `source.completeness_claim` | `Ads returned by an automated Ad Library search for this query, up to the requested limit; not every ad Meta holds for it.` |
| `scope` | `{ country, query, active_status, ad_type: "all", media_type: "all" }` from the request |
| `stop_reason` | `limit_reached` when the provider returned ≥ the requested maximum. `source_exhausted` (new, approved) **only** when the provider shows the search was genuinely exhausted — the run succeeded and the items returned reach the provider's reported total for the query (the sample carries `total` / `ads_count`; their meaning is verified in the adapter ticket). Otherwise `null` (unknown). The two are never conflated. `collection_runs.stop_reason` has no CHECK, so no migration is needed |
| `source_rows`, `unique_ads`, `unique_pages`, `unresolved_count` | `computeCounts()` of the file being emitted — so `count_mismatch` cannot fire |
| `quality_summary` | `{ collection_request_id, provider_item_count, duplicates_removed, unresolved_reasons, discarded_key_count, forbidden_key_names }` — our own request UUID (the exactly-once key, §9) plus counts and key *names*; no provider identity, run ID or cost |
| `ads` | mapped rows (§6.2) |
| `unresolved_ads` | rows the validator would otherwise reject (§6.3) |

### 6.2 Ad row (allowlist — R1)

| Contract key | Apify path | Rule |
|---|---|---|
| `ad_archive_id` | `ad_archive_id` | string |
| `page_id` | `page_id` | string |
| `page_name` | `page_name` | |
| `page_like_count` | `snapshot.page_like_count` | number or null |
| `page_categories` | `snapshot.page_categories` | array of strings |
| `page_profile_uri` | `snapshot.page_profile_uri` | |
| `collation_id` | `collation_id` | string or null |
| `collation_count` | `collation_count` | integer or null |
| `is_active` | `is_active` | boolean |
| `start_date` | `start_date` | epoch seconds → ISO 8601 UTC (R3) |
| `start_date_raw` | `start_date` | the same ISO string (existing provenance format) |
| `end_date` | `end_date` | `is_active === true` → **null** (R4). `is_active === false` and a valid epoch → that instant as ISO (approved). Absent or invalid, or `is_active` absent → **null** (unknown). **Never** the collection time |
| `network_end_date_raw` | `end_date` | the upstream value as ISO whenever it is a valid epoch, as raw provenance only (R4); null otherwise |
| `display_format` | `snapshot.display_format` | |
| `publisher_platform` | `publisher_platform` | array, kept multi-value, upper-case as supplied |
| `cta_type` / `cta_text` | `snapshot.cta_type` / `snapshot.cta_text` | |
| `title` | `snapshot.title` | |
| `body_text` | `snapshot.body.text` | |
| `caption` | `snapshot.caption` | |
| `link_url` | `snapshot.link_url` | |
| `link_description` | `snapshot.link_description` | |
| `images` | `snapshot.images[]` | each object reduced to `original_image_url`, `resized_image_url` |
| `videos` | `snapshot.videos[]` | reduced to `video_hd_url`, `video_sd_url`, `video_preview_image_url` |
| `cards` | `snapshot.cards[]` | reduced to `title`, `body`, `caption`, `cta_type`, `cta_text`, `link_url`, `link_description`, `original_image_url`, `resized_image_url`, `video_hd_url`, `video_sd_url`, `video_preview_image_url` |

Not emitted: `meta_page_id`, `page_profile_numeric_id` (the provider does not
supply them), `record_key`, `raw_evidence`, `_pt_glory`, `page_aliases`,
`end_date_raw`.

**Everything else is discarded before validation**, including the forbidden
metrics present on every sample item — `spend`, `currency`, `reach_estimate`,
`impressions_with_index` (and `total_active_time`) — which are never persisted
anywhere (R2). Only the count of discarded keys and the names of forbidden keys
seen reach `quality_summary`.

### 6.3 Row routing (so the validator never rejects a whole file)

| Condition | Destination |
|---|---|
| `ad_archive_id` missing or blank | `unresolved_ads` (quarantine reason `unresolved_source_record`) |
| `page_id` or `start_date` missing, or `start_date` not a finite number | `unresolved_ads` |
| same `ad_archive_id` seen earlier in the run | dropped; counted in `duplicates_removed` |
| otherwise | `ads` |

If the adapter's output still fails `validate()`, the request fails with
`adapter_rejected` (an engineering defect, not a data condition); nothing is
imported.

## 7. Deterministic formulas and rules

### 7.1 Ad Library URL

```
https://www.facebook.com/ads/library/?active_status={active|all}&ad_type=all
  &country={CC}&is_targeted_country=false&media_type=all
  &q={encodeURIComponent(keyword)}&search_type=keyword_unordered
  &sort_data[direction]=desc&sort_data[mode]=total_impressions
```

The same shape as both existing Pilot runs and the spike (proven).

### 7.2 Provider input

`{ urls: [<URL>], limitPerSource: maxRecords, scrapeAdDetails: false }`, with the
total-records field left empty. The run is started with the pinned
`collector.actor_build`, a run timeout (`collector.run_timeout_minutes`), and —
**if the Apify run API supports it for this pay-per-event actor (to verify in the
first ticket)** — `maxTotalChargeUsd` set to the run's estimate. The exact JSON
shape of `urls` is taken from the actor's input schema during implementation.

### 7.3 Cost

- Canonical accounting: the USD cost Apify reports for the finished run (R12),
  stored as `cost_usd` (admin-only).
- Estimate for admission: `(maxRecords + 30) × collector.estimated_usd_per_1000_ads / 1000`
  — the 30 covers the actor's documented overshoot (R13).
- **Budget window: a configurable billing cycle, not calendar months.**
  `collector.billing_cycle_anchor` (a UTC instant at which a cycle starts, e.g.
  the Apify plan's renewal) and `collector.billing_cycle_length_months` define
  windows `[anchor + k·L, anchor + (k+1)·L)`; the current window is the one
  containing now. Month arithmetic clamps to month end (an anchor on the 31st
  rolls to 30 or 28/29). The UI renders the boundaries in Asia/Bangkok. Both
  values are TBD until set.
- Window spend: Σ `cost_usd` of requests that reached a terminal state inside
  the window + Σ `cost_estimate_usd` of non-terminal requests. A terminal request
  with no reported cost counts at its estimate and is flagged `cost_unreported`.
- Cost per run: `cost_usd`. Cost per 1,000 ads: `cost_usd ÷ saved.ads × 1000`,
  only when `cost_usd` is reported and `saved.ads > 0`. Admin-only.
- Wording: `ค่าเก็บข้อมูล` / Collector usage — never ad spend, media spend or
  advertising budget (R12).

### 7.4 Admission (server-side, R13)

A start is refused when any of these hold:

1. a required setting is null — `monthly_budget_usd`, `max_records_per_run`,
   `estimated_usd_per_1000_ads`, `actor_build`, `billing_cycle_anchor`,
   `billing_cycle_length_months`. **These stay TBD until set; nothing is derived
   from the published price, and the sample run's actual cost is not yet
   recorded.**
2. `maxRecords > max_records_per_run`, or `maxRecords + 30 > 5000`
   (the validator's `MAX_RECORDS`);
3. window spend + this estimate > `monthly_budget_usd`;
4. non-terminal requests ≥ `collector.max_concurrent` (seeded **1**,
   admin-configurable, approved).

Checks 3 and 4 and the insert run in one transaction holding
`pg_advisory_xact_lock` on a fixed collector key, so two simultaneous starts
cannot both pass. Disabled buttons are cosmetic; the server is the cost
boundary. Crossing the budget while a run is in progress never stops that run;
it only blocks new ones (R13).

### 7.5 Idempotent start

The form carries a `requestKey` UUID generated when the form is rendered.
`unique (requested_by, request_key)` makes a double click, a network retry or a
re-submitted page return the existing request instead of creating a second one.
Together with admission (§7.4) and the state machine (§11), no browser action
can create a second provider run.

### 7.6 Status

`completed` / `partial` is the import engine's own result, unchanged. A run
stopped by `limit_reached` is presented as partial to the user.

## 8. AI responsibilities

None.

## 9. Database changes (next migration number at implementation time)

1. `collection_runs.collection_method` CHECK gains `apify_actor_run`; the
   supported-method list the validator checks (`lib/domain/types.ts`) gains the
   same value (additive).

2. `public.collection_requests` — three groups of columns:

   | Group | Columns | Who can read |
   |---|---|---|
   | user-safe | `id`, `requested_by`, `request_key`, `status`, `params` (keyword, country, active_status, max_records), `category_id`, `dataset_name`, `source_url`, `provider_item_count` (a neutral count), `result` (counts only), `stop_reason`, `collection_run_id`, `dataset_id`, `created_at`, `started_at`, `finished_at`, `updated_at` | the requester (RLS + column grant), admins |
   | admin diagnostics | `provider`, `provider_actor`, `provider_actor_build`, `provider_run_id`, `provider_dataset_id`, `error_class`, `error_detail` (scrubbed, ≤ 2,000 chars), `retry_count`, `cost_usd`, `cost_estimate_usd`, `cost_unreported` | admins, through the server only |
   | internal recovery | `lease_owner`, `lease_expires_at`, `attempt`, `next_check_at`, `start_attempted_at`, `import_attempted_at`, `media_enqueued_at` | admins, through the server only |

   `status` ∈ `queued, starting, running, importing, succeeded, failed`.

   **Invariants in the schema, not only in code:**
   - `unique (requested_by, request_key)` — one request per submission;
   - `unique (provider_run_id)` — one provider run per request, never shared;
   - `unique (collection_run_id)` — one committed run per request;
   - `check (status <> 'queued' or start_attempted_at is null)`;
   - `check (status not in ('running','importing') or provider_run_id is not null)`;
   - `check (status not in ('succeeded','failed') or finished_at is not null)`.

   **Exactly-once canonical commit, enforced by the database:** the adapter
   writes the request's own UUID into the export's `quality_summary`, which the
   unchanged engine stores in `collection_runs.reported_quality_summary`. A
   `unique` index on `((reported_quality_summary ->> 'collection_request_id'))`
   (where not null) makes a second commit of the same request fail inside
   `commitImport`'s own transaction and roll back entirely. The engine contract
   does not change (R6).

   **Media, already exactly-once:** `media_assets` has
   `unique (ad_observation_id, asset_role)` and `enqueueRun` inserts with
   `on conflict do nothing`, so a repeated enqueue inserts nothing.
   `media_enqueued_at` is recorded for visibility only.

   **Access:** RLS enabled; one policy, `select` for `authenticated` where
   `requested_by = auth.uid()`; no insert/update/delete policies — every write
   goes through the server's privileged path after a role check. Grants
   (0036 style): column-level `select` to `authenticated` on the user-safe group
   only; nothing to `anon` or `service_role`. A `security_invoker` view,
   `public.collection_request_status`, exposes exactly the user-safe columns and
   is the only thing the non-admin read path queries. Indexes on
   `(status, next_check_at)` and `(requested_by, created_at desc)`.

3. `app_settings` rows — `null` (TBD) unless stated:
   `collector.monthly_budget_usd`, `collector.max_records_per_run`,
   `collector.estimated_usd_per_1000_ads`, `collector.billing_cycle_anchor`,
   `collector.billing_cycle_length_months`, `collector.run_timeout_minutes`,
   `collector.actor_build`; `collector.max_concurrent` = `1`;
   `collector.lease_seconds` = `120` [engineering default, tunable — not a
   price]; `collector.actor` = `"curious_coder/facebook-ads-library-scraper"`;
   `collector.countries` = `["TH"]`; `collector.enabled` = `false`.

4. A scheduled job (pg_cron → pg_net, the media-drain pattern) calling
   `POST /api/collections/advance` every minute with a machine token held in
   Vault, batch sized so one call finishes inside the pg_net timeout (the 0034
   lesson).

## 10. API contracts

All JSON. Tokens never appear in any response. **Non-admin responses are built
by an allowlist serializer from the user-safe projection; the admin fields are
never loaded on that path**, so omitting them is not a UI decision.

**User DTO** (the only shape a non-admin ever receives):
`{ id, status, keyword, country, activeStatus, maxRecords, categoryId,
datasetName, adsFoundSoFar, elapsedSeconds, result?: { datasetId,
collectionRunId, ads, pages, quarantined, status, stopReason }, failure?:
{ message } }` — no provider, actor, build, run ID, raw error, cost, lease or
recovery field.

**`POST /api/collections`** — role ≥ analyst.
Body `{ requestKey, keyword, country, activeStatus: "active"|"all", maxRecords,
categoryId, datasetName }`. Runs admission (§7.4), inserts `queued`, then calls
the state machine once (§11). `201 { request: UserDto }` · `200` for an existing
`requestKey` · `400` · `403` · `409 { reason: "not_configured" |
"budget_reached" | "busy" }` · `503 { reason: "collection_unavailable" }`.

**`GET /api/collections/:id`** — the requester, or admin → `UserDto`. May nudge
the state machine for **polling only**: never a start, and only when the request
is due (`next_check_at ≤ now`) and its lease is free.

**`GET /api/collections`** — own requests (analyst) or all (admin), as
`UserDto[]`.

**`GET /api/collections/:id/diagnostics`** — **admin only** (403 otherwise):
provider, actor, build, provider run ID, error class, scrubbed error detail,
duration, retry count, reported and estimated cost, `cost_unreported`, lease and
attempt fields, timestamps.

**`POST /api/collections/advance`** — machine token only (its own secret,
`authenticateMachine` pattern). Advances due requests; returns counts.

**`GET /api/collector/usage`** — admin. Window boundaries, spend, budget,
remaining, runs, ads, cost per run, cost per 1,000 ads, failures, overdue
requests.

**`PATCH /api/collector/settings`** — admin; audited with before/after.

**`POST /api/imports/preview`, `POST /api/imports/commit`** — unchanged
contracts; role raised from analyst to **admin** (R10, R11).

## 11. One idempotent state machine

`advance(id, trigger)` is the only code that talks to the provider or commits.
`POST` (first step), the scheduled sweep and the progress-page nudge all call it;
none has a private path.

**Claim.** `update collection_requests set lease_owner = $worker,
lease_expires_at = now() + lease where id = $id and status not in
('succeeded','failed') and (lease_expires_at is null or lease_expires_at < now())
and next_check_at <= now() returning *`. No row means another worker holds it or
it is not due: the caller returns the current state and does nothing else.

**Transitions** are compare-and-set on `(id, status, lease_owner)`; each marker is
committed *before* the external action it guards.

| From | Guard committed first | External action | To |
|---|---|---|---|
| `queued` | `status = 'starting', start_attempted_at = now()` where `start_attempted_at is null` | Apify start — **the only call that costs, reachable once per request** | `running` with `provider_run_id` |
| `starting` with no run ID (crashed after the call) | — | **never re-start.** Reconcile: list the actor's recent runs and match this request's ID carried in the run input as `runTag` (verified in the first ticket) | `running` if found; after the reconcile window, `failed(provider_start_unknown)` for an admin |
| `running` | lease | read run state and item count (no cost) | `running` · `importing` · `failed(provider_run_failed / provider_timed_out / provider_aborted)` |
| `importing` | `import_attempted_at = now()`; if a `collection_run` already carries this request ID, adopt it and skip the commit | fetch items → adapter → `previewImport` → `commitImport` (the unique index permits one) | `succeeded`, cost recorded; or `failed(adapter_rejected / import_failed)` |
| `succeeded`, `media_enqueued_at` null | lease | `enqueueRun` (idempotent by unique key) | `media_enqueued_at` set |

The lease is released at the end of each step. If a worker dies, the lease
expires and another resumes at the recorded step; every step is safe to resume
because of its marker and the schema invariants in §9.

**Duplicate risks and what stops each:**

| Risk | Guard |
|---|---|
| double click / resubmit | `unique (requested_by, request_key)` + admission lock + `max_concurrent` |
| two workers start the same request | claim lease + CAS on `start_attempted_at` |
| crash between the start call and recording it | no re-start; reconcile by `runTag` |
| page refresh or reopen | a GET never starts; it polls only when due and unleased |
| normalizing the same result twice | only the lease holder in `importing` runs the adapter |
| committing the same collection twice | unique index on the request ID in `collection_runs` |
| enqueueing media twice | `unique (ad_observation_id, asset_role)` + `on conflict do nothing` |
| poll storms | `next_check_at` back-off |

**Other outcomes.**
- Zero items: `succeeded` with no `commitImport` and no Dataset; `result = { ads:
  0 }`, scope, timestamps, cost when reported, terminal status and audit entries
  are kept (approved).
- A media-enqueue failure never fails the request (today's rule).
- A request past its run timeout with no terminal provider state becomes
  `failed(provider_timed_out)`; PT Glory does not abort the provider run (R13).
- Transient provider read errors (5xx, network) increment `retry_count`; past a
  limit the request fails `provider_unreachable`.

## 12. UI states

| Screen | States |
|---|---|
| Form | empty · invalid field · not configured (analyst notice; admin link to settings) · budget reached · busy · submitting |
| Progress | starting · running (ads found, elapsed) · importing · error-on-read (keeps polling) |
| Result | complete · partial (limit reached / quarantine) · zero ads · failed (friendly + retry; admin panel) |
| Collector usage (admin) | unconfigured (TBD values) · normal · over budget · has overdue requests |

**Navigation (role-aware; `NavItem` gains a minimum role):**
- DATA: `เก็บข้อมูลใหม่` (analyst and admin).
- SYSTEM: `ค่าเก็บข้อมูล` (admin), `นำเข้าไฟล์ (กู้คืนระบบ)` → `/import` (admin).
- The Extension appears nowhere as a choice (R14).

**Provenance labels for non-admins (approved).** Wherever collection
provenance is shown — the dataset header `วิธีเก็บ`, the datasets list, the ad
drawer's history — non-admins see `เก็บข้อมูลอัตโนมัติ` for `apify_actor_run`
and `นำเข้าจากไฟล์` for `network_response_observation` /
`user_initiated_dom_observation`, with the source product shown as `PT Glory`.
This covers historical Extension data too. **The mapping is applied on the
server** — in the read layer and in every API route that returns these fields —
before serialization, so the raw method and product never leave the server for a
non-admin. Admins see raw values in diagnostics.

## 13. Data quality rules

- Allowlist before validation; forbidden metrics never persisted (R1, R2).
- Dates converted exactly; the spike proved zero offset.
- `publisher_platform` stays multi-value.
- Partial fields stay partial and use the existing coverage language.
- Provider-reported counts are provenance; `computed_*` stay canonical.
- Media URLs are passed through; the existing `fbcdn.net`-only allowlist decides
  archival. Fetchability of this provider's CDN edges before expiry is measured
  at the first real import.

## 14. Security / authorization

- `APIFY_TOKEN` server-only: never `NEXT_PUBLIC_*`, never logged, never in a
  URL (sent as an `Authorization` header), never in a response or a row.
- The advance endpoint has its own machine secret in Vault.
- Role checks happen on the server before any privileged write, as in today's
  commit route. Analysts cannot reach manual import (R10); viewers cannot start
  or view collections.
- The test-only mock provider refuses unless `PT_GLORY_ENV` is `dev` or `test`.
- Provider error text is scrubbed of anything token-shaped before storage and is
  admin-only.
- `tests/security.test.ts` bundle scan gains `APIFY_TOKEN` and the advance token.
- The zero-cloud watcher treats `api.apify.com` as a forbidden destination in
  tests.
- Actor options that crawl beyond the Ad Library stay off: no ad details, no
  about page, no landing pages.

## 15. Error / partial states

| Class | User sees | Admin sees |
|---|---|---|
| `provider_start_failed`, `provider_unreachable` | ไม่สามารถเก็บข้อมูลรอบนี้ได้ · ลองใหม่อีกครั้ง | class, scrubbed detail, retries |
| `provider_run_failed` / `provider_timed_out` / `provider_aborted` | same | + provider run ID, duration |
| `adapter_rejected` | same | + validator reason (an engineering defect) |
| `import_failed` | same | + request ID; no raw database error |
| partial (limit / quarantine) | สำเร็จบางส่วน + reason | same |
| zero ads | ไม่พบโฆษณาตามเงื่อนไขนี้ | + cost |

## 16. Observability

- `collection_requests` is the ledger of every attempt.
- `audit_logs` rows: `collection.start`, `collection.succeeded`,
  `collection.failed`, `collector.settings.update` (before/after, no secrets).
- Server logs carry request ID, provider run ID and error class — never a token.
- Collector usage shows overdue requests, so a stopped scheduler is visible.

## 17. Acceptance criteria

1. An analyst starts a collection from one form and reaches the Dataset without
   any provider name appearing.
2. The adapter's output passes the unchanged validator; nothing from Apify is
   written without passing `previewImport` → `commitImport`.
3. No `spend`, `currency`, `reach_estimate` or `impressions_with_index` value
   exists anywhere in the database after an import.
4. Apify dates are stored exactly. Active ads have `end_date` null; inactive ads
   with a valid upstream date carry it; otherwise null; never the collection
   time. The upstream value is kept only as raw provenance.
5. Country, query and status on the Collection Run come from the request.
6. Category is required and explicit; the dataset name defaults as specified and
   is editable.
7. Analysts get 403 from both manual-import routes; viewers get 403 from every
   collection route; only admins reach diagnostics, usage, settings and manual
   import.
8. With any required setting null, starts are refused; no price is hard-coded.
9. Budget windows follow the configured billing cycle; starts are refused past
   the budget, counting running estimates; a run that crosses it mid-flight
   completes normally.
10. With `max_concurrent = 1`, two simultaneous starts yield exactly one request.
11. Refreshing or reopening the progress page any number of times makes no
    provider start and adds no cost.
12. A request is committed at most once, enforced by a database invariant: a
    forced second commit fails inside the import transaction.
13. Every non-admin response matches the user DTO key set exactly.
14. Non-admins see neutral provenance labels everywhere, including historical
    Extension data; the raw values are not present in their responses.
15. A zero-result collection creates no Dataset and keeps its request, scope,
    timestamps, cost and audit trail.
16. `source_exhausted` appears only with provider evidence of exhaustion; it is
    never inferred from a short result alone.
17. No test contacts Apify; neither token appears in the client bundle.

## 18. Test plan

- **Unit (adapter):** a fixture derived from the spike export with every signed
  query string stripped; asserts allowlisting, forbidden-key removal, epoch→ISO,
  the three `end_date` cases, dedupe, routing to `unresolved_ads`, media sub-key
  allowlists, `collection_request_id` in `quality_summary`, and that the output
  passes `validate()`.
- **Unit (rules):** URL builder; cost estimate; billing-window arithmetic (anchor
  on the 31st, leap years, a window boundary crossing mid-run); admission;
  error-class mapping; label mapping; token scrubbing; user-DTO serializer key
  set.
- **DB:** `collection_requests` RLS, column grants and the safe view (requester
  sees own user-safe columns; others, viewers and anon see none; admin and
  recovery columns not selectable by `authenticated`); every schema invariant in
  §9 rejects its violation; the `collection_runs` request-ID unique index blocks
  a second commit; the new method in the CHECK; `collector.*` keys present and
  admin-only; the scheduled job exists and is unreachable from app roles.
- **Concurrency (mock provider):** two workers advance the same request in
  parallel → one provider start; a crash after the start call → reconcile, no
  second start; a crash after commit before the request update → adoption, no
  second commit; 50 GETs during `running` → zero starts; two simultaneous POSTs
  with `max_concurrent = 1` → one request; a double submit with the same
  `requestKey` → one request.
- **Integration (mock provider):** success, limit reached, genuinely exhausted,
  zero items, start failure, run failure, timeout, transient read error, budget
  refusal, budget crossed mid-run.
- **E2E:** analyst form → progress → result on the mock provider; viewer sees
  no navigation entry and gets 403; admin sees diagnostics, usage and manual
  import; analyst `/import` → 403; a non-admin page and API response contain no
  raw provenance string. Existing specs that import through the UI as analyst
  move to an admin E2E account (setup gains one).
- **Security and invariants:** bundle scan with `APIFY_TOKEN` and the advance
  token; the watcher treating `api.apify.com` as forbidden; the guard scanner;
  the 0036 grants test extended to the new table and view.

## 19. Rollback / migration notes

- `collector.enabled = false` hides `เก็บข้อมูลใหม่` and refuses starts without
  a deploy.
- Datasets created by collections are ordinary Datasets and stay valid after a
  rollback.
- The down migration drops the scheduled job, the table and the `collector.*`
  keys, and restores the CHECK list — but refuses if any `collection_runs` row
  already uses `apify_actor_run`, rather than orphaning provenance.
- Restoring analyst manual import is a one-line role change on two routes and
  the page.
- Deployment order: migration → app deploy (feature off) → admin sets the TBD
  values → `collector.enabled = true`.

## 20. Open (does not block architecture)

- The sample run's actual Usage amount. No default price is invented; the
  estimate setting stays TBD until it is recorded.
