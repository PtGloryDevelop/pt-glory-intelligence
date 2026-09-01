---
name: ptg-data-quality
description: Use when PT Glory analysis depends on partial fields; requires coverage denominators, warnings, and scoped claims instead of misleading full-dataset percentages.
---

# PT Glory Data Quality

Use when creating metrics/insights or modifying field parsing/coverage.

## Principle

Coverage is part of the result, not optional metadata.

For each analysis-critical field, track readable/present count and denominator.

Default interpretation:

- >=80% normal
- 50–79% partial warning
- <50% avoid representative claims unless scoped to readable subset

## Output Rule

Prefer:

`CTA readable 485/500; among readable ads, 42% Send Message.`

Avoid:

`42% of the market uses Send Message.`

Map each dashboard/AI insight to required fields and surface warnings when those fields have low coverage.
