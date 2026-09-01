# Test Strategy

## Goal

The objective is not merely to have many tests. The objective is to prove critical user journeys and business/data rules work and stay working.

## Layers

### Unit

Pure normalizers, derived metric functions, validators, taxonomy helpers.

### Integration

Database writes/reads, import transaction behavior, API boundaries, auth/RLS rules.

### E2E

Real browser journey with Playwright.

### Deterministic Fixtures

Known collector exports with expected normalized outputs and derived metrics.

### Provider Mocks

External AI/provider failures, timeouts, invalid response, rate limit, partial response.

## Critical Import Cases

- normal valid JSON
- missing optional title
- missing CTA
- missing destination
- missing media
- duplicate ad in same file
- same ad across datasets
- same page id with changed name
- changed page likes
- changed collation count
- reimport same exact file
- partial run
- corrupted JSON
- large input (5k+ records)
- network/backend/database interruption
- refresh/navigation during import

## Critical AI Cases

- evidence list matches classified ads
- count and denominator are deterministic
- low coverage adds warning
- no unsupported performance language
- prompt/model version persisted
- repeated identical analysis can be cached

## Production Gate

As applicable, require:

- Unit pass
- Integration pass
- E2E pass
- DB test pass
- deterministic fixture pass
- provider mock pass
- lint pass
- type check pass
- build pass
- auth/authz pass
- migration validated
- rollback plan exists
- security review completed
- critical regression tests pass
