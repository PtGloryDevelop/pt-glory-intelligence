import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for the account steps a session cannot take: creating an unconfirmed login, writing a
 * request row, confirming or deleting a login, making a one-time password link, and the audit row.
 * Server only; never reaches a browser. Every caller checks who is asking before it gets here.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Account service not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
