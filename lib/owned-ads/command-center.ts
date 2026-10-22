import type { CompanyAd } from "./source-rows.ts";

/** Falling rule (7 Oct): previous 7 days ROAS ≥ 2.5, latest 7 days < 2.5, spend ≥ 1,000 THB in both. Mirrors migration 0062. */
export const FALL_ROAS = 2.5;
export const FALL_MIN_SPEND = 1000;
/** ROAS and "ใช้มานาน" rankings count only ads that spent at least this much in the period. */
export const RANK_MIN_SPEND = 1000;

export type CommandAd = CompanyAd & {
  unit_ids: string[]; unit_names: string[]; roas: number | null; cost_per_conversation: number | null;
  video_id: string | null; created_time: string | null;
  previous_roas?: number; recent_roas?: number; recent_spend?: number; previous_spend?: number;
};
export type CommandWindow = { from: string; to: string };
export type CommandCenterData = {
  windows: { recent: CommandWindow; previous: CommandWindow };
  falling_counts: { unit_id: string | null; count: number }[]; falling_total: number;
  falling: CommandAd[]; sales: CommandAd[]; cheap_chats: CommandAd[]; top_roas: CommandAd[]; oldest: CommandAd[];
};

type Week = { spend: number | null; value: number | null };
export function isFalling(previous: Week, recent: Week): boolean {
  if (previous.spend == null || recent.spend == null || previous.value == null || recent.value == null) return false;
  if (previous.spend < FALL_MIN_SPEND || recent.spend < FALL_MIN_SPEND) return false;
  return previous.value / previous.spend >= FALL_ROAS && recent.value / recent.spend < FALL_ROAS;
}

/** `note` replaces the counts (e.g. "6 เพจ · 42 ใหม่" or "+ คำค้น"); `dim` marks a unit with nothing set up yet. */
export type RailUnit = { id: string; name: string; ads: number; falling: number; note?: string; dim?: boolean };
/** Units with the most ads first, then Thai name order; unassigned (null id) is shown separately by the caller. */
export function railOrder(units: { id: string | null; name: string; ads: number | null }[], falling: { unit_id: string | null; count: number }[]): RailUnit[] {
  const fallingBy = new Map(falling.map(row => [row.unit_id, row.count]));
  return units.filter((unit): unit is { id: string; name: string; ads: number | null } => unit.id != null)
    .map(unit => ({ id: unit.id, name: unit.name, ads: unit.ads ?? 0, falling: fallingBy.get(unit.id) ?? 0 }))
    .sort((a, b) => b.ads - a.ads || a.name.localeCompare(b.name, "th") || a.id.localeCompare(b.id));
}
