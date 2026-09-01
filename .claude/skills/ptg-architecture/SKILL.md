---
name: ptg-architecture
description: Use to review PT Glory architecture before implementation, especially database boundaries, ingestion, history, AI separation, jobs, and security.
---

# PT Glory Architecture Review

Review a proposed feature/system design before coding.

## Check

- Does it respect master Ad + dataset membership?
- Does it preserve observation history?
- Is Page separate from Brand?
- Are source provenance and quality retained?
- Are long jobs modeled safely?
- Are provider secrets server-side?
- Are business rules enforced server-side?
- Is the solution minimal for current requirements?
- Can failures be retried or recovered?
- Does it avoid coupling the UI directly to raw collector shapes?
- Are AI and deterministic calculations separated?

## Output

- Architecture Summary
- Data Flow
- Components Affected
- Risks
- Rejected Alternatives
- Recommended Design
- Migration/Compatibility Impact
- Approval blockers
