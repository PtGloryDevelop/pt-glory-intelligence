# Spike — one real Apify run against the data contract

Date: 2026-09-11 · Part of Phase 15 (see `GRILL_2026-09-11_PHASE15-COLLECTION-UX.md`) ·
No product code written.

## The run

- Actor: `curious_coder/facebook-ads-library-scraper`, run by the owner in the
  Apify Console. No token passed through Claude or the server.
- Input: one Ad Library search URL — keyword `วิตามินสลายไขมัน`, country TH,
  active only, `keyword_unordered`, sorted by total impressions (the same query
  the Pilot collected with the Extension on 2026-09-07 and 2026-09-10);
  `limitPerSource` 50; `scrapeAdDetails` off; total-records field cleared.
- Output: **59 items** (the documented overshoot of up to 30 over the limit),
  495 KB. The raw export stays on the owner's machine: it holds signed fbcdn
  URLs, which never enter git.

## Coverage against `lib/collector/contract.ts`

| Our key | Apify path | Filled |
|---|---|---|
| `ad_archive_id` (identity) | `ad_archive_id` | 100% |
| `page_id` (**required**) | `page_id` | 100% |
| `start_date` (**required**) | `start_date` (epoch seconds) | 100% |
| `page_name` | `page_name` | 100% |
| `page_like_count` | `snapshot.page_like_count` | 100% |
| `page_categories` | `snapshot.page_categories` | 100% |
| `page_profile_uri` | `snapshot.page_profile_uri` | 100% |
| `is_active` | `is_active` | 100% |
| `collation_id` | `collation_id` | 97% |
| `collation_count` | `collation_count` | 90% |
| `display_format` | `snapshot.display_format` | 100% |
| `publisher_platform` | `publisher_platform` | 100% |
| `cta_type` / `cta_text` | `snapshot.cta_type` / `snapshot.cta_text` | 98% |
| `body_text` | `snapshot.body.text` | 100% |
| `title` | `snapshot.title` | 44% |
| `caption` | `snapshot.caption` | 10% |
| `link_url` | `snapshot.link_url` | 10% |
| `link_description` | `snapshot.link_description` | 0% |
| `images` | `snapshot.images[]` (original + resized URLs) | 73% of ads |
| `videos` | `snapshot.videos[]` (hd, sd, preview) | 51% of ads |
| `cards` | `snapshot.cards[]` | 20% of ads |
| `end_date` / `network_end_date_raw` | `end_date` (epoch seconds, **set on every ad**) | 100% |
| `meta_page_id`, `page_profile_numeric_id` | — | not provided (Extension-only; `meta_page_id` is already dropped by the normalizer) |

Partial fields are partial in the source, not lost in transit: the coverage
language the product already uses applies unchanged.

## Cross-collector agreement

27 of the 59 ads are already in the Pilot (882 ads for this keyword across the
two Extension runs). For those 27, the Pilot's latest observation (2026-09-10)
and the Apify item agree on:

| Field | Agree | Differ | Missing |
|---|---|---|---|
| page_id | 27 | 0 | 0 |
| page_profile_uri | 27 | 0 | 0 |
| start_date (epoch → ISO) | 27 | 0 | 0 |
| collation_id | 27 | 0 | 0 |
| display_format | 27 | 0 | 0 |
| publisher_platform (set) | 27 | 0 | 0 |
| cta_type | 27 | 0 | 0 |
| is_active | 27 | 0 | 0 |
| collation_count | 25 | 0 | 2 (null in Apify) |
| body_text | 27 | 0 | 0 |

The start dates match to the second, so the conversion needs no timezone
correction. The other 32 ads are new to the Pilot.

## What the adapter must do

1. **Allowlist, then validate.** The validator rejects a whole file on any
   unknown or forbidden key. Every Apify item carries `impressions_with_index`
   (with `impressions_index` populated on all 59), `reach_estimate`, `spend`,
   `currency` and `total_active_time`, plus about 60 keys outside the contract.
   The adapter maps only contract keys and discards the rest; only the *names*
   of discarded keys are kept, as provenance.
2. **Dates.** Epoch seconds → ISO 8601 UTC. Apify fills `end_date` even for
   active ads, so it goes to `network_end_date_raw`; `end_date` follows the
   existing Extension semantics (never a confirmed stop for an active ad — to be
   pinned in the spec against the normalizer and the golden fixture).
3. **Flatten** `snapshot.*` and `snapshot.body.text` into the contract's
   top-level keys.
4. **Media.** Every media URL in the sample is on `*.fbcdn.net` and passes the
   existing allowlist. Landing links (`gowabi.com`, Instagram) and `facebook.com`
   page links never enter the media path. The CDN edges differ from the
   Extension's (the actor's proxy location), so whether the archive can fetch
   them before expiry is verified at the first real import, not assumed.
5. **Provenance.** `collection_method` needs a new value for Apify; the
   Ad Library URL the server builds becomes `collection_runs.source_url`.

## Available but outside the contract (not proposed now)

`snapshot.page_profile_picture_url`, `contains_digital_created_media`,
`page_is_deleted`, `targeted_or_reached_countries`, `categories`,
`gated_type`. Adding any of them is a contract change for the owner to decide.

## Cost

Published price: US$0.75 per 1,000 ads (pay per event) → about US$0.044 for 59
ads. **The actual charge from the Console run is still to be confirmed** before
the budget guard is specified.

## Verdict

The recommended actor is viable as the primary provider. It covers every field
the product displays, agrees with the Extension on every overlapping ad, and
needs only a mapping, a date conversion and a forbidden-key strip — no new
canonical fields and no change to the import engine.
