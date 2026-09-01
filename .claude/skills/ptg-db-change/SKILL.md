---
name: ptg-db-change
description: Use for PT Glory database/schema/RLS/migration changes requiring compatibility, representative DB tests, history preservation, and rollback planning.
---

# PT Glory Database Change

Use for schema, index, RLS, trigger, function, or data migration changes.

## Required

- explain business reason
- identify affected tables/queries
- migration is forward-safe
- consider existing production data
- test migration on representative data
- verify RLS/authz
- define rollback/containment plan
- verify application compatibility during deployment order

Never silently collapse historical observations into master rows.

Never use destructive migration shortcuts when a safe staged migration is practical.
