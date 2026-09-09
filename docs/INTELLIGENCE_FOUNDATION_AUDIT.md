# Intelligence Foundation Audit (P2.6)

Date: 2026-09-09 · Audited commits: `903368d` … `e287d6b`

This is a checkpoint, not a feature. It asks one question — *is the deterministic
foundation coherent enough to build monitoring on?* — and ends with a single
go/no-go for Watchlist.

## Frozen slices

| Slice | Commit | Migration |
|---|---|---|
| P2.1 Page Intelligence | `903368d` | 0026 |
| P2.2 Page Timeline | `6c54455` | 0027 |
| P2.3 Category Workspace | `81794c5` | 0028 |
| P2.4 Page Compare | `86de994` | 0029 |
| P2.5 Trends | `e287d6b` | 0030 |

Audit changes: 0031 (one privilege correction) and two regression tests. No
feature code was touched.

---

## 1. Scope model

Three scopes, one shape: `dataset:<uuid>` · `category:<uuid>` · `all`.

| Scope | Membership | Current view | Historical | Snapshot? |
|---|---|---|---|---|
| dataset | `dataset_ads` of that dataset | the dataset's own run — one observation per ad | that one run | **yes** |
| category | `dataset_ads` of every dataset in the category | latest observation per ad among those runs | all runs in the category | no |
| all | `dataset_ads` of every non-deleted dataset | latest observation per ad, anywhere | every run | no |

Soft-deleted datasets are excluded once, inside the primitives, not in callers.

Because a dataset holds exactly one run, "latest observation in scope" *is* that
dataset's snapshot. One rule serves all three scopes; the wider two say on screen
that they are not a snapshot.

**Finding:** no accidental variation. Every surface parses the scope with
`parseScope` and passes it through `scopeArgs`.

## 2. The two truth layers

**Current view** — `page_scope_observations(scope, id)`: the newest observation
of each distinct ad in scope. Feeds Page overview, Category overview and ranking,
Compare, and every creative mix.

**Historical** — `page_scope_ads(scope, id)` plus the runs themselves. Feeds Page
Timeline, Category Activity, Compare timelines, and Trends' event series. It
never reduces to the latest observation.

**Reconstruction** — `trend_state_scope(scope, id, reference)`: the current-view
rule with a clock on it. With `reference` in the future it returns exactly the
current view, which is what makes the two provably consistent (guarded by
`tests/db/foundation-audit.test.ts`).

## 3. Three clocks

| Clock | Column | Canonical Thai | Means |
|---|---|---|---|
| Meta start | `ads.start_date` | เริ่มแสดง (วันที่ Meta ระบุ) | when Meta says the ad began |
| PT Glory first seen | `ads.first_seen_at` | PT Glory พบครั้งแรก | when we first observed it, **globally** |
| Collection | `collection_runs.collected_at` | พบในรอบเก็บ / เก็บเมื่อ | when a collection happened |

No surface renders a bare "วันที่เริ่ม". `first_seen_at` is documented as global
in `METRIC_SOURCE.first_seen` and asserted by a unit test.

**`first_seen_at` is global and always will be.** Scope membership decides *which*
ads are counted; `first_seen_at` decides *when* we first saw them, anywhere. It is
not scope-local first-seen, not category entry, and not a launch date.

## 4. Event / state taxonomy

| Kind | Members | Belongs to |
|---|---|---|
| EVENT | Meta start, PT Glory first seen | a window |
| STATE | active / inactive / unknown, evergreen, reuse, format, CTA, platform, page-observation fields | an instant |
| COLLECTION | observed in run, run context, run density | a run |

`lib/trends/metrics.ts` is the registry; a unit test asserts the split and that
every state label says "ณ ปลายช่วง".

**Finding:** no feature treats a state as an event. Trends is the only surface
that needs both, and it labels each row.

## 5. Metric registry

| Metric | Source | Scope | Time | Denominator | Evidence | Must never mean |
|---|---|---|---|---|---|---|
| Observed Ads | distinct `ads` in scope | membership | current view | — | `page_ads` / `category_evidence` | all ads that exist |
| Recently Found | `first_seen_at` in window | membership | event | window | signal `recent` | market entry |
| Started Recently | `start_date` in window | membership | event | window | signal `started_recently` | when we saw it |
| Evergreen | active AND age ≥ `evergreen_threshold_days()` | current view | state | — | signal `evergreen` | a winning ad |
| Reused | `collation_count > 1` | current view | state | — | signal `reused` | identical bytes, or performance |
| Active / Inactive / Unknown | `is_active` | current view | state | observed | signals | unknown = inactive |
| First / Last Observed | `collection_runs.collected_at` | runs that saw the page | collection | — | run history | the ad's dates |
| Ad Age | reference date − `start_date` | — | state | — | sort `longest_running` | still running, when state is unknown |
| Format | `display_format` | current view | state | ads with a readable format | mix bucket | effectiveness |
| CTA | `cta_type` | current view | state | ads with a readable CTA | mix bucket | missing CTA = no CTA |
| Platform | `publisher_platform` | current view | state | ads observed (multi-value) | mix bucket | a share of a whole |
| Page ranking | observed ads per page | current view | state | category observed ads | `category_evidence?page=` | market leadership |
| Share of observed ads | page ÷ category observed | current view | state | **always printed** | ranking row | market share |
| Trend delta | current − previous | both | window or instant | — | period evidence | growth, momentum |

**Finding:** no second metric engine exists. Compare adds none at all — 0029
contains no formula, only projections of 0026/0027.

## 6. SQL dependency graph

```
evergreen_threshold_days()            [SECURITY DEFINER, app_settings]
        ▲
page_scope_observations(scope,id)  ── current view primitive
   ▲    ▲        ▲            ▲
   │    │        │            └── trend_evidence (event mode)
   │    │        └── category_* (detail, pages, creative_mix, evidence)
   │    └── page_detail, page_creative_mix, page_ads, page_timeline_evidence
   └── page_in_scope? no — uses page_scope_ads

page_scope_ads(scope,id)           ── membership primitive
   ▲    ▲        ▲          ▲
   │    │        │          └── trend_summary (event rows), trend_pages
   │    │        └── category_activity
   │    └── page_timeline
   └── page_in_scope

trend_state_scope(scope,id,ref)    ── current view + a clock
   ▲        ▲            ▲
   │        │            └── trend_evidence (state mode)
   │        └── trend_mix
   └── trend_summary (state rows)

page_detail        ──▶ page_compare_summary   (projection + side label)
page_creative_mix  ──▶ page_compare_mix       (projection + side label)
page_timeline      ──▶ page_compare_timeline  (projection onto one clock)
```

Three primitives, not five stacks. Compare is a pure projection layer.

## 7. Duplicated definitions — the foundation's main debt

`evergreen`, `reused` and `recently found` are *re-expressed* rather than called:

| Predicate | 0026 | 0027 | 0028 | 0029 | 0030 |
|---|---|---|---|---|---|
| scope filter | 6 | 4 | 0 | 0 | 3 |
| evergreen | 3 | 0 | 4 | 0 | 3 |
| reuse | 4 | 0 | 4 | 0 | 3 |
| recent window | 5 | 0 | 6 | 0 | 0 |

The tunable (`evergreen_threshold_days()`) is centralised, so the *number* has one
home; the *shape* of the predicate does not. Measured against real data, all three
implementations agree exactly, and a new regression test
(`tests/db/foundation-audit.test.ts`) now fails if any of them drifts.

Classified **D — architecture debt, mitigated by test**. Not corrected in place:
rewriting five frozen migrations to share predicates would risk more than it
buys, and the guard makes drift loud.

## 8. Evidence contract

Every user-visible count is either drillable (A) or non-drillable for a stated
reason (B).

| Surface | Drillable | Non-drillable, and why |
|---|---|---|
| Page detail | all KPIs, mix buckets, signals | — |
| Page timeline | started/first-seen buckets, run totals, per-state run counts | run *identity* metadata |
| Category | overview, ranking, mix, signals, activity buckets | Meta page-categories (page metadata, not an ad filter); "—" buckets (unreadable is not a filterable value) |
| Compare | every matrix cell, every mix bucket, every timeline bucket | rows whose count is 0 |
| Trends | every metric × period, every mix bucket | contributing-run rows |

Reconciliation is asserted in SQL for every one of these, in every slice.

**Finding:** no count exists without reproducible evidence.

## 9. Evidence components

`EvidenceGrid` → `AdCard` → `AdDrawer` is the single implementation. P2.3
extracted it; P2.2's `BucketEvidence` is a re-export. Compare and Trends pass
`testId` and rows. No duplicated pagination logic — every surface pages in the
SQL and caps the preview at 24 with the total stated.

## 10. Coverage contract

Thresholds live once, in `lib/collector/coverage.ts` (`tierFor`), and the wording
once, in `lib/domain/coverage-language.ts`: ≥80% normal · 50–79% partial · <50%
low · nothing measured = unknown.

- Denominator is printed everywhere a percentage is.
- Below 80% the heading scopes itself to the readable subset.
- **Compare keeps coverage per side**; the thinner side governs the wording.
- **Trends keeps coverage per period**; the thinner period governs.
- Multi-value dimensions state that shares can exceed 100%.

## 11. Multi-value semantics

`publisher_platform` and `page_categories` carry `exclusive = false` from SQL to
the components. No pie, no donut, no 100%-stack anywhere in the codebase. Every
multi-value panel prints the "หนึ่งโฆษณามีได้หลายค่า" note.

## 12. Page ≠ Brand

No function merges pages, matches names, or groups siblings. Ranking is by page.
The sidebar keeps the planned "เพจ / แบรนด์" wording with a comment saying what
is actually behind it. Compare labels its sides "Page A" / "Page B".

Watchlist may therefore reference **page identity directly**; Brand mapping is not
a prerequisite (see §17 below).

## 13. Internal category vs Meta page category

`categories.id` is the research grouping; `page_observations.page_categories` is
Meta's metadata. 0028 names Meta's dimension `page_category` throughout, the UI
labels it "หมวดเพจ (จาก Meta)", and an e2e test asserts the workspace title is not
that label. No renaming needed.

## 14. Page identity

`pages.page_id` is canonical and unique. `page_profile_numeric_id` and
`page_profile_uri` are carried but never used to merge or match. No P2 feature
introduced identifier merging.

**Watchlist must persist `pages.page_id`** (and `categories.id` for a category
target). Never a display name: names change between observations, and the
product already keeps the history that proves it.

## 15. Function security

Swept all 40 product functions at once (`tests/db/foundation-audit.test.ts`):
SECURITY INVOKER, `search_path` pinned, revoked from PUBLIC and anon, granted to
authenticated.

**One defect found and fixed (0031):** `jsonb_text_array` (0017) kept
PostgreSQL's default EXECUTE to PUBLIC — created before the convention existed,
and invisible because each migration only asserts its own group. It reads no
table and has no side effect, so nothing was exposed; it was reachable by an
unauthenticated caller, which is now closed. The sweep is a permanent test.

Deliberate exceptions, documented and asserted:

- `current_user_role`, `evergreen_threshold_days` — DEFINER by design.
- `run_media_archive_drain` — DEFINER **and** not executable by app roles; it is
  the machine drain from C1.8.
- pg_trgm's own functions are extension-owned and excluded.

## 16. Query counts per render

Measured from the code paths (evidence loads only on selection):

| Route | Reads on first render | With a selection |
|---|---|---|
| Page list | 2 | — |
| Page detail (overview) | 5 | 6 |
| Page detail (timeline) | 4 | 5–6 |
| Category workspace | 6 | 7 |
| Compare | 4 | 5 |
| Trends (category) | 6 | 7 |
| Trends (page) | 8 | 9 |

No N+1 anywhere: page rankings are single set-based queries, and Compare reads
both sides in one call per section.

**One avoidable read:** `nameOfScope()` calls `listDatasets()` or
`listCategories()` — a full list — to resolve one name, on four routes.
Classified **C, low** — the lists are small and it is one query, but a scoped
name read would remove it.

## 17. Query plans

Measured on a synthetic engineering load: 500 pages × 8 ads × 3 runs =
**4,000 ads / 12,000 ad observations / 1,500 page observations**, built and
deleted by a throwaway script. Current DEV holds ~12 ads, which measures nothing.
These tiers are engineering loads, not statements about production volume.

Warm execution times at 4,000 ads:

| Read | ms |
|---|---|
| `page_scope_ads` | 4.5 |
| `page_run_history` | 1.6 |
| `page_timeline` | 7.5 |
| `page_scope_observations` | 18 |
| `page_detail` | 30 |
| `page_ads` | 36 |
| `page_creative_mix` | 44 |
| `trend_state_scope` | 56 |
| `category_creative_mix` | 60 |
| `category_evidence` | 67 |
| `category_pages` (ranking) | 66–78 |
| `category_detail` | 72 |
| `page_compare_summary` | 78 |
| `trend_summary` | 179 |
| `trend_mix` | 190 |
| **`page_list`** | **205 warm / 600–800 cold** |

Plans show index access throughout: `datasets_category_idx`,
`ad_obs_history_idx`, `page_obs_run_page_idx`, `dataset_ads_pkey`. No sequential
scan on a large table. Every index in the database is present in a migration —
no drift between schema and `supabase/migrations`.

Two observations worth recording:

1. **`page_list` is the slowest read by 3×.** It does what `category_pages` does
   plus two extra passes over `page_observations` (`latest_page` and
   `page_seen`). It is paginated and runs once per render. **C, accepted** with a
   named follow-up: fold `page_seen` into `latest_page`.
2. **`evergreen_threshold_days()` costs ~7.6 µs per call** because it is SECURITY
   DEFINER with a `search_path` GUC — measured at 31 ms per 4,000 rows against
   0.8 ms for a constant. Each function calls it at most once per row, so it is
   tens of milliseconds, not the main cost. Hoisting it into a CTE would remove
   that. **C, accepted**, same follow-up bucket.

## 18. Index decision

**No index is added.** Nothing in the plans is missing an access path; the two
slow spots are query shape and a per-row function call, neither of which an index
corrects. 0031 contains a privilege fix only.

## 19. Zero vs no observation

| Surface | Distinguishes? | How |
|---|---|---|
| Page timeline | yes | only runs that saw the page are listed |
| Category | yes | contributing datasets listed; empty category has its own state |
| Compare | yes | `page_in_scope` → refusal, never a column of zeroes |
| Trends | yes | comparability verdict `insufficient` + per-period run lists |
| Page trend entity | yes | `page_in_scope` refusal (fixed during P2.5) |

This is the distinction alerting will live or die on, and it holds today.

## 20. Comparability

Two implementations exist — `lib/pages/timeline.ts#comparability` (runs) and
`lib/trends/periods.ts#comparabilityOf` (periods), plus a thin
`lib/categories/workspace.ts#datasetComparability`. They share wording but answer
different questions: the trend version has a third verdict (`insufficient`) that
run-level comparison has no use for. **D, accepted** — not centralised, because
forcing one signature would make the trend verdict meaningless for the other two.
No numeric confidence score exists anywhere.

---

## Watchlist contract (proposal — not implemented)

### Target

```
watch_item
  id
  target_type      PAGE | CATEGORY
  target_key       pages.page_id  |  categories.id     ← never a display name
  scope_kind       dataset | category | all
  scope_id         uuid | null
  tracked_signals  text[]  (allowlist below)
  created_by       auth.users.id
  created_at
```

Scope is **explicit and part of the item**: watching Page X inside
`category:Y` is a different item from watching Page X in `all`. Nothing about a
watch may be implicit, for the same reason nothing about a page's numbers may be.

### Candidate events

| Event | Source | Baseline | Evidence | Does NOT mean |
|---|---|---|---|---|
| `PAGE_NEWLY_FOUND_AD` | `first_seen_at` in window | previous evaluation | the ads | the advertiser just launched it |
| `PAGE_STARTED_AD` | `start_date` in window | previous evaluation | the ads | we saw it then |
| `PAGE_STATUS_OBSERVED_CHANGE` | `is_active` across two runs | previous **run** | both observations | the ad stopped at that moment |
| `PAGE_NEW_FORMAT_OBSERVED` | `display_format` unseen for this page in scope | since watch creation | the ad | a new creative strategy |
| `PAGE_NEW_CTA_OBSERVED` | `cta_type` unseen for this page in scope | since watch creation | the ad | a CTA change (may be coverage) |
| `PAGE_REUSE_CHANGED` | `collation_count` between observations | previous run | both observations | performance |
| `CATEGORY_NEWLY_FOUND_AD` | as above, category scope | previous evaluation | the ads | market growth |
| `CATEGORY_PAGE_ACTIVITY_DELTA` | `trend_pages` delta | previous equal period | the ads on each side | a competitor scaling |

Every one of these is computable from the frozen primitives today. None needs a
new definition.

### Baselines — deliberately not one rule

- **Event counts** (newly found, started): previous evaluation, or a previous
  equal period. `trendPeriods` already produces both windows.
- **State changes** (status, reuse): the previous **run**, because a state has no
  window — comparing to "yesterday" when nothing was collected yesterday would
  invent a change.
- **First-ever observations** (new format, new CTA): since the watch was created,
  since "new" is relative to what the watcher has already seen.
- **Activity deltas**: previous equal trend period.

### Deduplication

Identity: `(watch_item, event_type, subject_key, baseline_run_or_period)` where
`subject_key` is the `ad_archive_id` for ad-level events and the `page_id` for
aggregate ones. An evaluation that produces the same tuple as a stored one is not
a new event. Design only — no table until the Watchlist phase.

### What monitoring would still require

| Capability | Status |
|---|---|
| Saved targets + manual review | possible today |
| Scheduled evaluation | needs an externally reachable deployment (**C1.9, still open**) |
| Notification delivery | needs the above plus a channel |
| "new since our last collection" wording | needs collector cadence; the phrase must never be "just launched" |

Automatic Watchlist monitoring **must not be described as production-ready**
until C1.9 closes. The application is local-only; there is no scheduler, tunnel
or cron workaround in this audit, and none is proposed.

Collection is not a continuous feed. Any future alert means *new since PT Glory's
latest collection*, never *the competitor just did this* — unless `start_date`
independently supports the stronger claim.

---

## Findings

| # | Finding | Class | Status |
|---|---|---|---|
| 1 | `jsonb_text_array` executable by PUBLIC/anon | **B** security | **fixed** (0031) + permanent sweep test |
| 2 | Evergreen / reuse / recent predicates written in three migrations | D | mitigated by agreement test |
| 3 | `page_list` 3× slower than comparable reads at 4k ads | C | accepted; follow-up named |
| 4 | `evergreen_threshold_days()` costs ~7.6 µs/call | C | accepted; hoist available |
| 5 | `nameOfScope` reads a full list to resolve one name | C low | accepted |
| 6 | Two comparability implementations | D | accepted, deliberate |
| 7 | Scope primitives named `page_scope_*` though scope-generic | E | accepted; renaming frozen SQL costs more than it saves |
| 8 | Automatic monitoring impossible | **G** | C1.9 remains open |
| 9 | Long combined Playwright invocations hit import timeouts | C | environmental; run projects separately |

No A remains. The one B is closed.

### Note on finding 9

Running `chromium + c3 + p2` in one invocation (20 minutes) failed three
`beforeAll` hooks — the fixture imports in P2.3, P2.4 and P2.5 — at the 300s
hook timeout. Run per project, the same specs pass: 56 (chromium + c3), 88 (p2),
39 (c2 + v4 + v5), 5 (durable). The imports go through the real browser flow to
the DEV pooler, which is the same intermittent slowness recorded in
`CORE_UI_FINAL_AUDIT.md` §13.

No retry was added. The suite is run per project, which is how the gate has been
executed since V5 anyway.

## Decision

**WATCHLIST V1 — GO**, limited to:

- saved targets (PAGE / CATEGORY) with an explicit stored scope,
- a manual review surface showing current deterministic state from the frozen
  primitives,
- "changes since baseline" only for the signals whose baseline semantics are
  listed above, computed at view time,
- **no** background evaluation, no notifications, no alert history table.

Brand mapping is **not** a prerequisite: every proposed signal is computable from
page and category identities, and the product's own rule is that a Page is not a
Brand. AI is not a prerequisite either — nothing in the contract needs
interpretation.

The prerequisite for the *monitoring* half, and only that half, is C1.9.
