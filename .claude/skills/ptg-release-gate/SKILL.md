---
name: ptg-release-gate
description: Use immediately before merge or release to verify PT Glory scope, real-data metric integrity, tests, security, migrations, regression coverage, and rollback readiness.
---

# PT Glory Release Gate

Decide whether a change is ready to merge/release.

## Gate

Check applicable items:

- approved spec/ticket complete
- source-field mapping correct
- unsupported metrics absent
- unit tests pass
- integration tests pass
- E2E critical journey pass
- deterministic fixtures pass
- provider mocks pass
- lint pass
- typecheck pass
- build pass
- auth/authz verified
- security review complete
- DB migration verified
- rollback plan known
- regression tests pass
- docs/data contract updated

Return:

- PASS
- PASS WITH NON-BLOCKING NOTES
- BLOCKED

List exact blockers. Do not lower the bar because many unrelated tests pass.
