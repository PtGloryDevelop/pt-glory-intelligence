---
name: ptg-ui
description: Use for PT Glory frontend/UI work to enforce the approved warm off-white + CI pink layout, real-data-only metrics, coverage rules, multi-value chart correctness, and AI evidence UX.
---

# PT Glory UI Implementation

Use when building or revising PT Glory frontend screens.

## Visual Direction

- Thai-first
- warm off-white canvas with white cards (tokens in `app/globals.css`)
- PT Glory CI pink accent: `#D34B82` for logo/highlights/charts, `#C0396F` for text, links and primary buttons
- color carries meaning, not decoration: on the overview, pink marks our own ads and results
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
