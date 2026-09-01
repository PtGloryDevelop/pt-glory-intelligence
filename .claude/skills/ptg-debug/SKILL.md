---
name: ptg-debug
description: Use for PT Glory bugs to reproduce first, identify root cause, add regression coverage, implement the smallest correct fix, and verify no broader regressions.
---

# PT Glory Debugging Workflow

Do not patch symptoms first.

## Procedure

1. Read relevant code/logs/data.
2. Reproduce the problem reliably.
3. State expected vs actual behavior.
4. Narrow the failing layer.
5. Identify root cause.
6. Add a failing regression test where practical.
7. Implement the smallest root-cause fix.
8. Run focused tests then broader regression.
9. Review for side effects.

For data bugs, inspect the actual stored source/observation history before changing business logic.

For collector-related issues, distinguish upstream/source changes from normalizer/UI bugs.
