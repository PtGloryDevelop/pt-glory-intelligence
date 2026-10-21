import type { NavTone } from "./nav.ts";
import { Icon, type IconName } from "./icons.tsx";
import styles from "./Tile.module.css";

/** A menu entry's icon on the colour of its side: pink ours, blue rivals, purple both, grey the rest. */
export function Tile({ icon, tone, size = 26 }: { icon: IconName; tone: NavTone; size?: 26 | 30 }) {
  return (
    <span className={styles.tile} data-tone={tone} data-size={size}>
      <Icon name={icon} size={size === 30 ? 17 : 15} />
    </span>
  );
}
