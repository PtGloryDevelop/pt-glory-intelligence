import "server-only";
import { dbUser } from "../db/user.ts";
import { cachedOwnedImage } from "./media-cache.ts";
import { ownedPerformancePeriod, parseOwnedPerformanceQuery, type OwnedPerformancePeriod } from "./performance.ts";
import type { CommandAd, CommandCenterData } from "./command-center.ts";

const LISTS = ["falling", "sales", "cheap_chats", "top_roas", "oldest"] as const;
export type CommandCenterResult = CommandCenterData & { period: OwnedPerformancePeriod };

/** JWT/RLS read on the latest completed daily snapshot; same validation as the ads list. Null when daily data is not ready. */
export async function getCommandCenter(input: URLSearchParams): Promise<CommandCenterResult | null> {
  const params = new URLSearchParams();
  for (const key of ["period", "from", "to", "unit", "pageId"]) for (const value of input.getAll(key)) params.append(key, value);
  const query = parseOwnedPerformanceQuery(params);
  const db = await dbUser();
  const latest = await db.from("owned_library_syncs").select("id,daily_ready,daily_from,daily_to").eq("status", "completed").order("finished_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error("Owned daily snapshot unavailable");
  if (!latest.data?.daily_ready) return null;
  const coverage = latest.data.daily_from && latest.data.daily_to ? { from: latest.data.daily_from, to: latest.data.daily_to } : null;
  const period = ownedPerformancePeriod(query, coverage);
  const result = await db.rpc("owned_command_center", { p_sync: latest.data.id, p_from: period.from, p_to: period.to, p_unit: query.unit, p_page_id: query.pageId });
  if (result.error) throw new Error("Command center unavailable");
  const data = result.data as CommandCenterData;
  for (const list of LISTS) data[list] = data[list].map((ad: CommandAd) => ({ ...ad, creative_url: cachedOwnedImage(ad) ?? null }));
  return { ...data, period };
}
