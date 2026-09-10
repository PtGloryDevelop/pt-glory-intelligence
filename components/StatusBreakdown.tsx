import { StatusBadge } from "./StatusBadge.tsx";
import styles from "./Badge.module.css";

/**
 * A row's status split, without the zeros that carry nothing.
 *
 * The Page list used to print all three states on every row. In a scope
 * collected with `active_status = active` that meant sixty badges per screen
 * reading `Inactive 0` and `ไม่ทราบ 0` — noise that tripled the row height and,
 * worse, repeated a zero that says nothing about the advertiser because a
 * stopped ad was never eligible to appear.
 *
 * So a state is shown when it has ads in it. Anything hidden is a zero, and the
 * total beside it makes that checkable: the states shown always add up to it.
 * The full three-way split stays on the Page and Category screens, where the
 * sentence explaining what the collection asked for sits next to it.
 */
export function StatusBreakdown({ active, inactive, unknown, testId }: {
  active: number;
  inactive: number;
  unknown: number;
  testId?: string;
}) {
  const states = [
    { key: "active", isActive: true as const, count: active },
    { key: "inactive", isActive: false as const, count: inactive },
    { key: "unknown", isActive: null, count: unknown },
  ].filter((state) => state.count > 0);

  // Every state empty is itself worth saying, rather than an empty cell that
  // looks like a rendering fault.
  if (states.length === 0) {
    return <span className={styles.none} data-testid={testId}>ไม่มีโฆษณา</span>;
  }

  return (
    <span className={styles.group} data-testid={testId}>
      {states.map((state) => (
        <StatusBadge key={state.key} isActive={state.isActive} count={state.count} />
      ))}
    </span>
  );
}
