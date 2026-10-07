"use client";

import type { RailUnit } from "@/lib/owned-ads/command-center";
import styles from "./unit-rail.module.css";

const n = (value: number) => value.toLocaleString("th-TH");

/** Units as one-click filters (directory layout); chips below 900px. Red = falling ads in that unit. */
export function UnitRail({ units, unassigned, fallingTotal, active, onPick }: {
  units: RailUnit[]; unassigned: number | null; fallingTotal: number | null; active: string; onPick: (unit: string) => void;
}) {
  return <nav className={styles.rail} aria-label="ยูนิต" data-testid="unit-rail">
    <span className={styles.heading}>ยูนิต</span>
    <button type="button" aria-pressed={!active} className={styles.unit} onClick={() => onPick("")} data-testid="unit-rail-all">
      ทุกยูนิต<i>{fallingTotal ? <b className={styles.falling} title="สื่อที่เริ่มตก">{n(fallingTotal)}⚠</b> : null}</i>
    </button>
    {units.map(unit => <button key={unit.id} type="button" aria-pressed={active === unit.id} className={`${styles.unit} ${unit.dim ? styles.dim : ""}`} onClick={() => onPick(unit.id)} data-testid={`unit-rail-${unit.id}`}>
      {unit.name}<i>{unit.note ?? <>{n(unit.ads)}{unit.falling ? <> · <b className={styles.falling} title="สื่อที่เริ่มตก">{n(unit.falling)}⚠</b></> : null}</>}</i>
    </button>)}
    {unassigned ? <span className={styles.unassigned} title="ผูกเพจเข้ายูนิตใน Ads Management">ยังไม่ผูกยูนิต<i>{n(unassigned)}</i></span> : null}
  </nav>;
}
