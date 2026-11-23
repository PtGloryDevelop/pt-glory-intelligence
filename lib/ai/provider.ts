import 'server-only';

import * as deepseek from './deepseek.ts';
import * as openai from './openai.ts';
import type {Call, Message, ReplyFormat} from './call.ts';
export {AiError, type Message} from './call.ts';

/**
 * Which provider answers every AI call. OpenAI since 2026-11-23; AI_PROVIDER=deepseek switches back
 * after a redeploy, with DeepSeek's key still set. Cached readings are keyed per model, so each
 * provider keeps its own and neither is shown the other's.
 */
export const PROVIDER: 'openai' | 'deepseek' = process.env.AI_PROVIDER === 'deepseek' ? 'deepseek' : 'openai';
const client = PROVIDER === 'deepseek' ? deepseek : openai;

export const PROVIDER_LABEL = PROVIDER === 'deepseek' ? 'DeepSeek' : 'OpenAI';
export const MODEL = client.MODEL;
export const modelConfig = () => client.modelConfig();
export const estimateUsd = (input: number, output: number) => client.estimateUsd(input, output);
/** Speech to text is OpenAI's (gpt-transcribe); with DeepSeek on, clips are read from their frames only. */
export const CAN_TRANSCRIBE = PROVIDER === 'openai';
export {TRANSCRIBE_MODEL, TRANSCRIBE_USD_PER_MINUTE, transcribeAudio} from './openai.ts';
export const callModel = (messages: Message[], maxTokens: number, format?: ReplyFormat): Promise<Call> =>
  PROVIDER === 'deepseek' ? deepseek.callDeepSeek(messages, maxTokens) : openai.callOpenAI(messages, maxTokens, format);

/**
 * The rows that spend this provider's credit: its own priced models, and for OpenAI only from the day
 * this account's key was added. The OpenAI rows from October (gpt-4.1-mini) were another account.
 */
export const SPEND = PROVIDER === 'deepseek'
  ? {models: deepseek.PRICED_MODELS, since: null, creditUsd: Number(process.env.DEEPSEEK_CREDIT_USD) || 5}
  : {models: openai.PRICED_MODELS, since: '2026-11-22T17:00:00.000Z', creditUsd: Number(process.env.OPENAI_CREDIT_USD) || 5};
