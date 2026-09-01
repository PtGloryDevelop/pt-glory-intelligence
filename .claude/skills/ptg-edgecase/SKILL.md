---
name: ptg-edgecase
description: Use before completion to audit PT Glory features for partial data, duplicates, history changes, retries, permissions, provider failures, and other edge cases.
---

# PT Glory Edge Case Audit

Audit a feature before it is considered complete.

Check at least:

- null/missing optional fields
- partial dataset coverage
- duplicates
- repeated import
- same ad across datasets
- changing page name/page likes/collation
- empty dataset
- large dataset
- interrupted background job
- retry/idempotency
- stale data/freshness
- permission denial
- provider timeout/rate limit/invalid response
- browser refresh/navigation
- unsupported source capability
- localization/date/time handling
- multi-value platforms/categories

For each relevant edge case, state expected behavior and required test.
