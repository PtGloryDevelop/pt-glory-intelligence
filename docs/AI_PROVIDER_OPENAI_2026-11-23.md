# AI provider: DeepSeek to OpenAI (23 November 2026)

The Compare readings (per ad, set summary, both team views) and the compare-round chat and note draft
now call OpenAI. The owner asked for ChatGPT and has a USD 5 OpenAI credit. Prompts, reply shapes,
readers, caches and caps are unchanged. Counts, totals and percentages are still computed by code.

## What changed

- `lib/ai/provider.ts` picks the provider: `AI_PROVIDER` is `openai` (default) or `deepseek`.
  Switching back means setting `AI_PROVIDER=deepseek` in Vercel and redeploying, with `DEEPSEEK_API_KEY`
  still set.
- `lib/ai/openai.ts` calls Chat Completions with `reasoning_effort` `low` (`OPENAI_REASONING_EFFORT`).
  Every call carries a strict JSON schema (`lib/ai/formats.ts`, Structured Outputs). Without a schema it
  falls back to JSON mode. Models with a price: `gpt-6-luna` (default, `OPENAI_MODEL`) and
  `gpt-6.1-terra`. Any other model is refused.
- Prices per 1M tokens (cached input / input / output) come from developers.openai.com/api/docs/pricing
  on 23 Nov 2026: luna 0.01 / 0.10 / 0.50 and terra 0.05 / 1.00 / 5.00. Thinking is billed as output and
  is included in `completion_tokens`.
- Spend counts only the current provider's priced models. For OpenAI it counts only rows from
  23 Nov 2026 00:00 Bangkok time: the 46 `gpt-4.1-mini` rows from October belong to another account.
  `OPENAI_CREDIT_USD` (default 5) is the bar's limit. `AI_DAILY_USD` (1) and `AI_TOTAL_USD` (4.5) still
  stop the calls.
- Cache keys already contain the model, so each model keeps its own readings. A saved round asked in
  under a new model reads its ads once with that model, within the caps.

## Evaluation (scripts/eval-ai-provider.mjs, scripts/eval-ai-chat.mjs)

The golden sets are six real sets the marketing team compared: the two saved rounds plus two more pairs,
each in the general view, and the two rounds in the ads-team view as well. The readings went through the
app's own route on a local server, against the pilot data. The checks:
- quotes marked `ข้อความ` must appear in the ad copy;
- no idea, fix or headline may suggest an FDA-forbidden claim;
- no summary may claim a rival result;
- replies must stay in Thai.

| | DeepSeek (cached baseline) | gpt-6-luna | gpt-6.1-terra |
|---|---|---|---|
| Sets answered | 5 of 6 (no local key for the uncached one) | 6 of 6 | 6 of 6 |
| Flags | 9: two forbidden headlines ("อยากคุมแคลทั้งวัน…", "อยากดูแลไขมันในเลือด…"), "ไม่เห็นผลคืนเงิน" idea, Chinese in a summary, 5 quotes not in the copy | 2: quotes not in the copy | 0 |
| Cost per call (ad / set) | USD 0.00085 / 0.00107 | USD 0.00055 / 0.00060 | USD 0.0052 / 0.0043 |
| Time per set | (cached) | 13–19 s | 12–25 s |

Chat (two rounds × rival spend, FDA claim, "แก้อะไรก่อน", off-topic, plus a note draft): luna 10/10
and terra 10/10. Every answer was read by a person: both models refuse to give rival spend or sales,
refuse the FDA claim and offer a safe caption, cite our ad first, and decline the off-topic question.
A question cost USD 0.0003 on luna and USD 0.003 on terra.

**Decision:** `gpt-6-luna`. It costs less than DeepSeek did, has none of DeepSeek's FDA slips and passes
every chat check. Terra was marginally cleaner on quotes at about nine times the price. It is one
`OPENAI_MODEL=gpt-6.1-terra` and a redeploy away.

The evaluation itself cost about USD 0.10 recorded on the OpenAI account (luna 0.010, terra 0.088), plus
about USD 0.04 of direct chat calls that were not recorded in the app.
