---
name: ptg-code-review
description: Use to review PT Glory code changes for correctness, data integrity, unsupported metrics, security, idempotency, and meaningful test coverage.
---

# PT Glory Code Review

Review the actual diff and surrounding code, not just the intended design.

Prioritize:

1. correctness
2. data integrity/history
3. unsupported metric leakage
4. security/authz
5. idempotency/retry behavior
6. performance on expected dataset size
7. tests that prove critical behavior
8. maintainability without overengineering

Explicitly verify:

- no fake performance fields
- no master-ad duplication bug
- observations are not overwritten incorrectly
- multi-value fields are treated correctly
- AI counts/percentages are deterministic
- client does not receive server secrets

Report findings by severity with file/line references when available.
