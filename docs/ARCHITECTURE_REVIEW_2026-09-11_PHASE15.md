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
| **B. Provider start (paid Actor run)** | **At most one automatic attempt**, plus reconciliation when the outcome is uncertain | The start marker is committed before the call; an uncertain outcome enters `provider_start_uncertain`, which never issues another start automatically. A second paid run can only happen through an explicit, audited admin decision. |
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
  importing ──commit import_attempted_at──► fetch ≤ record cap within the byte budget
                                         → adapter → analyzeImport
                                         → commitImport(actorId = requested_by)
                                           (unique request-ID index) ─► succeeded
  post-terminal, one per tick: enqueueRun (idempotent) · cost finalization
```

## Recommended design

### 1. Provider start and `provider_start_uncertain` (amendment 1)

States gain `provider_start_uncertain`. The full set:
`queued, starting, provider_start_uncertain, running, importing, succeeded, failed`.

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

**Admin recovery** (audited): attach a run ID after checking the provider
console; confirm that no run exists and fail the request (the analyst may then
start a new one); or explicitly authorize a new start, which records that a
duplicate charge is possible.

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

- **Settlement:** after the run is terminal, `usageTotalUsd` is re-read on later
  ticks; the cost becomes `final` when two reads at least
  `collector.cost_settle_minutes` apart agree, or `unreported` after
  `collector.cost_final_window_hours`. Both are configurable engineering
  parameters to be calibrated on real runs, not prices.
- **Budget window spend** = Σ `final` + Σ amounts held by `provisional`,
  `reserved` and `unreported` requests, all within the billing window.
  Admission always uses this conservative sum; a reservation is released only
  when it is replaced by a lower final figure.
- **Presentation:** admins may see a provisional figure, always labelled
  `ยังไม่สรุป` / provisional and never as an invoice amount. Cost per run and cost
  per 1,000 ads are computed from final figures only; provisional ones are shown
  separately if at all. Non-admins never see cost.

### 4. `maxTotalChargeUsd` (amendment 4)

It is the **authoritative per-run provider ceiling**, not an estimate:

`run_ceiling_usd = min(collector.max_charge_per_run_usd, remaining admissible budget)`

where the remaining admissible budget is `monthly_budget_usd` minus the window
spend defined above.

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

## Schema deltas to the spec (§9)

- Status CHECK includes `provider_start_uncertain`; `requires_admin boolean`
  (admin group).
- Cost columns (admin group) replace `cost_usd` / `cost_estimate_usd`:
  `cost_status` (`reserved | provisional | final | unreported`),
  `cost_reserved_usd`, `cost_provisional_usd`, `cost_final_usd`,
  `cost_first_read_at`, `cost_finalized_at`, `ceiling_reached`.
- New settings, TBD unless stated: `collector.max_charge_per_run_usd`,
  `collector.reconcile_window_minutes`, `collector.reconcile_page_size`,
  `collector.cost_settle_minutes`, `collector.cost_final_window_hours`,
  `collector.tick_batch`. `collector.estimated_usd_per_1000_ads` becomes
  optional.
- The claim predicate also covers post-terminal work: a request is claimable
  while it is non-terminal, or terminal with media not yet enqueued, or terminal
  with `cost_status` not final.

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

## Components

### New

| Component | Responsibility |
|---|---|
| `lib/collect/provider.ts` | `CollectorProvider` interface: `start`, `status`, `itemTotal`, `fetchItems`, `findRunsSince`, `readRunInput`. |
| `lib/collect/apify.ts` | The Apify implementation over `fetch`; `Authorization` header, never a query token; responses classified as success / definitive rejection / uncertain. |
| `lib/collect/mock.ts` | Test provider with scriptable outcomes (including lost responses); refuses unless `PT_GLORY_ENV` is `dev`/`test`. |
| `lib/collect/adapter.ts` | Apify items → PT Glory export (spec §6). Pure. |
| `lib/collect/url.ts` | Ad Library URL builder (spec §7.1). Pure. |
| `lib/collect/budget.ts` | Billing window, window spend, run ceiling. Pure. |
| `lib/collect/admission.ts` | Settings check, cap, ceiling and concurrency under `pg_advisory_xact_lock`; insert with the reservation. |
| `lib/collect/machine.ts` | `advance(id, trigger)`: claim, one bounded transition, reconcile, adoption, cost finalization. |
| `lib/collect/recovery.ts` | Admin recovery actions for uncertain starts (attach run, confirm none, authorize restart), audited. |
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
| Lost start response → possible second paid run | `provider_start_uncertain`: no automatic start, evidence-based reconciliation, admin decision otherwise. |
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
