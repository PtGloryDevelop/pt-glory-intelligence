---
name: ptg-deep-search
description: Use for PT Glory Deep Search implementation or research-answer flows that must query real data first, compute facts deterministically, use AI selectively, and retain evidence.
---

# PT Glory Deep Search

Use when implementing or answering through the product's Deep Search workflow.

## Pipeline

Question
→ resolve Category/Dataset/filter context
→ query database
→ compute deterministic facts
→ retrieve relevant ad copy/evidence
→ AI interpretation only where needed
→ validate evidence/counts
→ structured answer
→ save research history

## Rules

- do not send full raw collector JSON unless necessary
- strip long media/debug fields from model input
- facts and AI interpretation must be distinct
- every strategic conclusion should link to evidence when possible
- state coverage/limitations
- never convert observed ad activity into true market share/performance
