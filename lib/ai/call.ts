// What every AI provider client shares: the error the routes show, the message shape, and the
// reply-shape description. No server imports: the schema helpers are plain data.

export class AiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

export type Message = {role: 'system' | 'user' | 'assistant'; content: string | ({type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string; detail: 'low'}})[]};

/** One call's parsed reply, the provider's own token counts and what it cost as recorded. */
export type Call = {result: unknown; input: number; output: number; usd: number};

/**
 * The reply's shape for providers that enforce one (OpenAI Structured Outputs, strict). A provider
 * without schemas ignores it; either way the caller's reader checks the reply before it is kept.
 */
export type ReplyFormat = {name: string; schema: JsonSchema};
export type JsonSchema = Record<string, unknown>;

// Strict mode wants every object closed and every key required; these builders always produce that.
export const str = {type: 'string'} as const;
export const bool = {type: 'boolean'} as const;
export const int = {type: 'integer'} as const;
export const intOrNull = {type: ['integer', 'null']} as const;
export const oneOf = (values: readonly string[]) => ({type: 'string', enum: [...values]});
export const arr = (items: JsonSchema) => ({type: 'array', items});
export const obj = (properties: Record<string, JsonSchema>): JsonSchema =>
  ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
