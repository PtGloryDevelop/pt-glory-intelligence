# Architecture review — Phase 15: Collection UX, Apify first

Date: 2026-09-11 · Input: `SPEC_2026-09-11_PHASE15-COLLECTION-UX.md` (approved with
amendments, commit `7921cb5`), `GRILL_…`, `SPIKE_…` · Status: **approved with
required amendments (2026-09-11), amendments applied below; C01-A corrections applied (2026-09-11) — design only, no implementation.**

## Architecture summary

A collection is a row in `collection_requests`, driven by one state machine,
`advance(id)`. The machine is the only code that calls the provider or commits
data, and every caller — the start request, the scheduled sweep and the progress
page — goes through it. Each call claims a database lease, performs **one bounded
transition**, persists its state and evidence, and releases; a later tick
continues the run. The Apify Adapter turns provider items into an ordinary PT
Glory export, so ingestion is the unchanged import engine: `analyzeImport` → `commitImport` →
`enqueueRun`. The background path never calls `previewImport`, which depends on a
signed-in user's session. Non-admins only ever receive a user-safe DTO built from a
`security_invoker` view; provider internals live in columns they are not granted
and are served by an admin-only endpoint.

## What is guaranteed, and what is not

The guarantees differ by side effect, and none of them is an end-to-end
exactly-once claim across the provider boundary.

| Side effect | Guarantee | Mechanism |
|---|---|---|
| **A. Canonical PT Glory commit** | **Exactly once** per request | A unique index on the request ID inside `collection_runs.reported_quality_summary`, enforced within `commitImport`'s single transaction; a crash after commit is resolved by adoption, never by a second commit. |
| **B. Provider start (paid Actor run)** | **At most one automatic attempt**, plus reconciliation when the outcome is uncertain | The start marker is committed before the call; an uncertain outcome enters `provider_start_uncertain`, which never issues another start automatically. Recovery never starts a run: a new paid attempt is a new Collection Request by the user, through authorization, admission, the monthly budget, the per-run ceiling, the concurrency guard and a new `runTag`. |
| C. Media enqueue | Idempotent (rows inserted once) | `unique (ad_observation_id, asset_role)` + `on conflict do nothing`. |
| D. Cost accounting | Conservative, then reconciled | Reservation at admission → provisional cost at terminal status → final cost after settlement (below). |

The unavoidable window for B: the start marker is saved, Apify creates the run,
and the response (with the run ID) is lost before it is persisted. Nothing on our
side can distinguish "created" from "not created" at that moment, so the design
treats it as unknown and refuses to guess.

## Checklist (skill)

| Check | Answer |
|---|---|
| Master Ad + dataset membership | Unchanged — a collection ends in `commitImport`, which already upserts master ads and adds membership. |
| Observation history | Unchanged — each collection is a new run with its own observations. |
| Page ≠ Brand | Unaffected. |
| Provenance and quality retained | `collection_method`, `source_url`, scope, `quality_summary` counts on the run; provider identity, run ID and cost on the request (admin). |
| Long jobs modeled safely | Bounded steps under a lease; `after()` only to answer the scheduler at once; every step resumable. |
| Secrets server-side | `APIFY_TOKEN` and the advance token live in server env / Vault only. |
| Business rules server-side | Admission under an advisory lock; role checks before any privileged write. |
| Minimal | One provider implementation, no webhooks, the existing engine and pg_cron pattern. |
| Retry / recovery | Lease expiry resumes a step; an uncertain start is reconciled, never repeated; a commit can be adopted after a crash. |
| UI decoupled from raw collector shapes | The UI reads the DTO; raw Apify items never leave the adapter. |
| AI separated | No AI in this phase. |

## Data flow

```
Analyst form ──POST /api/collections──► admission (advisory lock: settings, cap,
                                         budget window incl. reservations, max_concurrent)
                                         │ insert collection_requests(status=queued, request_key,
                                         │        cost_reserved_usd = run ceiling)
                                         ▼
      one bounded step per call: advance(id) ◄── pg_cron tick (only when work is due)
                                         ▲    ◄── GET /api/collections/:id (poll-only nudge)
  queued ──commit start_attempted_at──► POST Actor run (build pinned, timeout,
                                         maxTotalChargeUsd = run ceiling, restartOnError=false,
                                         runTag = request id)
     ├─ 2xx with run id ─────────────► running
     ├─ definitive rejection (4xx) ──► failed(provider_start_failed)
     └─ timeout / 5xx / lost response / worker died ─► provider_start_uncertain
                                         │ reconcile by provider evidence (never a new start)
                                         ├─ one match ─► running
                                         └─ none / ambiguous ─► requires admin
  running ──► GET run (status, provisional usage) + item total          (one call per tick)
     └─ terminal-success ─► settling ──► dataset itemCount + modifiedAt + pagination total,
                                         observed twice ≥ result_settle_seconds apart (§9)
                                         ├─ ready ─► importing
                                         └─ not ready within the window ─► requires admin
  importing ──commit import_attempted_at──► fetch the intended range (must return exactly
                                         the settled count, else nothing is written and
                                         the request returns to settling)
                                         ≤ record cap within the byte budget
                                         → adapter → analyzeImport
                                         → commitImport(actorId = requested_by)
                                           (unique request-ID index) ─► succeeded
  post-terminal, one per tick: enqueueRun (idempotent) · cost finalization
```

## Recommended design

### 1. Provider start and `provider_start_uncertain` (amendment 1)

States gain `provider_start_uncertain` (and `settling`, §9). The full set:
`queued, starting, provider_start_uncertain, running, settling, importing, succeeded, failed`.

| Situation | Next state | Automatic start? |
|---|---|---|
| `queued`, lease claimed | commit `status = starting`, `start_attempted_at = now()` (CAS where `start_attempted_at is null`), **then** call the provider | the one and only automatic attempt |
| response 2xx with a run ID | `running`, run ID persisted | — |
| definitive rejection before a run exists (4xx: invalid input, payment, permission) | `failed(provider_start_failed)` | no |
| timeout, network error, 5xx, unparseable response | `provider_start_uncertain` | **never** |
| found in `starting` with an expired lease and no run ID (the worker died) | `provider_start_uncertain` | **never** |

**Reconciliation** (bounded, one attempt per tick, within
`collector.reconcile_window_minutes`): list the actor's runs started after
`start_attempted_at − skew`, read each candidate's `INPUT` record, and match on
**both** `runTag = request id` and the input URL = `source_url`.
- Exactly one match → persist its run ID → `running`.
- Zero matches after the window, or more than one match → the request stays
  `provider_start_uncertain` with `requires_admin = true`.

**Admin recovery** (audited; owner decision 2026-09-11). **No admin action
starts an Actor run inside an uncertain request.**

- **Attach the original run.** An admin supplies a run ID; it is accepted only
  if its `INPUT` carries this request's `runTag` and `source_url` and it is not
  attached to another request. The request then continues normally (`running`).
- **Fail as unresolved** when the original run cannot be identified safely: the
  request becomes `failed` with `error_class = provider_start_unknown`,
  preserving `start_attempted_at`, the reconciliation evidence and the audit
  history. `cost_status = unreported` and the original admission reservation
  stays held (§3); no cost polling starts, because no run has been identified.

A new paid attempt is a **new** Collection Request initiated by the user. It
passes authorization, admission, the monthly budget, the per-run ceiling and the
concurrency guard, and generates a new `runTag`. Recovery never bypasses those
controls.

An uncertain request **keeps its cost reservation and counts toward
`max_concurrent`** until resolved. With the initial `max_concurrent = 1` this
deliberately blocks further collections — the cheaper failure.

The user DTO shows `กำลังตรวจสอบรอบเก็บข้อมูล`, then `รอผู้ดูแลระบบตรวจสอบ` once
`requires_admin` is set; no provider detail.

### 2. Bounded execution (amendment 2)

`advance(id)` performs exactly one transition per call:

`claim lease → one bounded transition → persist state and evidence → release`.

| Step | Bound |
|---|---|
| start | one provider `POST` with a request timeout |
| poll | one `GET` run + one one-item dataset page (for the item total) |
| settle | one `GET` dataset (metadata) + one one-item dataset page (pagination total) |
| reconcile | at most `collector.reconcile_page_size` runs inspected per tick |
| import | fetch ≤ `max_records_per_run` items within `max_export_bytes`, adapter, `analyzeImport`, `commitImport` |
| media enqueue | one query |
| cost check | one `GET` run |

- **No invocation waits for an Apify run.** A running request is re-checked on a
  later tick (`next_check_at` back-off), not by a long-lived function.
- The advance route authenticates, claims at most `collector.tick_batch`
  requests, answers `202`, and runs those steps in `after()`. `after()` only
  lets the scheduler get an immediate answer; it never extends a step.
- **`maxDuration` is explicit** on the advance and collection routes (300 s, the
  value the deployment already uses for the media routes) and **tested**. The test reads the route's export and asserts that the locally measured
  import time at the configured limits stays under 80% of it — the 0034 pattern.
  Production timing is measured at C16 and never assumed; neither correctness nor
  `maxDuration` depends on an estimate. The import is
  the one step that cannot be split, because `commitImport` is a single
  transaction; the cap is what bounds it.
- **Correctness never depends on a function surviving.** If an invocation dies
  at any point, the lease expires, the committed markers say where it was, and
  the schema invariants make resuming safe: an interrupted start becomes
  uncertain, and an interrupted import is adopted or re-run under the unique
  index. Failure-injection tests cover each step.

### 3. Cost finalization (amendment 3)

Cost has its own lifecycle, separate from request status:

| `cost_status` | Meaning | Amount used for budget |
|---|---|---|
| `reserved` | admitted, no provider figure yet | `cost_reserved_usd` (the run ceiling) |
| `provisional` | terminal; provider usage read but possibly still moving | `max(cost_provisional_usd, cost_reserved_usd)` until final [conservative] |
| `final` | the provider value has settled | `cost_final_usd` |
| `unreported` | the provider never reported a figure within the window | `cost_reserved_usd`, flagged |

- **Settlement (cost reconciliation)** is independent of the request's result
  state and **read-only**: after the run is terminal, `usageTotalUsd` is re-read
  with `GET` run on its own schedule (`cost_next_check_at`, backed off) — never
  a start or restart. Once a `provider_run_id` is identified it continues in
  any request status, including while a request waits for an admin and after
  it has failed. With no identified run (`provider_start_uncertain`, or failed
  as `provider_start_unknown`) there is no cost polling and no run is guessed:
  reconciliation by `runTag` and provider evidence comes first, run-level cost
  reconciliation begins only after a safe match, and without one the cost
  stays `unreported`. The cost becomes `final` when two reads at least
  `collector.cost_settle_minutes` apart agree.
- **Cost window:** at the end of `collector.cost_final_window_hours`, automatic
  cost polling stops. A request that has a provider figure keeps
  `cost_status = provisional` (the budget holds `max(provisional, reserved)`);
  one that never received a figure becomes `unreported`. An admin may **retry
  cost reconciliation** later: GET-only, it reopens the cost window and never
  starts an Actor. Both parameters are configurable engineering parameters to be
  calibrated on real runs, not prices.
- **Budget window commitment** = Σ `final` (finalized actual cost) + Σ amounts
  held by `provisional`, `reserved` and `unreported` requests (a released
  reservation holds nothing), all within the billing window. Available
  collector budget = `monthly_budget_usd` − commitment. Held amounts are
  reservations, never reported as spend or usage. Admission always uses this
  conservative sum; a reservation is released only
  when it is replaced by a lower final figure.
- **Cost status and budget reservation are separate** (owner decision,
  2026-09-11). A request failed as `provider_start_unknown` has
  `cost_status = unreported` — the provider cost is unknown — while its
  original admission reservation **stays held**: failing the PT Glory request
  does not release it, because the external run may have succeeded although
  its response or run ID was lost. Resolution:
  - A. the original run is later identified and its actual cost is known → the
    actual cost is reconciled and the unused reservation released;
  - B. reliable evidence shows no paid Actor run occurred → the reservation is
    released;
  - C. neither can be proven → the reservation stays held, and the
    unresolved/admin state and audit evidence are preserved.

  An unresolved reservation never expires automatically, and Phase 15 defines
  no automatic proof for B. The supported operational recovery is the admin
  action **Release unresolved budget reservation** (C11, required before C16
  activation). It applies only to `provider_start_unknown` with no safely
  identified `provider_run_id`, `cost_status = unreported` and the reservation
  still held. Admin only, explicit confirmation, mandatory reason, audited. It
  changes PT Glory's internal budget reservation only: `cost_status` stays
  `unreported`, all request and provider evidence is preserved, the request
  stays failed/unresolved and is neither deleted nor rewritten, no Actor is
  started or restarted, and it does not assert that no Apify charge occurred.
  The release is recorded in `reservation_released_at`,
  `reservation_released_by` and `reservation_release_reason`. After release
  the held (reserved) amount decreases and the available collector budget
  increases by the same amount; the finalized actual cost is unchanged,
  `cost_status` stays `unreported`, and historical provider cost evidence is
  unchanged. It is never described as reducing collector spend, usage or
  actual cost.
- **Presentation:** admins may see a provisional figure, always labelled
  `ยังไม่สรุป` / provisional and never as an invoice amount. Cost per run and cost
  per 1,000 ads are computed from final figures only; provisional ones are shown
  separately if at all. Non-admins never see cost.

### 4. `maxTotalChargeUsd` (amendment 4)

It is the **authoritative per-run provider ceiling**, not an estimate:

`run_ceiling_usd = min(collector.max_charge_per_run_usd, remaining admissible budget)`

where the remaining admissible budget is `monthly_budget_usd` minus the window
commitment defined above.

- Admission refuses when `run_ceiling_usd ≤ 0`. The same value is the request's
  `cost_reserved_usd`, so the reservation always equals the provider-enforced
  worst case.
- `collector.max_charge_per_run_usd` is a new admin setting, **TBD** until set;
  nothing is derived from the Store price.
- `collector.estimated_usd_per_1000_ads` is no longer required for safety. It is
  optional and, when set, is used only to warn that the ceiling may stop a run
  before `maxRecords`.
- A run that ends because it reached its ceiling keeps `stop_reason = null`
  (neither `limit_reached` nor `source_exhausted`); admins see
  `ceiling_reached = true`.

### 5. Other decisions (unchanged from the first review)

- Leases per step (`collector.lease_seconds` for short steps; the import step
  leases for `maxDuration` plus a margin). The lease is a performance measure:
  safety comes from the markers and invariants.
- `run_collection_advance()` returns without any HTTP call when nothing is due,
  so an idle scheduler costs nothing.
- `restartOnError = false`, `build` pinned and `timeout` from settings on every
  start; `runTag` carries the request ID.
- "Ads found so far" comes from `X-Apify-Pagination-Total` on a one-item page — a
  provider-reported count, labelled as such.
- Both a record cap and a serialized byte cap are enforced before
  `analyzeImport` (section 8); `MAX_BYTES` (25 MB) stays authoritative.
- An Apify token restricted to this actor and its storages if the owner's plan
  allows scoped tokens; otherwise a dedicated token. Server env only.

### 6. Background import path and attribution (C01-A correction, approved)

The background path is:

`Apify Adapter → analyzeImport(text) → commitImport({ …, actorId: requested_by }) → enqueueRun(collectionRunId)`

- **Never `previewImport`.** It is `analyzeImport` plus an existing-ads count read
  through `dbUser()`, which needs `next/headers` cookies — a signed-in user. The
  machine-authenticated advance route has none. The canonical boundary is the
  same pure validator and normalizer either way; the import engine is unchanged.
- **Parity test.** The same valid and invalid exports passed through
  `previewImport` (in a request context with a signed-in user) and directly
  through `analyzeImport` must produce equivalent canonical output, equivalent
  validation rejections and equivalent reported and computed counts.
  `previewImport`'s additional existing-ads count is excluded from the
  comparison.
- **Attribution.** `commitImport` stores `actorId` as `created_by` on the
  `collection_runs` and `datasets` rows it writes (and passes it on in its
  result). The background path passes the request's `requested_by`, so an
  import is attributed to the analyst who started it, never to the worker.
  `audit_logs` entries written by the state machine carry the same user as
  `actor`.

### 7. `source_exhausted` (C01-A correction)

`source_exhausted` is set only when **all** of these hold:

1. the provider run reached a successful terminal state;
2. the per-run record cap did not stop collection;
3. the provider cost ceiling did not stop collection (`ceiling_reached` false);
4. no other application guard stopped collection (the byte budget, the run
   timeout, or a size or validation limit);
5. provider pagination or source evidence indicates there are no more results.

`total` (constant 1,475 on the sample) is a **consistency check only**: items
returned below `total` contradicts exhaustion, but reaching it is not by itself
proof. `ads_count` and `position` are not used until their semantics are
proven. When any condition fails or cannot be shown, `stop_reason` is
`limit_reached` if the record cap stopped the run, otherwise `null`.

### 8. Per-run limits (provisional)

- **Two limits, both enforced:** `collector.max_records_per_run` (a record count)
  and `collector.max_export_bytes` (serialized export bytes, never more than
  `MAX_BYTES`). `MAX_BYTES` = 25 MB in `lib/collector/contract.ts` stays
  authoritative.
- The adapter tracks the serialized size as it builds the export. If the next
  item would push it past the byte limit, it **stops before producing an
  oversize export** and the request fails closed as `export_too_large`
  (admin-visible). Nothing is imported, and no export larger than the validator
  and import boundary can accept is ever produced. A partial import with its own
  stop reason is not introduced without owner approval.
- **Measured versus estimated.** Locally measured (C01-A): 11 commit round trips
  at 100, 500 and 1,000 ads; about 5.7 KB per ad. Production timing between
  `iad1` and `ap-southeast-1` is **not** measured and is not frozen as a
  guarantee; it is recorded at C16.
- **Candidate, not a default:** about 3,000 records, derived from the current
  sample's bytes per ad. The final configurable values stay TBD until real
  workload evidence and admin configuration.

### 9. Provider result settlement gate (C01-B, owner decision)

Evidence (C01-B): within about a second of `finishedAt`, the dataset metadata,
the pagination total and the charged events all reported 117 items; the settled
dataset holds 133, last modified before `finishedAt`. A terminal run is not yet a
complete result.

After the provider run reaches a successful terminal state the request moves to
`settling`. It is **never imported immediately.** Each settle tick reads the
dataset metadata (`itemCount`, `modifiedAt`) and the dataset items pagination
total (a one-item page); the next observation comes on a later tick at least
`collector.result_settle_seconds` after the previous one.

The dataset is **ready for import** only when all of these hold:

1. the provider run is terminal-success;
2. `itemCount` is unchanged across two observations;
3. `modifiedAt` is unchanged across two observations;
4. the pagination total agrees with `itemCount`;
5. fetching the full intended range (the first min(`itemCount`, record cap)
   items) returns exactly that many items — checked in the import step before
   `analyzeImport`; a short fetch writes nothing and returns the request to
   `settling`;
6. no application or provider guard indicates an incomplete or uncertain result.

`chargedEventCounts` is recorded as billing evidence and may be used as a
diagnostic consistency check (admins see a difference), but it is **never
required to equal** `itemCount`.

**Settlement timeout (owner decision).** If the dataset is not ready within
`collector.result_settle_window_minutes` of the terminal state:

- the existing provider run ID and provider dataset ID are kept;
- `requires_admin = true` and `error_class = provider_result_unsettled`; the
  request stays `settling`;
- automatic **provider-result / Dataset-settlement** polling stops: the claim
  predicate no longer selects the request for settlement work. This is not all
  provider reads — cost reconciliation (§3) continues independently with
  read-only `GET`s;
- nothing is imported as complete; admin diagnostics show the observations and
  the charged-event evidence.

Admin actions (audited):

1. **Retry settlement** — re-reads the **same** provider dataset: clears
   `requires_admin`, opens a new settle window, and the gate above applies
   unchanged. It never starts an Actor run and incurs no collection charge.
2. **Fail collection** — marks the PT Glory request `failed` (class
   `provider_result_unsettled`), preserving the provider run ID, dataset ID,
   observations, cost evidence and audit history. No PT Glory dataset is
   created or imported.

Importing a partial dataset is not offered; that needs owner approval (§8).
Starting a new paid collection is a separate user action and goes through
normal admission and budget checks.

**Cost (owner decision, 2026-09-11).** Cost reconciliation (§3) is independent
of result settlement. It continues with read-only provider `GET`s while the
request waits for an admin and after **Fail collection**, because cost may
settle later than the dataset metadata and the budget needs the final
provider-reported cost. It has its own bounded retry, back-off and window; when
that window expires it stops, keeps `cost_status = provisional`, and an admin
may retry it later (GET-only). None of these reads can start or restart an
Actor.

`settling` is non-terminal: the request keeps its reservation and counts toward
`max_concurrent`, and cost settlement proceeds independently because the
provider run is terminal. User DTO: `กำลังตรวจสอบผลการเก็บข้อมูล`, then
`รอผู้ดูแลระบบตรวจสอบ` once `requires_admin` is set.

`result_settle_seconds` and `result_settle_window_minutes` are configurable
engineering parameters, TBD. One run's evidence (stale about 1 s after
`finishedAt`, settled by +5 min) does not set them.

## Schema deltas to the spec (§9)

- Status CHECK includes `provider_start_uncertain` and `settling`;
  `requires_admin boolean` (admin group).
- Settlement observations (admin group, review §9): `result_item_count`,
  `result_modified_at`, `result_pagination_total`, `result_observed_at`,
  `result_settle_started_at`, `result_charged_items` (diagnostic only).
  `error_class` gains `provider_result_unsettled`; an admin-failed uncertain
  start uses `provider_start_unknown`.
- `cost_next_check_at` (internal recovery group): cost reconciliation's own
  schedule, independent of `next_check_at`.
- `reservation_released_at`, `reservation_released_by`,
  `reservation_release_reason` (admin group): the audited release of an
  unresolved reservation (§3). A check requires the three to be all NULL or
  all populated (with a non-empty reason); when populated, `provider_run_id`
  is null and `cost_status = 'unreported'`.
- Cost columns (admin group) replace `cost_usd` / `cost_estimate_usd`:
  `cost_status` (`reserved | provisional | final | unreported`),
  `cost_reserved_usd`, `cost_provisional_usd`, `cost_final_usd`,
  `cost_first_read_at`, `cost_finalized_at`, `ceiling_reached`.
- New settings, TBD unless stated: `collector.max_charge_per_run_usd`,
  `collector.reconcile_window_minutes`, `collector.reconcile_page_size`,
  `collector.cost_settle_minutes`, `collector.cost_final_window_hours`,
  `collector.result_settle_seconds`, `collector.result_settle_window_minutes`,
  `collector.tick_batch`. `collector.estimated_usd_per_1000_ads` becomes
  optional.
- The claim predicate also covers post-terminal work: a request is claimable
  while it is non-terminal (result settlement work only when `requires_admin`
  is false), or terminal with media not yet enqueued, or — in any status — when
  cost reconciliation is due (a `provider_run_id` identified,
  `cost_next_check_at` reached inside the cost window and `cost_status` not
  final).

## Where this review supersedes the approved spec

The spec (`7921cb5`) stays as approved. Where they differ, this review governs
and the tickets follow it:

| Spec | Superseded by |
|---|---|
| §7.2 — `maxTotalChargeUsd` set to the run's estimate | §4 above — the per-run ceiling |
| §7.3 — one `cost_usd` figure | §3 above — reserved / provisional / final / unreported |
| §7.4 — `estimated_usd_per_1000_ads` required for admission | optional; `max_charge_per_run_usd` required instead |
| §9 — status set, cost columns | the schema deltas above |
| §11 — `starting` with no run ID → `failed(provider_start_unknown)` after reconcile | `provider_start_uncertain` with `requires_admin`; never failed automatically |
| Acceptance criterion 12's "exactly once" wording | scoped as in *What is guaranteed* |
| §2, §6, §11 — the importing step via `previewImport` | §6 above — `analyzeImport` → `commitImport(actorId = requested_by)`; parity test |
| §6.1 — `source_exhausted` when items reach the provider's reported total | §7 above — all five conditions; `total` is a consistency check only |
| §7.4 — cap from `max_records_per_run` and `MAX_RECORDS` only | §8 above — record cap and byte cap, both provisional; oversize fails closed |
| §2, §11 — import as soon as the provider run succeeds | §9 above — settlement gate: `settling` until the dataset is ready; otherwise admin, never a partial import as complete |
| §15 — error classes | + `provider_result_unsettled` (§9): user sees `รอผู้ดูแลระบบตรวจสอบ`, and after **Fail collection** the standard failure message; admin sees run ID, dataset ID, observations, charged events |
| §15 — error classes | + `provider_identity_conflict` (0038, C08 follow-up): a provider response contradicting the run ID, dataset ID, build or canonical start instant already persisted. The persisted identity stands, no transition is made, no run is ever started, `requires_admin = true`. User sees `รอผู้ดูแลระบบตรวจสอบ`; admin sees the persisted identity and the scrubbed, bounded conflict detail. Distinct from `provider_start_unknown` (a run may or may not exist) and `provider_result_unsettled` (the result never became readable) |

## Components

### New

| Component | Responsibility |
|---|---|
| `lib/collect/provider.ts` | `CollectorProvider` interface: `start`, `status`, `itemTotal`, `fetchItems`, `findRunsSince`, `readRunInput`. |
| `lib/collect/apify.ts` | The Apify implementation over `fetch`; `Authorization` header, never a query token; responses classified as success / definitive rejection / uncertain. |
| `lib/collect/mock.ts` | Test provider with scriptable outcomes (including lost responses); refuses unless `PT_GLORY_ENV` is `dev`/`test`. |
| `lib/collect/adapter.ts` | Apify items → PT Glory export (spec §6). Pure. |
| `lib/collect/url.ts` | Ad Library URL builder (spec §7.1). Pure. |
| `lib/collect/budget.ts` | Billing window, window commitment (final actual cost + held reservations), available budget, run ceiling. Pure. |
| `lib/collect/admission.ts` | Settings check, cap, ceiling and concurrency under `pg_advisory_xact_lock`; insert with the reservation. |
| `lib/collect/machine.ts` | `advance(id, trigger)`: claim, one bounded transition, reconcile, adoption, cost finalization. |
| `lib/collect/recovery.ts` | Admin recovery actions, audited: attach a verified run or fail an uncertain start as unresolved; retry settlement or fail an unsettled result; retry cost reconciliation (GET-only); release an unresolved budget reservation (reason required). None starts an Actor run. |
| `lib/collect/dto.ts` | `toUserDto` (allowlist) and `toAdminDiagnostics`. |
| `lib/collect/labels.ts` | Server-side provenance labels by role. |
| `app/api/collections/route.ts` | `POST` start, `GET` list (DTO). |
| `app/api/collections/[id]/route.ts` | `GET` user DTO; poll-only nudge. |
| `app/api/collections/[id]/diagnostics/route.ts` | Admin only. |
| `app/api/collections/[id]/recovery/route.ts` | Admin only; the three recovery actions. |
| `app/api/collections/advance/route.ts` | Machine-authenticated; explicit `maxDuration`; claims a bounded batch, answers `202`, one step each in `after()`. |
| `app/api/collector/usage/route.ts`, `…/settings/route.ts` | Admin only. |
| `app/(app)/collect/…` | Form, progress and result pages. |
| `app/(app)/collector/…` | Admin usage, settings and requests needing recovery. |
| Migration (next number) + down | Spec §9 with the deltas above; `run_collection_advance()` + cron job. |
| `scripts/collection-schedule-config.mjs` | Puts the advance URL and token into Vault, like `archive-schedule-config.mjs`. |
| `tests/import-parity.test.ts` | The `previewImport` / `analyzeImport` parity test (section 6). |

### Modified (compatibility findings, preserved)

| File | Change |
|---|---|
| `lib/domain/types.ts` | `apify_actor_run` added to the supported methods. |
| `components/shell/nav.ts` + sidebar | `NavItem.minRole`; entries filtered by role on the server. |
| `app/(app)/import/page.tsx`, `app/api/imports/preview`, `…/commit` | Role raised to admin; label `นำเข้าไฟล์ (กู้คืนระบบ)`. |
| `lib/read/queries.ts`, `app/api/ads/[adArchiveId]`, dataset pages | Provenance passed through `labels.ts` for non-admins before serialization. |
| `scripts/check-privileged-imports.mjs` | **`ALLOWED` gains the privileged collection modules and routes** (`lib/collect/admission.ts`, `machine.ts`, `recovery.ts`, the collection, recovery and advance routes) — a reviewed allowlist change. |
| `tests/security.test.ts` | Bundle scan gains `APIFY_TOKEN` and the advance token. |
| `tests/migrations.test.ts` | Numbering; **table count 17 → 18**; the new function in the create/drop list. |
| `tests/db/table-grants.test.ts` | **`collection_requests` gets a column-level rule** — table-level `has_table_privilege` cannot see column grants, so the test asserts the exact granted column set; no exemption. |
| `tests/db/foundation-audit.test.ts` | **`run_collection_advance` added to machine-only** (not executable by authenticated) and to the documented `SECURITY DEFINER` list (it reads Vault). |
| `e2e/global.setup.ts` + **seven p2 specs** | An admin E2E account; the seven specs that import through the UI as analyst use the admin session. |
| scratch network watcher | `api.apify.com` treated as a forbidden destination. |

## Risks

| Risk | Mitigation |
|---|---|
| Lost start response → possible second paid run | `provider_start_uncertain`: no automatic start, evidence-based reconciliation; otherwise an admin attaches the verified run or fails the request. A new attempt is a new user request through admission. |
| Community actor changes its input or output | Pinned build; adapter fixture test; `adapter_rejected` fails closed; the backup actor fits the same interface. |
| Reconciliation cannot see `runTag` in the run input | Verified in the first ticket; if unavailable, every uncertain start goes to admin — still no duplicate. |
| Provisional cost moves after terminal status | Reserved/provisional/final lifecycle; budget always uses the conservative figure. |
| A run "succeeds" with fewer items for reasons other than exhaustion | `stop_reason` stays null unless the provider shows exhaustion; `ceiling_reached` visible to admins. |
| This provider's CDN edges archive worse than the Extension's | Measured on the first real import; the archive records per-asset failure. |
| A large run exceeds the import boundary (`MAX_BYTES`) or `maxDuration` | Record and byte limits both enforced before `analyzeImport`; oversize fails closed as `export_too_large`; production timing measured at C16, never assumed; lease sized to the step; the unique index makes a re-run safe. |
| Budget race between two starts | Advisory lock around check and insert; `max_concurrent = 1`. |
| Provider identity leaking through existing read paths | Labels applied server-side; tests scan non-admin HTML/JSON for raw strings. |
| Cost unknown today | Required settings null → collection refused; nothing hard-coded. |
| Analysts lose manual import mid-pilot | Called out as a workflow change; admin keeps it. |
| Apify outage | Friendly failure; the Extension and manual import stay available to admins. |

## Rejected alternatives

- **Apify writing to Supabase or calling our import directly** — breaks the
  mandatory adapter boundary.
- **Webhooks as the primary signal** — adds an inbound surface and a secret and
  still needs a sweep for missed deliveries; deferred.
- **A long-lived invocation that waits for the run** (`waitForFinish`, or looping
  in `after()`) — ties correctness to a function surviving for minutes.
- **Automatically retrying an uncertain start** — the one path to a duplicate
  charge.
- **An admin "start again" inside an uncertain request** — would bypass
  authorization, admission, the budget, the per-run ceiling and the concurrency
  guard; a new attempt is a new user request (owner decision, 2026-09-11).
- **Polling Apify from the browser** — would expose the token.
- **Changing `commitImport` to take a request ID or an outer transaction** —
  violates R6; the unique index gives the same guarantee without touching it.
- **Hiding provider fields in the UI** — rejected by the owner (amendment B).
- **Calendar-month budgets** — rejected by the owner (decision 4).
- **Using the estimate as the provider ceiling** — rejected in this review; the
  ceiling derives from the guardrail and the remaining budget.
- **Holding a row lock across provider calls** — ties database connections to
  network latency; a lease plus compare-and-set does not.
- **A separate worker service or Edge Functions** — new infrastructure where
  Vercel + pg_cron already works.
- **Storing raw Apify items for audit** — they carry signed URLs and forbidden
  metrics.

## Migration / compatibility impact

- **Additive schema:** the method CHECK is widened; a new table, view and
  indexes are added; the request-ID unique index on `collection_runs` is partial
  (`where … is not null`), so existing runs cannot conflict; settings rows and
  the cron job are added. New objects get explicit grants in this migration; the
  down migration drops them and refuses if any run already uses
  `apify_actor_run`.
- **Existing data and flows:** unchanged. Extension files still import, now as
  admin.
- **Behaviour change for people:** analysts lose manual import (R10).
- **Tests:** the updates listed under *Modified*; no assertion is weakened.
- **Deploy order:** migration → app with `collector.enabled = false` → Vault
  secrets and settings → enable.

## Approval blockers

**None for tickets.** Prerequisites before the feature is switched on, all
owner/ops inputs:

1. `collector.monthly_budget_usd` and `collector.max_charge_per_run_usd`.
2. `collector.billing_cycle_anchor` and `collector.billing_cycle_length_months`.
3. `collector.max_records_per_run` and `collector.max_export_bytes` (≤ `MAX_BYTES`) — provisional; C01-A's candidate is about 3,000 records, final values need real workload evidence.
4. Calibration of `cost_settle_minutes` / `cost_final_window_hours` on real runs
   (the sample run's actual Usage is the first data point).
5. An Apify token (scoped if the plan allows) in Vercel server env, and the
   pinned `collector.actor_build`.
