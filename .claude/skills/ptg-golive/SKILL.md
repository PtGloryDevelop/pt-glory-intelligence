---
name: ptg-golive
description: Use for controlled PT Glory production deployment with prechecks, migrations, smoke tests, production E2E, health verification, and rollback readiness.
---

# PT Glory Go Live

Run a controlled production release.

## Before Deploy

- release gate passed
- migrations reviewed
- backup/rollback readiness known
- environment secrets configured server-side
- current production health checked

## Deploy Flow

Precheck
→ apply migration in controlled order
→ deploy application/workers
→ smoke test
→ production E2E critical journey
→ verify logs/errors
→ verify DB writes/reads
→ verify background jobs
→ confirm rollback readiness

If a critical check fails, stop and rollback or contain the release.
