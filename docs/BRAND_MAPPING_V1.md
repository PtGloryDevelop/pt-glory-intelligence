# Brand Mapping V1 (P2.8)

Date: 2026-09-09 · Migration `0033` · Built on the frozen P2.1–P2.7 foundation
(`903368d` … `309a50a`)

Brand Mapping records an explicit, human-made grouping of Pages into a Brand,
with a start date, an author, and a full history of every decision that
preceded it.

## Page is not Brand

The rule stays frozen, and this phase does not soften it:

- A Brand may hold one Page or many. A Page belongs to at most one Brand at a
  time.
- **A Page never becomes a Brand because its name looks similar.** Two of the
  e2e fixture Pages share a display name on purpose; nothing in the product
  suggests they belong together, and the mapper shows `page_id` beside every
  name so a reviewer never picks from what is on screen.
- No Page-level metric changed meaning. Every Page surface reads exactly as it
  did before, and the Brand appears there only as labelled metadata:
  **`Brand (จัดกลุ่มโดย PT Glory)`**.

## What this is not

- No AI mapping, no fuzzy name linking, no domain linking, no sibling
  detection, no confidence score, no "likely brand", no silent merge.
- No suggestions at all — not even reviewed ones. That was explicitly out of
  scope, and building the suggestion path first would have made the review
  queue a place where people confirm a machine rather than decide.
- No Brand Intelligence: no Brand timeline, compare, trends, share of voice, or
  Brand Watch target. Watchlist targets remain PAGE and CATEGORY.
- No spend, reach, engagement or market share, here or anywhere.

`tests/brands.test.ts` scans every Brand string in the product for inference
vocabulary (`AI`, `เดา`, `แนะนำแบรนด์`, `confidence`, `fuzzy`, `น่าจะเป็น`)
outside an explicit denial, and for forbidden metric names.

---

## 1. Identity

| Thing | Identity | Never |
|---|---|---|
| Page | `pages.page_id` | page name, `page_profile_uri`, `page_profile_numeric_id` |
| Brand | `brands.id` (uuid) | the Brand name |

Renaming a Brand moves nothing: the mapping references the uuid, and the DB
suite proves that renaming leaves every mapping row byte-identical.

`brands.name` is unique in **normalized** form — lowercased, trimmed, internal
whitespace collapsed — via a unique index on `brand_normalized_name(name)`.
That normalized form lives in SQL only. A second copy in TypeScript would drift
from the index that actually enforces uniqueness, so the app never normalizes;
it sends the name and handles the collision.

A collision is **shown, never resolved**: the create endpoint returns 409 with
the existing Brand attached, and the UI offers it as a choice. Two companies
may legitimately share a name.

---

## 2. The mapping is an interval

`brand_page_mappings` holds one row per decision:

```
brand_id, page_id, valid_from (inclusive), valid_to (exclusive, null = current),
mapped_by / mapped_by_label, ended_by / ended_by_label, note
```

Nothing is ever updated in place except the end of an interval. A move closes
the old row and opens a new one; an unmap closes the current row and adds
nothing. **No decision is ever deleted.**

This is why: a Page can be renamed, repurposed, transferred, or mapped by
mistake and corrected months later. A `brand_id` column on `pages` would make
that correction rewrite history — every past observation would retroactively
belong to the new Brand, and no screen would show that it had happened.

### Enforced by the database

| Invariant | How |
|---|---|
| One Brand per Page at any instant | `EXCLUDE USING gist (page_id WITH =, tstzrange(valid_from, coalesce(valid_to,'infinity')) WITH &&)` |
| Many Pages per Brand | nothing forbids it |
| Intervals never overlap for one Page | the same exclusion constraint |
| `valid_to > valid_from` | `CHECK brand_mapping_period` |
| Brand and Page exist | foreign keys |
| A Brand with history cannot be deleted | `on delete restrict` |

The exclusion constraint needs `btree_gist`, which `0033` installs. The DB
suite proves a second active mapping is refused at the table, not merely
avoided by the application.

### The clock

`brand_map_page` closes the old interval at
`greatest(clock_timestamp(), valid_from + 1 microsecond)` and opens the new one
at exactly that instant — adjacent, never overlapping, never a gap.

`clock_timestamp()` rather than `now()` because `now()` is transaction start:
mapping and then moving a Page inside one transaction would try to close an
interval at the instant it opened, which the period check rightly refuses. This
was a real defect, found by the first smoke run and fixed before the tests were
written.

### Effective date

V1 is **server-now only**. `valid_from` is the moment the decision was recorded;
there is no backdating. Recording "this Page has really belonged to Brand A
since March" would need a second notion of time — editorial effective date
versus decision date — and a UI that keeps them apart. Rather than invent it
silently, V1 records what it actually knows. Stated again in §8 below.

---

## 3. One rule, read by everything

`brand_mapping_at(p_at timestamptz)` is the single definition of "which Brand
held which Page". Every other function reads it, `brand_mapping_at(now())` is
the current view, and there is no second implementation of `valid_to is null`
anywhere — a screen with its own copy would eventually disagree with the one
beside it and neither would look wrong.

The temporal lookup is proven, not just written: the DB suite maps a Page to A,
records the database's clock, moves it to B, and asserts `lookup(before) = A`
while `lookup(now) = B`.

| Function | Returns |
|---|---|
| `brand_mapping_at(at)` | the mapping rule, at any instant |
| `page_brand(page_id)` | the Brand a Page is in now, for the Page surfaces |
| `brand_list(search, status, limit, offset)` | management rows: name, status, active pages, ever-mapped pages, last change |
| `brand_detail(brand_id, scope, scope_id)` | one Brand plus its scoped ad count |
| `brand_pages(brand_id, scope, scope_id)` | current Pages with observed context |
| `brand_mapping_history(brand_id, page_id, limit)` | history, filtered either way |
| `unmapped_pages(scope, scope_id, search, sort, limit, offset)` | the review queue |
| `brand_map_page(brand, page, note, label)` | map — and move — atomically |
| `brand_unmap_page(page, label)` | close the current interval |

Membership comes from `page_scope_ads`, the frozen P2.1 primitive. Brand
Mapping defines no new notion of scope, membership or "as of".

---

## 4. Brand-level numbers, deliberately hemmed in

Brand Detail shows exactly one aggregate: **distinct ads reached through the
Pages mapped to this Brand today, inside one stated scope** (default `all`,
written on screen).

- Deduplicated by ad master, so an ad seen through two mapped Pages or two
  datasets is one ad. The DB suite asserts this against an independent count.
- **Not a historical attribution.** A Page that moved here last week brings its
  ads with it. Attributing ads to the Brand that held the Page *at the time*
  needs the temporal join this phase deliberately did not ship — see §8.
- Not spend, reach, engagement or share of anything. `BRAND_ADS_BASIS` says all
  of this on the page, and the unit tests hold it to it.

The Brand **list** shows no ad count at all: a Brand total needs a stated scope,
and a list row has nowhere to state one.

---

## 5. Unmapped Pages

An unmapped Page is a canonical Page with no active mapping. That is a review
queue, not an error and **not a data-quality tier** — the normal/partial/low
coverage language means something specific in this product (what the collector
saw) and is never borrowed for human work.

Ordering is deterministic and about review efficiency: most observed ads,
recently found, last observed, page name. No ordering names a likelihood,
because none is computed.

Each row carries page name **and** `page_id`, Meta's page categories, observed
ads, recently-found count, and first/last observed. The Page name links to the
full frozen Page Intelligence surface — inspection before a decision uses the
real screen, not a weaker copy of it.

---

## 6. Roles and RLS

Brand mapping changes shared canonical editorial data, so it follows the
standing rule from `0016` and **not** the Watchlist own-row exception:

| | brands / brand_page_mappings |
|---|---|
| anon | nothing — table grants revoked, function EXECUTE revoked |
| viewer | read only |
| analyst | read, create, map, move, unmap, rename, archive |
| admin | same, plus delete (never exposed in the UI) |

The mutation functions are `SECURITY INVOKER`, so the write policies are the
real boundary; the explicit role check inside them is a clearer refusal, not the
gate. All ten functions are INVOKER, `authenticated`-only, revoked from PUBLIC
and anon, with a pinned `search_path` — asserted per function in the DB suite
and covered by the permanent all-function sweep from P2.6 (`0031`).

The DB suite proves a viewer is refused through the RPC *and* through a direct
table insert, that anon is refused at the grant on tables and functions alike,
and that no policy on either table uses `auth.uid()`.

Editorial provenance stores an email **snapshot** (`mapped_by_label`,
`ended_by_label`) alongside the uuid, because `auth.users` is not readable from
the app's role — a uuid alone would render as nothing a person recognises, and
would keep doing so after the account is deleted.

---

## 7. Lifecycle

| Action | Effect |
|---|---|
| Create Brand | a new `brands` row, `active` |
| Rename | `brands.name` only; mappings untouched |
| Map | closes any current interval, opens a new one — atomically |
| Move | the same call; the UI names both Brands and asks first |
| Re-map to the same Brand | a no-op; re-recording a decision nobody made would put a false date on it |
| Unmap | closes the current interval; the Page returns to the queue |
| Archive | keeps every mapping, refuses new ones |
| Restore | archived → active |
| Delete | **not offered.** A Brand with history is the record of decisions people made |

A move is never called a merge. Merging two Brands is a different operation with
different consequences, and this product does not have it.

---

## 8. What this phase deliberately did not solve

1. **Historical Brand analytics are deferred.** The temporal primitive exists
   and is proven, but no surface joins observations to the Brand that held their
   Page at the time. Until that join is designed, Brand Timeline, Brand Trends
   and Brand Compare stay unbuilt — a Brand number that silently attributed all
   history to today's mapping would be wrong in exactly the way nobody notices.
2. **No backdated effective dates.** `valid_from` is when the decision was
   recorded. See §2.
3. **No suggestions**, reviewed or otherwise.
4. **No Brand Watch target.** Watchlist stays PAGE and CATEGORY.
5. **No Brand aliases.** Nothing needed them yet, and taxonomy management built
   ahead of a use is taxonomy management nobody maintains.
6. **Brand and research Category stay separate axes.** No `brand_category_id`:
   a Brand's grouping is Page membership, and a Brand can appear in as many
   research categories as its Pages do.

---

## 9. Tests

| Layer | File | Covers |
|---|---|---|
| Unit | `tests/brands.test.ts` (12) | name validation, statuses, queue ordering, inference-vocabulary ban, forbidden-metric ban, move/unmap/archive/duplicate wording |
| DB | `tests/db/brands.test.ts` (18) | normalized uniqueness, role matrix through real JWTs, anon refusal, one-active-mapping enforcement, atomic move, temporal lookup, no-op re-map, archive rules, delete restriction, unmap keeping history, distinct ad counting, scope narrowing, rename safety, soft-deleted datasets, catalog and policy sweep |
| E2E | `e2e/p2-brand-mapping.spec.ts` (16) | the §62 journey end to end, duplicate handling, Page Detail integration, viewer read-only (UI and API), keyboard, 1440/768/375 |

Screenshots: `test-artifacts/visual/p2-brand-mapping/`.
