---
name: ptg-import
description: Use for PT Glory JSON import/normalization/dedup/history pipeline changes with strict identity, observation, provenance, and safety rules.
---

# PT Glory Import Pipeline

Use when implementing or modifying collector JSON ingestion.

## Required Pipeline

Validate
→ Preview
→ Normalize
→ Deduplicate
→ Upsert Page/Ad master entities
→ Dataset membership
→ Write observations
→ Compute data quality
→ Finalize collection/import status

## Identity Rules

- master ad: `ad_archive_id`
- one ad can belong to many datasets
- page id and profile numeric id are separate

## History Rules

Do not lose earlier observations when importing a known ad.

## Safety

Do not persist diagnostic cookies, session tokens, CSRF material, or raw secret-bearing network request bodies into normal tables.

## Tests

Include duplicate, repeated import, changed page/collation, partial/missing fields, corrupted input, and large input cases.
