import { withTransaction } from "../db/privileged.ts";
import { createApifyProvider } from "./apify.ts";
import { createFakeProvider, fakeProviderEnabled } from "./fake-provider.ts";
import type { CollectionProvider } from "./provider.ts";

/**
 * The provider client, built from server settings.
 *
 * One place, because three request paths need the same two settings and none of
 * them should be reading configuration for itself. Returns null when the
 * collector is not configured: that is an operational fact for the server log,
 * never an error for the person who asked.
 */
export async function providerFromSettings(): Promise<CollectionProvider | null> {
  // The browser suite drives whole collections against a real server, and doing
  // that against the real provider would spend money on every run. Both guards
  // live in the fake itself: dev or test only, and an explicit flag.
  if (fakeProviderEnabled()) return createFakeProvider();

  const { rows } = await withTransaction((client) => client.query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key in ('collector.actor', 'collector.actor_build')",
  ));
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const actor = settings.get("collector.actor");
  const build = settings.get("collector.actor_build");
  if (typeof actor !== "string" || actor.trim() === "") return null;
  return createApifyProvider({ actor, build: typeof build === "string" ? build : "" });
}
