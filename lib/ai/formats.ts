// The reply shapes the prompts ask for, as strict schemas (OpenAI Structured Outputs). The prompts
// still show the shape for providers without schemas, and the readers in compare-shared.ts and
// rounds-shared.ts still check every reply: a schema narrows what comes back, it is not the check.
import {ADS_DIMS, AI_DIMS, AI_SOURCES, SCORE_DIMS} from './compare-shared.ts';
import {arr, bool, int, intOrNull, obj, oneOf, str, type ReplyFormat} from './call.ts';

const cell = obj({value: str, source: oneOf(AI_SOURCES), quote: str});

/** One ad, general view (readAdReading). */
export const AD_FORMAT: ReplyFormat = {name: 'ad_reading', schema: obj({
  ...Object.fromEntries(AI_DIMS.map(dim => [dim, cell])),
  claims: obj({items: arr(obj({text: str, risky: bool})), quote: str}),
  scores: obj(Object.fromEntries(SCORE_DIMS.map(dim => [dim, obj({score: intOrNull, why: str})]))),
  fix: str,
})};

/** One ad, the ads team's view (readAdsReading). */
export const ADS_FORMAT: ReplyFormat = {name: 'ads_team_reading', schema: obj(Object.fromEntries(ADS_DIMS.map(dim => [dim, cell])))};

/** The set summary, both views (readSetReading). */
export const SET_FORMAT: ReplyFormat = {name: 'set_summary', schema: obj({
  diffs: arr(obj({text: str, ads: arr(int)})), ideas: arr(obj({text: str, ads: arr(int)})), hooks: arr(obj({text: str, why: str})),
})};

/** A compare-round answer (readAnswer) and the note draft (readNoteDraft). */
export const ANSWER_FORMAT: ReplyFormat = {name: 'round_answer', schema: obj({answer: str, ads: arr(int)})};
export const NOTE_FORMAT: ReplyFormat = {name: 'round_note', schema: obj({title: str, seen: str, next: arr(str)})};
