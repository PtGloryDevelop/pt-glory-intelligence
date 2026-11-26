# AI provider: Claude as a third choice (26 November 2026)

The owner has USD 200 of Claude API credit and asked for Claude to read the ads, write the set
summary and answer the compare-round talk in place of `gpt-6-luna`. Prompts, reply shapes, readers,
caches and the rule that code computes every count are unchanged. Hearing a clip stays with OpenAI.

OpenAI is still the default. Nothing changes on a deployment until `AI_PROVIDER=anthropic` is set.

## What changed

- `lib/ai/provider.ts`: `AI_PROVIDER` is `openai` (default), `deepseek` or `anthropic`.
- `lib/ai/anthropic.ts` calls the Messages API through the official SDK (`@anthropic-ai/sdk`).
  - Every call carries the same JSON schema as on OpenAI (`output_config.format`, structured outputs).
  - Pictures go as base64 image blocks. Thinking is left to the model, at effort `low`
    (`ANTHROPIC_EFFORT` raises it). Thinking is billed as output and is inside `output_tokens`.
  - `ANTHROPIC_MODEL` is `claude-opus-5-5` (default), `claude-sonnet-5-5` or `claude-haiku-5-5`.
    Any other model is refused, so no call is priced by guess.
- Prices per 1M tokens (cache read / 5-minute cache write / input / output), from
  platform.claude.com/docs/en/about-claude/pricing on 26 Nov 2026:
  Opus 5.5 0.20 / 5 / 4 / 20, Sonnet 5.5 0.10 / 2.50 / 2 / 10, Haiku 5.5 0.01 / 0.125 / 0.10 / 0.50
  (Haiku costs five times that on a prompt over 100,000 tokens; ours are a few thousand).
- **Refusal fallback is opted in.** When a model's safety classifier declines a request, the API runs
  it once more on a named model inside the same call: Opus 5.5 → Opus 4.8, Sonnet 5.5 → Sonnet 5.
  Haiku 5.5 has no server-side fallback. The cost recorded is every attempt the response reports
  (`usage.iterations`), each at the rates of the model that ran it. The row keeps the configured
  model's name, and the server log says when a fallback answered.
- **Two credits.** Claude takes pictures and text, not sound, so a clip is still heard by
  `gpt-transcribe` while `OPENAI_API_KEY` is set. That spends the OpenAI credit. It is summed apart
  (`TRANSCRIBE_SPEND`), never counted against Claude's caps, and the usage bar shows it as its own
  figure. Without an OpenAI key, clips are read from their frames and shown as not heard.
- Spend counts the three Claude models' rows. `ANTHROPIC_CREDIT_USD` (default 200) is the bar's limit.
  The total cap now defaults to nine tenths of the provider's credit (4.5 of OpenAI's 5 as before,
  180 of Claude's 200); `AI_TOTAL_USD` still overrides it. `AI_DAILY_USD` still defaults to 1.
- The estimate shown before a run is multiplied by 2.6 for Claude (see the token counts below).

## Evaluation

Run on 26 Nov 2026 through the app's own route on a local server, against the pilot data, at effort
`low`: `scripts/eval-ai-provider.mjs` (six sets the team compared, and `--suite clips`, seven sets
with rival clips read by the video reader) and `scripts/eval-ai-chat.mjs` (four golden questions and
the note draft on two sets). The luna column is the 23 Nov baseline, judged again with today's checker.

The checker gained one rule here: a headline written for our ad may only use numbers that are in our
ad's copy.

| | gpt-6-luna | Claude Haiku 5.5 | Claude Sonnet 5.5 | Claude Opus 5.5 |
|---|---|---|---|---|
| Sets answered | 13 of 13 | 13 of 13 | 13 of 13 | 13 of 13 |
| Refusals / fallbacks | 0 | 0 / none exists | 0 / 0 | 0 / 0 |
| Flags | 3 | 6 | 4 | 3 |
| Quotes marked `เสียง`, all in the transcript | 5 of 6 | 5 of 5 | 6 of 6 | 7 of 7 |
| Headlines with a number not in our ad | 0 of 39 | 1 of 39 | 0 of 39 | 0 of 39 |
| Chat and note | 10 of 10 | 9 of 10 (see below) | 10 of 10 | 10 of 10 |
| Seconds per set | 20 | 18 | 20 | 27 |
| Tokens per ad reading (in / out) | 3,152 / 736 | 8,069 / 1,417 | 8,069 / 1,264 | 8,069 / 1,290 |
| Tokens per set summary (in / out) | 2,246 / 782 | 5,146 / 1,646 | 5,176 / 1,211 | 5,228 / 1,272 |
| USD per ad reading | 0.0007 | 0.0015 | 0.029 | 0.058 |
| USD per set summary | 0.0006 | 0.0013 | 0.022 | 0.046 |
| USD per chat answer | 0.0003 | 0.0008 | 0.016 | 0.035 |
| USD for a new two-ad comparison | about 0.002 | about 0.005 | 0.08 to 0.09 | 0.16 to 0.19 |
| USD this evaluation cost | 0.066 | 0.060 | 1.115 | 2.289 |

What the flags were:

- **In every Claude column and two of luna's three:** "speech was heard but no evidence comes from
  it" on the same clips (the 6:06 clip, Uji, and for Claude also Kivari). The models did use the
  speech: claims and offers that are only spoken are in their lists ("3 แถม 3 990 บาท", "ทานต่อเนื่อง 1
  เดือน กล้าท้าให้ไปตรวจ"). Where the caption says the same thing, they quoted the caption, as the
  source rule asks. The flag marks a clip to look at, not an error.
- **luna:** one claims quote marked `เสียง` that is a rewording of what the clip says.
- **Haiku:** a quote that joins two fragments of the copy with "..."; a headline with a forbidden
  claim ("ไขมันในเลือดสูง ลองหาวิธีดูแลตัวเอง…"); and a headline with an invented figure and a health
  claim ("ค่า LDL 192 ลดเหลือ 95…"). Read by hand, one more: it called our plant-oil softgel
  "ซอฟต์เจลน้ำมันปลา", which the copy never says.
- **Sonnet:** one headline quote that silently corrected a typo in our copy ("การันตรีเห็นผล" became
  "การันตีเห็นผล"), so it is not letter for letter.
- **Opus:** only the three speech flags above.
- **Haiku's chat miss** is the checker's: the answer declines the claim and offers safe copy, then
  lists the claims to cut, and the check read the named claims as a suggestion.

Read side by side on our U24 ad, all four models marked the same risky claims (หายขาด, ปลอดภัย 100%,
LDL 350 > 90 จนหมอหยุดจ่ายยา, ล้างหลอดเลือดเกลี้ยง). Over the seven distinct ads of ours they marked 49
(luna), 50 (Haiku), 44 (Sonnet) and 48 (Opus) claims as risky. The difference is in what they suggest:
luna's advice is general ("นำคำอ้าง…ออก แล้วจัดข้อมูลสินค้าและโปรให้อ่านชัด"), while Sonnet and Opus build
on facts in the ad that luna never used (the regular price 1,180 as an anchor, "Omega 3-6-9 จากพืช
ไม่เหม็นคาว") and on our own ROAS.

Why Claude counts more tokens: a picture costs ⌈width / 28⌉ × ⌈height / 28⌉ tokens (a 480 × 854 clip
frame is 558, eight of them 4,464), where OpenAI's low-detail rate is flat, and the thinking is part
of the output. The callers' estimates (3,200 / 700 per ad) were measured on OpenAI, hence the 2.6.

## Not covered

- Effort above `low` was not tried.
- The fallback path has only been exercised with a mocked response: no request was declined.
- Thirteen sets cannot separate Sonnet from Opus on quality: one small flag against none.
- How good the Thai suggestions read is the marketing team's call, not the checker's.

## Switching

1. In Vercel (production): `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic`, optionally `ANTHROPIC_MODEL`
   and `AI_DAILY_USD`. Keep `OPENAI_API_KEY`: it still hears the clips.
2. Deploy. Cache keys contain the model, so each model reads an ad once and keeps its own readings.
3. Back to OpenAI: remove `AI_PROVIDER` (or set it to `openai`) and redeploy. luna's readings are still there.
