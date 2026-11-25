/** Names are display metadata. Page IDs remain the sole filtering identity. */
export function ownedPageName(id: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name !== id ? name : null;
}

/**
 * One page of the filter list (owned_page_choices, migration 0081): pages with spend in the period under the chosen
 * unit, plus the chosen page itself with `in_period: false` when it has none, and `elsewhere`, the units it did
 * spend under in the period (null id: not yet tied to a unit). Lists read before 0081 carry neither field.
 */
export type OwnedPageOption = {
  id: string; name: string; in_period?: boolean;
  elsewhere?: { id: string | null; name: string | null }[] | null;
};

export function ownedPageChoices(pages: readonly OwnedPageOption[]) {
  const names = pages.map(page => ({
    id: page.id, name: ownedPageName(page.id, page.name),
    in_period: page.in_period !== false, elsewhere: page.elsewhere ?? [],
  }));
  const duplicates = new Map<string, number>();
  for (const page of names) if (page.name) duplicates.set(page.name, (duplicates.get(page.name) ?? 0) + 1);
  return names.sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name))
    || (a.name ?? a.id).localeCompare(b.name ?? b.id, "th") || a.id.localeCompare(b.id))
    .map(page => ({ ...page, label: `${page.name
      ? `${page.name}${duplicates.get(page.name)! > 1 ? ` · ${page.id}` : ""}`
      : `ยังไม่มีชื่อเพจ · ${page.id}`}${page.in_period ? "" : " · ไม่มีค่าแอดช่วงนี้"}` }));
}
