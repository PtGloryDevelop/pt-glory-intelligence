---
name: ptg-grill
description: Use before implementing PT Glory features to challenge requirements, verify real data fields, define acceptance criteria, and expose unsupported metrics.
---

# PT Glory Requirement Grill

Use this before implementation, especially for ambiguous or large work.

## Procedure

1. Read relevant project files and source data first.
2. Restate the user/business goal in one paragraph.
3. Identify the user journey.
4. List exact inputs and outputs.
5. Map every requested KPI/field to a real source field or deterministic formula.
6. Flag unsupported metrics immediately.
7. Identify database/API/background-job/AI/UI impact.
8. Identify edge cases and partial-data behavior.
9. Define acceptance criteria.
10. Define the minimum test plan.
11. State assumptions and unresolved questions.
12. Recommend whether this is a small task or large feature.

## Required Output

Produce:

- Goal
- User Journey
- Real Data Sources
- Derived Rules
- Unsupported Requests
- Architecture Impact
- Edge Cases
- Acceptance Criteria
- Test Plan
- Assumptions / Questions
- Recommended Next Step

Do not write implementation code unless the user explicitly asks to proceed after the grill.
