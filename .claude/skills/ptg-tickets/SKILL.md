---
name: ptg-tickets
description: Use to decompose an approved PT Glory feature spec into small, independently testable implementation tickets.
---

# PT Glory Ticket Decomposition

Break an approved spec into small independently testable tickets.

## Rules

- Prefer vertical slices where practical.
- Each ticket must have one clear outcome.
- Include dependencies.
- Include source fields/formulas when the ticket creates metrics.
- Include acceptance criteria and tests.
- Avoid tickets like "build entire dashboard".

## Ticket Template

- ID
- Title
- Goal
- Scope
- Files/areas likely affected
- Data/API contract
- Acceptance criteria
- Tests
- Dependencies
- Out of scope

Order tickets so the system remains runnable after each meaningful milestone.
