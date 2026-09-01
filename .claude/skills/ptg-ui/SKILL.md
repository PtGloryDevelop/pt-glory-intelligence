---
name: ptg-ui
description: Use for PT Glory frontend/UI work to enforce the approved cream-gold layout, real-data-only metrics, coverage rules, multi-value chart correctness, and AI evidence UX.
---

# PT Glory UI Implementation

Use when building or revising PT Glory frontend screens.

## Visual Direction

- Thai-first
- light warm cream/off-white
- gold accent
- dark text
- left sidebar
- compact context bar
- rounded cards
- dense but readable data layout
- right-side detail drawer

## Data Rule

Before adding any KPI/chart/table column, document:

- source field(s)
- formula if derived
- denominator
- coverage behavior

Do not create placeholder business metrics that look real.

## Multi-value Rule

Platform/categories are multi-value. Do not force them into exclusive 100% pies.

## AI Rule

AI cards need evidence drill-down and a visible distinction between Fact and AI Interpretation.

After implementation, run browser-level QA rather than judging from static screenshots alone.
