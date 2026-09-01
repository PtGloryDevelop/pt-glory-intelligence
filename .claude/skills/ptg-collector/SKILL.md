---
name: ptg-collector
description: Use for PT Glory collector/normalizer changes to test against real fixtures, preserve provenance, protect session secrets, and measure field-coverage regressions.
---

# PT Glory Collector Change

Use when changing Extension/SocialAPIs ingestion or collector normalization.

## Rules

- compare against real captured/exported fixtures
- preserve source provenance
- distinguish raw upstream field from normalized business meaning
- do not hard-code assumptions from one ad/page/query
- maintain stable `ad_archive_id` dedup
- verify page ID/profile numeric ID separately
- test multi-platform/category values
- do not expose/store browser session secrets
- measure field coverage before/after

## Regression Output

Report coverage deltas for critical fields and any schema compatibility impact.
