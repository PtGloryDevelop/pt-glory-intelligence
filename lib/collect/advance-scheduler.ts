/** The one work item an advance tick may hand to the state machine. */
export type AdvanceWorkItem = { id: string; kind: "advance" | "cost" };

/** SQL orders due rows; this helper keeps the request boundary at one item. */
export function selectOneDueWork(
  items: readonly AdvanceWorkItem[],
): AdvanceWorkItem | null {
  return items[0] ?? null;
}

/** Execute exactly one selected action path, or nothing when no work is due. */
export async function processOneWork<A, C>(
  item: AdvanceWorkItem | null,
  handlers: {
    advance: (id: string) => Promise<A>;
    reconcileCost: (id: string) => Promise<C>;
  },
): Promise<A | C | null> {
  if (item === null) return null;
  return item.kind === "cost"
    ? handlers.reconcileCost(item.id)
    : handlers.advance(item.id);
}
