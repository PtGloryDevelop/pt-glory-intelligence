/** Names are display metadata. Page IDs remain the sole filtering identity. */
export function ownedPageName(id: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name !== id ? name : null;
}

export function ownedPageChoices(pages: readonly { id: string; name: string }[]) {
  const names = pages.map(page => ({ id: page.id, name: ownedPageName(page.id, page.name) }));
  const duplicates = new Map<string, number>();
  for (const page of names) if (page.name) duplicates.set(page.name, (duplicates.get(page.name) ?? 0) + 1);
  return names.sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name))
    || (a.name ?? a.id).localeCompare(b.name ?? b.id, "th") || a.id.localeCompare(b.id))
    .map(page => ({ ...page, label: page.name
      ? `${page.name}${duplicates.get(page.name)! > 1 ? ` · ${page.id}` : ""}`
      : `ยังไม่มีชื่อเพจ · ${page.id}` }));
}
