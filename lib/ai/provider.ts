import 'server-only';

import * as anthropic from './anthropic.ts';
import * as deepseek from './deepseek.ts';
import * as openai from './openai.ts';
import type {Call, Message, ReplyFormat} from './call.ts';
export {AiError, type Message} from './call.ts';

/**
 * Which provider answers every AI call. OpenAI since 2026-11-23 and still the default;
 * AI_PROVIDER=anthropic hands the reading and the talk to Claude, AI_PROVIDER=deepseek to DeepSeek,
 * each after a redeploy with its key set. Cached readings are keyed per model, so each provider
 * keeps its own and none is shown another's.
 */
export const PROVIDER: 'openai' | 'deepseek' | 'anthropic' =
  process.env.AI_PROVIDER === 'deepseek' ? 'deepseek' : process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
const client = {openai, deepseek, anthropic}[PROVIDER];

export const PROVIDER_LABEL = {openai: 'OpenAI', deepseek: 'DeepSeek', anthropic: 'Claude'}[PROVIDER];
export const MODEL = client.MODEL;
export const modelConfig = () => client.modelConfig();
export const estimateUsd = (input: number, output: number) => client.estimateUsd(input, output);
/**
 * Speech to text is OpenAI's (gpt-transcribe): Claude takes pictures and text, not sound. With Claude
 * on, clips are still heard while the OpenAI key is set; with DeepSeek on, or no OpenAI key, they are
 * read from their frames only and shown as not heard.
 */
export const CAN_TRANSCRIBE = PROVIDER === 'openai' || (PROVIDER === 'anthropic' && openai.keySet());
export {TRANSCRIBE_MODEL, TRANSCRIBE_USD_PER_MINUTE, transcribeAudio} from './openai.ts';
export const callModel = (messages: Message[], maxTokens: number, format?: ReplyFormat): Promise<Call> =>
  PROVIDER === 'deepseek' ? deepseek.callDeepSeek(messages, maxTokens)
    : PROVIDER === 'anthropic' ? anthropic.callClaude(messages, maxTokens, format)
      : openai.callOpenAI(messages, maxTokens, format);

/** The OpenAI rows: only from the day this account's key was added. October's (gpt-4.1-mini) were another account. */
const OPENAI_SPEND = {models: openai.PRICED_MODELS, since: '2026-11-22T17:00:00.000Z', creditUsd: Number(process.env.OPENAI_CREDIT_USD) || 5};
/** The rows that spend this provider's credit: its own priced models. */
export const SPEND: {models: string[]; since: string | null; creditUsd: number} = PROVIDER === 'deepseek'
  ? {models: deepseek.PRICED_MODELS, since: null, creditUsd: Number(process.env.DEEPSEEK_CREDIT_USD) || 5}
  : PROVIDER === 'anthropic'
    ? {models: anthropic.PRICED_MODELS, since: null, creditUsd: Number(process.env.ANTHROPIC_CREDIT_USD) || 200}
    : OPENAI_SPEND;
/**
 * With Claude reading, hearing a clip still spends the OpenAI credit: another account's money, so it
 * is counted and shown apart from Claude's and never against Claude's caps.
 */
export const TRANSCRIBE_SPEND = PROVIDER === 'anthropic' && CAN_TRANSCRIBE ? OPENAI_SPEND : null;
