# AI Analysis Specification

## Responsibilities

AI may classify or interpret:

- pain point
- hook
- offer
- angle
- messaging
- positioning
- creative pattern
- opportunity
- recommendation

AI should not be asked to count large datasets when deterministic code can do it reliably.

## Preprocessing

Before model call:

- remove long media URLs unless required
- remove raw/debug/network evidence not needed for analysis
- remove duplicate technical fields
- keep identifiers needed for evidence
- precompute deterministic metrics
- select only relevant ads/copy for the question

## Output Contract

Prefer structured output containing:

- type
- label
- rationale
- evidence ad ids
- optional confidence

Then calculate count/percentage in application code from evidence/classifications.

## Evaluation

Every meaningful prompt/model change should be tested against a stable evaluation set.

Record:

- prompt version
- model
- expected classifications
- measured accuracy/quality
- token usage
- estimated cost
- evidence correctness

Do not deploy a prompt change solely because one manually inspected answer looks better.
