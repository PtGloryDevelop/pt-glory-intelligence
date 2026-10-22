import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';

/**
 * The Ads Management source credentials. On a server (the VPS container) they come from the
 * environment: ADS_SUPABASE_URL, ADS_SUPABASE_SERVICE_ROLE_KEY, ADS_TOKEN_ENCRYPTION_KEY and
 * optionally ADS_META_GRAPH_API_VERSION. Without them, the Ads Management checkout's .env.local is
 * read, as on the machine that first ran the sync. Values are never logged.
 */
export async function sourceEnv(sourcePath) {
  if (process.env.ADS_SUPABASE_URL && process.env.ADS_SUPABASE_SERVICE_ROLE_KEY) return {
    SUPABASE_URL: process.env.ADS_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.ADS_SUPABASE_SERVICE_ROLE_KEY,
    TOKEN_ENCRYPTION_KEY: process.env.ADS_TOKEN_ENCRYPTION_KEY,
    META_GRAPH_API_VERSION: process.env.ADS_META_GRAPH_API_VERSION,
  };
  return parseEnv(await readFile(resolve(sourcePath ?? '', '.env.local'), 'utf8'));
}

/** Which of the two the run used, for the logs (never the values). */
export const sourceEnvOrigin = () => process.env.ADS_SUPABASE_URL && process.env.ADS_SUPABASE_SERVICE_ROLE_KEY ? 'environment' : 'file';
