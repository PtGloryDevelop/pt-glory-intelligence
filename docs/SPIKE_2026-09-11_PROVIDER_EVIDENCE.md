# Spike — provider evidence for Phase 15 (C01)

Date: 2026-09-11 · Ticket: C01-A (no cost, read-only) — **complete** · C01-B (paid
qualification run) — **complete**: one owner-approved run on 2026-09-11,
settled provider-reported cost $0.0998 against the approved $0.10 ceiling.

## C01-A status

| Item | Status |
|---|---|
| (a) sample run via the Apify API — status, `usageTotalUsd`, `chargedEventCounts`, `pricingInfo`, `INPUT` shape, item total | **done** |
| (b) `Authorization: Bearer` on run, dataset items and `INPUT` | **done** |
| (c) meaning of `total` / `ads_count` / `position` | **done** |
| (d) import time, bytes and round trips; production estimate; cap bound | **done** |
| (e) plan for C01-B | **done** — ceiling derived from (a); amount needs owner approval before the run |

## (a) Sample run, read through the API

GET requests only, run on 2026-09-11 with the owner's token from `.env.local`,
sent as an `Authorization: Bearer` header (never in a URL, never printed, never
written). No actor was started; no dataset item bodies were printed (they carry
signed media URLs).

The sample is the most recent run of `curious_coder/facebook-ads-library-scraper`
on the account, identified by its item count (59):

| Field | Value |
|---|---|
| Run | `R9cJqgdq2rN1uToIH` · origin `WEB` (started from the Console) |
| Status | `SUCCEEDED` · "Scraped all urls" |
| Time | 2026-09-11 07:34:30 → 07:34:54 UTC (23.2 s) |
| Build | `2.7.25` (run option `build: latest`) |
| Run options | `timeoutSecs` 3600 · `memoryMbytes` 512 · `maxTotalChargeUsd` 5 (set by user) · `maxItems` 6666 |
| `pricingInfo` | `PAY_PER_EVENT` · `apify-default-dataset-item` (primary, "ad") **$0.00075** · `apify-actor-start` **$0.00005**, one event per GB of memory, minimum one |
| `chargedEventCounts` | 59 dataset items · 1 actor start |
| `usageTotalUsd` | **$0.0443** |
| `usageUsd` / `usage` | not present on this run |
| Dataset | `itemCount` 59 · `X-Apify-Pagination-Total` 59 |

`INPUT` (read from the run's key-value store record `INPUT`):

| Key | Value / shape |
|---|---|
| `urls` | array of 1 `{url}` — `www.facebook.com/ads/library/` with params `active_status, ad_type, country, is_targeted_country, media_type, q, search_type, sort_data[direction], sort_data[mode]` · `q` = `วิตามินสลายไขมัน` |
| `limitPerSource` | 50 |
| `scrapeAdDetails` | false |
| `scrapePageAds.activeStatus` / `.countryCode` / `.sortBy` / `.period` | `all` / `ALL` / `impressions_desc` / `""` (actor defaults for its page-ads mode) |

The account also holds three older runs of the same actor (2026-08-11: 1, 10 and
500 items; $0.00075, $0.0075, $0.375).

### What (a) establishes

1. **Cost is event-determined for this actor.** $0.0443 = 59 × $0.00075 + 1 ×
   $0.00005, exactly; there is no separate compute line. Cost evidence per run is
   `usageTotalUsd` plus `chargedEventCounts`, with the run's `pricingInfo` as the
   price record. Prices are per run and can change (the pricing record itself
   shows a change effective 2026-08-14), so nothing is hard-coded from them —
   consistent with `collector.max_charge_per_run_usd` staying TBD until the owner
   sets it.
2. **`limitPerSource` is not a hard cap.** 50 were requested; 59 were returned
   and all 59 were charged. The record cap therefore cannot rely on the actor's
   input: the provider ceiling (`maxTotalChargeUsd`) bounds cost, and the
   adapter's own record and byte caps (review §5, §8) remain mandatory.
3. **`maxItems` was derived from the charge ceiling.** With `maxTotalChargeUsd`
   $5 the platform set `maxItems` 6666 = ⌊5 / 0.00075⌋. Whether the actor stops
   at that point is observed in C01-B.
4. **Reconciliation can read `INPUT`.** The record is readable with the Bearer
   header, as reconciliation needs. This Console run carries no `runTag`, so
   reading `runTag` back remains a C01-B check. The older runs on the account
   confirm that matching must be by `runTag` and `source_url`, never "latest run".
5. **Sort options carry no data.** `impressions_desc` is an actor input option
   name; no impressions value is read or stored. The adapter sets its own `INPUT`
   explicitly.

## (b) Bearer-header authentication

| Request | Result |
|---|---|
| `GET /v2/actor-runs?limit=1` **without** the header | 401 `token-not-provided` |
| `GET /v2/acts/{actor}/runs` with `Authorization: Bearer` | 200 |
| `GET /v2/actor-runs/{runId}` with the header | 200 |
| `GET /v2/key-value-stores/{storeId}/records/INPUT` with the header | 200 |
| `GET /v2/datasets/{datasetId}/items?limit=1` with the header | 200 · `X-Apify-Pagination-Total` returned |

The header alone authenticates every read the state machine needs; no token is
placed in a query string.

## (c) `total`, `ads_count`, `position`

From the 59-item sample (keyword `วิตามินสลายไขมัน`, TH, active):

- `total` has **one value on every item: 1,475**. It is the Ad Library's result
  count for the query, not a per-item property. It is **supporting evidence only — a consistency check.** Per the owner's
  correction, `source_exhausted` needs all five conditions in the architecture
  review (§7): a successful terminal run, and no record cap, cost ceiling or
  other application guard stopping it, plus pagination or source evidence of no
  further results. `total` alone never decides it.
- `ads_count` is 1 on 51 items and 2 on 8. It matches `collation_count` on only
  41 of 59, so it is not collation; its meaning is unproven. **Not used.**
- `position` runs 1–57 with 55 distinct values across 59 items and is not
  strictly increasing in file order — a result-card rank. **Not used.**

## (d) Import measurement

Local Supabase stack (current defaults, migrations 0001–0036). Synthetic PT
Glory exports built in memory from the sample (a rough stand-in for the adapter's
allowlist; unique synthetic IDs, about two ads per page), never written to disk.
Timed with `analyzeImport` (validate → normalize) and `commitImport`; pg round
trips counted during commit.

| Ads | Export bytes | Bytes / 100 ads | Analyze | Commit (local) | Commit round trips |
|---|---|---|---|---|---|
| 100 | 565,478 | 565,478 | 8 ms | 1.1 s | 11 |
| 500 | 2,834,725 | 566,945 | 15 ms | 2.3 s | 11 |
| 1,000 | 5,696,410 | 569,641 | 32 ms | 3.0 s | 11 |

**Round trips are constant (11)**: `commitImport` writes set-at-a-time with
`unnest`, so its cost across regions does not grow with the number of ads.

**Production estimate — not a measurement.** The Pilot's functions run in
`iad1` (response header `X-Vercel-Id: sin1::iad1::…`) and the database is in
`ap-southeast-1`. Production commit ≈ local commit + 11 × RTT:

| RTT (assumed) | 100 ads | 500 ads | 1,000 ads |
|---|---|---|---|
| 150 ms | 2.8 s | 4.0 s | 4.6 s |
| 220 ms | 3.5 s | 4.8 s | 5.4 s |
| 300 ms | 4.4 s | 5.6 s | 6.3 s |

The first real import (C16) replaces this estimate with a measurement.

### What bounds the per-run cap

- **Locally, time was not binding** (measured above). Production timing is
  **not** measured here: the `iad1` → `ap-southeast-1` distance is real, the
  estimate is not a guarantee, and neither correctness nor `maxDuration` depends
  on it.
- **Bytes are binding.** At about 5.7 KB per ad (mostly media URLs and ad copy),
  the export reaches `MAX_BYTES` (25 MB) at about 4,390 ads — below
  `MAX_RECORDS` (5,000). Carousel-heavy ads will be larger than this sample.
- **Candidate only, not a product default:** about 3,000 records, derived
  from this sample's bytes per ad. **Both** a record cap and a serialized byte
  cap are enforced; `MAX_BYTES` (25 MB) stays authoritative, and the adapter
  stops before producing an export larger than the boundary can accept
  (`export_too_large`). Final values need real workload evidence and admin
  configuration.
- At the sample's price, a 3,000-ad run would be charged about $2.25 — stated
  for scale only; `collector.max_charge_per_run_usd` is set by the owner.

## Finding — the background path cannot use `previewImport`

`previewImport(text)` is `analyzeImport(text)` (pure: validate → normalize →
counts) plus an existing-ads count read through `dbUser()`, which needs
`next/headers` cookies — a request from a signed-in user. The scheduled advance
route is machine-authenticated and has no user session.

**Approved (2026-09-11) and applied** to the architecture review (§6) and
ticket C09: `Apify Adapter → analyzeImport → commitImport(actorId =
requested_by) → enqueueRun`, with a parity test against `previewImport`. The
import engine is unchanged, and imports are attributed to the requesting user.

## (e) Plan for C01-B (paid; not started)

One run of `curious_coder/facebook-ads-library-scraper`, started through the API
(`POST /v2/acts/{actor}/runs`, Bearer header) with the owner's token:

- **Input:** the same Ad Library search URL as the sample (known `total` 1,475) ·
  `limitPerSource` 300 (would cost about $0.225 at $0.00075 per ad) ·
  `scrapeAdDetails` false · `runTag` = a fresh UUID recorded before the start.
- **Run options:** `build` `2.7.25` · `memory` 512 MB (one start event) ·
  `timeout` 600 s · `restartOnError` false · **`maxTotalChargeUsd` $0.10**, below
  the cost of the requested items, so the run must meet its ceiling.
  `maxItems` is not set, so the platform derives it from the ceiling and the
  derived value is recorded.
- **Expected:** at most about 133 charged ads ((0.10 − 0.00005) / 0.00075).
  **Worst-case charge: $0.10.** This amount is proposed, not approved; the owner
  confirms or changes it immediately before the run.
- **Observed:**
  1. `runTag` read back from the run's `INPUT` record (needed by reconciliation);
  2. behaviour at the ceiling — whether the actor stops, the terminal status,
     how many items it returned, and the derived `maxItems`;
  3. `usageTotalUsd` at terminal status and again after 5, 15, 30 and 60 minutes
     (sets `cost_settle_minutes` / `cost_final_window_hours`);
  4. `X-Apify-Pagination-Total` while running (the "ads found so far" source);
  5. `chargedEventCounts` against `usageTotalUsd`.

## C01-B results (owner-approved paid run, ceiling $0.10)

Approved by the owner on 2026-09-11 immediately before the run, with the plan in
(e) unchanged. One `POST`, never retried; token in the `Authorization` header
only. Dataset item bodies were not printed.

| Field | Value |
|---|---|
| Run | `SwEWkJk0kp6sg4QMY` · start `HTTP 201` · status `READY` in the start response |
| Run options echoed back | `build` 2.7.25 · `timeoutSecs` 600 · `memoryMbytes` 512 · `maxTotalChargeUsd` 0.1 · `restartOnError` false · **`maxItems` 133 (derived by the platform)** |
| Time | 09:09:12.5 → 09:09:39.7 UTC (27.0 s) |
| Terminal | `SUCCEEDED` · exit code 0 · "Scraped requested number of records" |
| Items at the terminal read (≈1.3 s after `finishedAt`) | 117 in the dataset metadata · `chargedEventCounts` 117 items + 1 start — **a stale snapshot** |
| Items, settled | **133** in the dataset (133 fetched, 133 distinct `ad_archive_id`) · `chargedEventCounts` 133 items + 1 start · dataset `modifiedAt` 09:09:39.230, **before** `finishedAt` 09:09:39.722 |
| `usageTotalUsd` at terminal | **$0.0443 — provisional provider-reported cost** |
| Derived expected charge | at the terminal read $0.0878 (117 items, stale counts) · settled **$0.0998** = 133 × $0.00075 + 1 × $0.00005 — derived from `chargedEventCounts` and the run's `pricingInfo`, not the final actual cost |
| Final actual cost | **$0.0998** — the settled provider-reported `usageTotalUsd`, unchanged from +5 to +60 min (below) · within the approved $0.10 ceiling |
| `INPUT` read back | keys `urls, limitPerSource, scrapeAdDetails, runTag` plus the actor's `scrapePageAds.*` defaults · `runTag` **matches** · `urls` identical to the sample |

While running, polled every ~5 s:

| t (s) | Status | `X-Apify-Pagination-Total` | Charged items | `usageTotalUsd` |
|---|---|---|---|---|
| 6 | RUNNING | 0 | 0 | 0.00005 |
| 12 | RUNNING | 29 | 0 | 0.00005 |
| 18 | RUNNING | 59 | 29 | 0.00005 |
| 23 | RUNNING | 89 | 59 | 0.0218 |
| 29 | SUCCEEDED | 117 | 117 | 0.0443 |

Every value above is a provider snapshot. The last row, read within about a
second of `finishedAt`, was stale: the settled dataset holds 133 items.

Settlement — delayed reads of the same run (`finishedAt` 09:09:39.7 UTC):

| Read | Time from `finishedAt` | `usageTotalUsd` (provider-reported) | Changed since previous read | `chargedEventCounts` (items + start) | Derived expected charge |
|---|---|---|---|---|---|
| terminal | 0 min (1.3 s) | 0.0443 | — | 117 + 1 | 0.0878 |
| +5 | 5 min 1.4 s | 0.0998 | yes (0.0443 → 0.0998) | 133 + 1 | 0.0998 |
| +15 | 15 min 1.3 s | 0.0998 | no | 133 + 1 | 0.0998 |
| +30 | 30 min 1.4 s | 0.0998 | no | 133 + 1 | 0.0998 |
| +60 | 60 min 1.3 s | 0.0998 | no | 133 + 1 | 0.0998 |

**Settlement conclusion (owner wording, 2026-09-11).** For this qualification
run only: the provider-reported `usageTotalUsd` was $0.0998 at +5, +15, +30 and
+60 minutes after `finishedAt`. Therefore, in this observed run, the reported
cost had already stabilized by the first +5 minute observation and remained
unchanged through +60 minutes.

This does **not** establish that:

- all Apify runs settle within 5 minutes;
- 60 minutes is universally sufficient;
- $0.0998 is a pricing constant.

It is evidence for the reconciliation design, not a general settlement window:
`cost_settle_minutes` and `cost_final_window_hours` stay configurable
engineering parameters.

### What C01-B establishes

1. **`runTag` survives into `INPUT`.** The actor accepted the extra key and the
   record returns it unchanged, so reconciliation by `runTag` + `source_url`
   works as designed (review §2).
2. **`SUCCEEDED` does not prove `source_exhausted`.** Observed (settled):
   `maxTotalChargeUsd` 0.10 · platform-derived `maxItems` 133 · **133 ads** in
   the dataset · `limitPerSource` 300 · status `SUCCEEDED` with "Scraped
   requested number of records" · the query's search metadata reported `total`
   1,475. The settled item count equals the derived `maxItems`. The terminal
   status and message do not say which condition stopped the run. **The
   provider's terminal status does not expose enough information by itself to
   distinguish natural exhaustion from another stopping condition.** (The
   interim comparison 117 < 133 used the stale terminal snapshot; the settled
   count is 133.)

   `source_exhausted` therefore stays conservative and is **never** set from
   `SUCCEEDED` alone. It requires all of: a successful terminal provider state ·
   no application record cap reached · no provider cost-ceiling or charge-guard
   termination · no timeout or other guard termination · positive provider
   pagination or exhaustion evidence. When exhaustion cannot be proven, the stop
   reason stays unknown/other (`stop_reason = null`), never an invented
   `source_exhausted`.
3. **Terminal reads are provisional — for cost and for counts.** Within about a
   second of `finishedAt`, `usageTotalUsd` ($0.0443), `chargedEventCounts`
   (117), dataset `itemCount` (117) and `X-Apify-Pagination-Total` (117) all
   trailed the settled values ($0.0998 / 133 / 133 / 133), although the dataset
   was last modified before `finishedAt`. This supports the cost lifecycle in
   the review (§3): a terminal read is `provisional`, and the final actual cost
   is the settled provider-reported value from later reads.
4. **"Ads found so far" works as a lagging provider count.**
   `X-Apify-Pagination-Total` rose 0 → 29 → 59 → 89 → 117 during the run, ahead
   of the charged count but behind the settled 133 — a provider-reported
   snapshot, labelled as such.
5. **`restartOnError` false and the pinned `build` are accepted and echoed
   back** in the run options.
6. **Exactly one run was created.** The actor's run list shows one run started
   after 08:00 UTC on 2026-09-11: `SwEWkJk0kp6sg4QMY`.
7. **Import waits for the result to settle — owner decision (2026-09-11).** At
   the terminal read the dataset metadata reported 117 of its 133 items
   (whether the item listing itself was short at that moment was not
   measured), so an immediate import could have committed a partial collection
   as complete. The owner's provider result settlement gate is recorded in the
   architecture review (§9) and tickets C04, C08, C09 and C11: no immediate
   import; ready only when the run is terminal-success, `itemCount` and
   `modifiedAt` are unchanged across two observations, the pagination total
   agrees with `itemCount`, the full intended range returns exactly that many
   items, and no guard indicates an incomplete or uncertain result.
   `chargedEventCounts` is billing evidence and a diagnostic check only — never
   required to equal `itemCount`. Not settled within the bounded window → the
   same run and dataset are kept, `requires_admin` with
   `provider_result_unsettled`, automatic polling stops; an admin may **retry
   settlement** (re-reads the same dataset — no new run, no new charge) or
   **fail the collection** (evidence preserved, no PT Glory dataset). A new
   paid collection is a separate user action through admission and budget.
