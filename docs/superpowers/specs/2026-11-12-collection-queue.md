# Shared collection queue

Approved by the user on 2026-11-12: accept concurrent users' collection requests; run at most five collections at once and queue the rest, preserving the configured budget.

## Goal and journey

An analyst submits a valid search, immediately receives their own durable queued request, and can leave the page. The existing machine-only scheduler starts waiting requests in submission order when a slot and budget are available. The progress screen survives refresh and explains waiting. No user-count quota is introduced.

## Inputs and facts

- Existing `collection_requests`: owner, request key, params, category, created_at/id ordering, status, start marker, lease, reservation and cost evidence.
- Existing `app_settings`: enabled, maximum concurrent collections, monthly budget, per-run ceiling, billing window, provider build and timeout.
- Account GET `/v2/users/me/limits` verified on 2026-11-12: maximum five Actor jobs, 16 GiB memory. The application's provider start uses 512 MiB. Runtime slots are bounded by both the configured positive limit and five; production configuration becomes five.
- No changes to ad fields, provenance, normalization, datasets, AI, observations or metrics.

## Rules and architecture

1. Admission authenticates/validates as before and retains key idempotency. Busy or depleted budget no longer rejects a valid queue submission. Disabled/missing/invalid configuration still refuses.
2. A new queued row has `cost_reserved_usd = null`: waiting is not a paid start or a monetary reservation. The existing nullable column supports this; no schema migration is needed.
3. Before a paid start, one transaction takes the existing collector advisory lock, checks FIFO, counts non-queued live states, and evaluates exact micro-USD budget arithmetic. It then reserves `min(per-run ceiling, available budget)` and commits the existing one-time start marker. Provider I/O occurs after commit.
4. Existing positive reservations are retained or reduced to the current safe ceiling, excluding the request's own hold when calculating remaining funds. Historical holds and uncertain starts are preserved.
5. Active states (`starting`, `provider_start_uncertain`, `running`, `settling`, `importing`) occupy slots. A request waiting for admin in one of those states still occupies a slot. Queued rows do not.
6. Full slots, exhausted budget, disabled configuration or an older queued request leave the row queued without a start marker. A later scheduler tick retries. Budget may remain exhausted until reconciliation, an authorized settings change, or the next billing window; no ceiling is raised automatically.
7. Scheduler selects the oldest due action across active work, cost reconciliation and the single oldest queued request. When both lifecycle and cost work are due for a row, the older action wins. Retrying updates its next due time, allowing other overdue work a turn; a blocked queue must not prevent cost reconciliation that frees budget. Each HTTP tick remains bounded to one work item.
8. Existing user-safe DTO/RLS ownership and analyst/admin start permissions remain. No other user's queue contents, provider token, or costs are added to progress responses.

## UI and API

POST remains 201 for a new queued request, 200 for an idempotent retry. `queued` remains the existing product status. Guidance explains automatic waiting for a slot/budget and continued work after closing the page. No fabricated queue position or completion estimate is shown. Usage counts only positive monetary holds as held reservations.

## Acceptance and tests

- More than five requests from multiple users are accepted without reserving money; retries create one row.
- Concurrent dispatchers never start more than five and never start the same request twice.
- A sixth request waits; freeing a slot starts the oldest eligible request.
- Budget reservations are atomic across dispatchers and never exceed the configured remaining budget; depletion queues instead of spending.
- Disabled/unconfigured collector, FIFO, old positive reservations, uncertain starts, refresh, unauthorized users and provider failures are covered.
- Test real PostgreSQL locally with a mock provider; never run destructive fixtures or paid proof runs against production. Run focused unit/database tests, lint, typecheck, import checks, build and browser QA.

## Tickets

1. Queue admission and guarded dispatch, with PostgreSQL race/budget/idempotency regression tests.
2. Scheduler priority and accurate waiting/usage copy; verify progress and auth behavior.
3. Review edge cases/security, stage and verify the build, promote it, configure production concurrency to five through the audited admin endpoint, and check production reads/logs.

## Compatibility and rollback

No new tables, statuses or columns. Old workers encountering an unreserved queued request fail closed on the missing reservation and requeue without contacting the provider. Deploy the app before raising concurrency. Rollback requires pausing the collector, ensuring unreserved queued rows remain paused (old admission does not dispatch them safely), restoring the prior build and concurrency setting, then reviewing pending work before re-enabling. Existing provider starts must never be replayed.

## Verification evidence

- Focused real PostgreSQL 17.11: 119 passed, no skipped tests; mock provider only. Includes eight users, dispatch races, FIFO, budget, uncertain starts, admin-setting serialization and eight simulated scheduler minutes using the actual route SQL.
- Browser regression `scripts/check-collection-queue.mjs`: actual authenticated form, two successive queued submissions, fresh server request keys, waiting guidance and anonymous redirect. Collection/category writes are intercepted; no paid test run.
- Typecheck, privileged-import gate and production build passed. Broad unit run: 682/688 passed; six existing failures remain in unchanged destructive-script/migration baseline checks, reproduced before this feature. No database migration or collector normalization changes.
