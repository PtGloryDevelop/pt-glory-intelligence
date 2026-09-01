---
name: ptg-spec
description: Use after requirement approval to write an implementation-ready PT Glory feature specification with source-field mapping, formulas, security, edge cases, and tests.
---

# PT Glory Feature Specification

Create an implementation-ready feature spec from approved requirements.

Read `CLAUDE.md`, `docs/PRODUCT_SPEC.md` if present, `PT_GLORY_MASTER_SPEC.md`, `docs/DATA_CONTRACT.md`, and relevant code.

## Spec Sections

- Problem / Goal
- Scope
- Non-goals
- User Journey
- Data Inputs
- Source Field Map
- Deterministic Formulas
- AI Responsibilities, if any
- Database Changes
- API Contracts
- Background Jobs
- UI States
- Data Quality Rules
- Security / Authorization
- Error / Partial States
- Observability
- Acceptance Criteria
- Test Plan
- Rollback / Migration Notes

## Critical Rules

- No metric without source/formula.
- Multi-value fields must remain multi-value unless a documented transform is used.
- AI interpretation must have evidence.
- Do not add speculative features.
