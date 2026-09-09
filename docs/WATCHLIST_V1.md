# Watchlist V1 (P2.7)

Date: 2026-09-09 · Migration `0032` · Built on the frozen P2.1–P2.6 foundation
(`903368d` … `a250c15`)

Watchlist V1 saves the pages and categories a researcher wants to check, in the
data scope they were being looked at in, with one timestamp — the **baseline** —
that answers *since when?*

## What this is not

It is not monitoring.

- No background evaluator. Nothing computes a watch except a person opening it.
- No cron, no queue, no worker, no schedule.
- No notification of any kind.
- No alert or event table. Nothing is stored per change, which is why resetting
  the baseline cannot be undone: there is no history to restore.
- No AI, no Brand mapping, no spend, reach, engagement, ranking or verdict.

**Automatic monitoring remains blocked by C1.9** (continuous collection). Until
collection happens on its own, "watch this page and tell me when it changes"
cannot be honest: the system would only ever be reporting *the last time somebody
imported a file*. Watchlist V1 deliberately ships the half that is true —
remembering the question and answering it live when asked.

The wording is enforced, not merely intended: `tests/watchlist.test.ts` scans
every label, helper and basis string on these surfaces and fails on
`แจ้งเตือน` / `alert` / `real-time` / `push` outside an explicit denial.

---

## 1. What a watch stores

`public.watch_items`, one row per saved target:

| Column | Meaning |
|---|---|
| `created_by` | the owner; the only person who can read or change the row |
| `target_type` | `page` or `category` — never a brand, because a Page is not a Brand |
| `target_page_id` / `target_category_id` | identity, never a display name |
| `scope_kind` + `scope_dataset_id` / `scope_category_id` | the data the watch is about |
| `tracked_signals` | an allowlist, checked in SQL as well as in TypeScript |
| `baseline_at` | "since when", server time only |

Four `CHECK` constraints hold the shape the application assumes: a page target
carries no category, a scope carries exactly the id its kind requires, a category
watch is always scoped to its own category, and category signals never appear on
a page watch (or the reverse). A page signal on a category watch would query
nothing and render `0`, which reads as an answer.

Uniqueness is `(created_by, target, scope)` with `NULLS NOT DISTINCT` — without
that, two identical page watches would both be "unique" because their null
category columns differ.

### Scope is part of the item

Watching one page inside a category and watching the same page across everything
are different questions with different answers, so the scope is stored with the
target rather than taken from wherever the user happened to be standing. The
`WatchButton` carries the on-screen scope into the saved row, and re-visiting the
same page in the same scope offers a link to the existing watch instead of a
second copy of it.

---

## 2. The signals

Seven, each classified by how it may be read (`lib/watchlist/contract.ts`):

| Signal | Kind | Clock / basis |
|---|---|---|
| `PAGE_NEWLY_FOUND_AD` | event | `ads.first_seen_at` — PT Glory's sighting |
| `PAGE_STARTED_AD` | event | `ads.start_date` — Meta's claim |
| `PAGE_STATUS_OBSERVED_CHANGE` | state | observation at the baseline vs newest observation |
| `PAGE_REUSE_CHANGED` | state | `collation_count`, same two observations |
| `PAGE_NEW_FORMAT_OBSERVED` | first observed | a `display_format` no pre-baseline observation in scope carried |
| `PAGE_NEW_CTA_OBSERVED` | first observed | same, for `cta_type` |
| `CATEGORY_NEWLY_FOUND_AD` | event | `first_seen_at`, across the category |

Defaults are restrained — two signals for a page, one for a category. A watch
that tracks everything is a report nobody reads; the rest are one checkbox away.

**Events** belong to the interval `[baseline_at, now)`. **States** are only
meaningful against a reference instant, so the baseline state is reconstructed
with the frozen `trend_state_scope()` from P2.5 rather than a second definition
of "as of". **First observed** compares the current values against every
observation collected before the baseline.

### The distinction the whole feature turns on

A state signal reading `0` can mean two different things:

- we looked again and nothing had changed, or
- nothing has been collected since the baseline, so we have not looked.

`watchlist_signal_summary` returns `new_observations` alongside every row, and
when it is zero the UI prints *"ยังไม่มี observation ใหม่หลังจุดอ้างอิง —
ไม่ใช่ว่าไม่มีการเปลี่ยนแปลง"* instead of letting the zero speak. This is
asserted in the unit tests, in the DB tests and in the browser.

### Count and evidence are the same query

`value` is always the number of ads `watchlist_signal_evidence` returns for that
signal — never a count of distinct values, never a count of observations. The
first-observed signals carry the values themselves in `new_values` so the screen
can name `VIDEO` without the number meaning "one format". The DB suite asserts
`length(evidence) == value` for every signal, and the e2e spec re-asserts it in
the browser by clicking each count.

---

## 3. Dataset scope is a snapshot

A dataset holds exactly one collection run. Nothing later can be added to it, so
there is nothing for a baseline to measure — and pulling observations from
outside the dataset would silently rewrite what that dataset says. The changes
panel is therefore **unavailable by design** on a dataset-scoped watch, with the
reason on screen, rather than empty by accident.

---

## 4. Ownership and permissions

`watch_items` has RLS with four own-only policies (`created_by = auth.uid()`),
and `created_by` cannot be forged on insert.

**A deliberate role decision, different from the rest of the system:** any
authenticated role-holder, **including Viewer**, may create and manage their own
watches. Every other write path in this product requires Analyst or Admin. The
difference is what is being protected: those tables hold canonical imported data
shared by everyone, while a watchlist is personal research state that changes no
dataset, ad or observation. A Viewer with a watchlist can still change nothing
anyone else can see. This is recorded here and in the migration comment because
it is a divergence from the standing write rule, not an oversight.

All five functions follow the read-layer contract unchanged: `SECURITY INVOKER`,
`authenticated` only, revoked from `PUBLIC` and `anon`, pinned `search_path`.
Because they are invoker-side, another user's watch resolves to zero rows rather
than to an error — RLS is the boundary, and the detail route turns "no row" into
a 404 without a second check.

---

## 5. What is computed, and where

| Function | Returns |
|---|---|
| `watch_scope_ads` | the ads one watch is about, via `page_scope_ads` |
| `watchlist_signal_summary` | one row per applicable signal: value, `new_values`, `new_observations`, baseline |
| `watchlist_signal_evidence` | the ads behind one signal, in the frozen evidence row shape |
| `watchlist_list` | the list page: identity, scope, baseline, tracked signals, last collection |
| `watchlist_reset_baseline` | the one write: `baseline_at = now()` |

Nothing here defines a new notion of scope, membership or "as of". Every one of
those comes from P2.1–P2.5 primitives (`page_scope_ads`,
`page_scope_observations`, `trend_state_scope`), so a watch cannot drift away
from what the rest of the product says about the same data.

The list page computes no signals: one row per watch, no per-item intelligence
query. Signals belong to the detail page, where the reader asked for them.

---

## 6. The baseline

- Set to server `now()` when the watch is created.
- Moves **only** when a person confirms "ตั้งจุดอ้างอิงใหม่".
- Opening a watch never advances it. A screen that quietly marked itself read
  would destroy the one thing the feature is for.
- Editing which signals are tracked never touches it — two separate decisions,
  asserted in both test layers.
- Resetting is irreversible and says so first: there is no event history, so what
  stops being counted does not come back.

---

## 7. Tests

| Layer | File | Covers |
|---|---|---|
| Unit | `tests/watchlist.test.ts` (15) | allowlist, defaults, classification, monitoring-vocabulary ban, forbidden-metric ban, scope round-trip, snapshot semantics, the state note |
| DB | `tests/db/watchlist.test.ts` (17) | shape constraints, duplicate prevention, per-signal reconciliation, baseline reset and signal editing, snapshot safety, soft-deleted scope, cross-user RLS through a real JWT, catalog permissions |
| E2E | `e2e/p2-watchlist.spec.ts` (15) | the §54 journey end to end, evidence drill-down per signal, reload, keyboard, 1440/768/375 |

The e2e spec imports its second collection **after** the watch is created, with
`generated_at` set at test time. A fixture written beforehand would sit on the
wrong side of the baseline and every signal would read zero for the right reason
and the wrong test.

Screenshots: `test-artifacts/visual/p2-watchlist/`.

---

## 8. What Watchlist V1 cannot answer

- *"Tell me when this page starts a new campaign."* No collection loop (C1.9), no
  evaluator, no notification.
- *"What changed while I was away?"* Only what changed between the baseline and
  the data collected so far — and only for ads that were collected again.
- *"Did the advertiser stop this ad?"* Only that the status **we observed**
  changed. The real stop time is not in the source.
- *"Is this page winning?"* No performance data exists anywhere in this system.
- *"How did this number get here?"* — that one it does answer: every count opens
  the exact ads behind it.
