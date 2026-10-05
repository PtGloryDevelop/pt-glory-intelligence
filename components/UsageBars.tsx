'use client';

import {useEffect, useState} from 'react';
import type {Usage} from '@/lib/usage/shared';
import styles from './UsageBars.module.css';

const usd = (value: number) => value < 0.1 ? value.toFixed(3) : value.toFixed(2);
// Provider cycles are UTC day boundaries; show those days, not the Bangkok clock.
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('th-TH', {day: 'numeric', month: 'short', timeZone: 'UTC'}) : '—';

function Bar({label, used, limit, stop, note}: {label: string; used: number; limit: number; stop?: number; note: string}) {
  const share = limit > 0 ? Math.min(used / limit, 1) : 0;
  const level = share >= 0.9 ? styles.full : share >= 0.7 ? styles.high : '';
  return <div className={styles.item}>
    <div className={styles.head}><b>{label}</b><span>ใช้ไป <strong>{usd(used)}</strong> / {usd(limit)} USD · เหลือ <strong>{usd(Math.max(limit - used, 0))}</strong></span></div>
    <div className={`${styles.track} ${level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Number(used.toFixed(4))}>
      <i style={{width: `${Math.max(share * 100, used > 0 ? 1 : 0)}%`}}/>
      {stop != null && limit > 0 ? <span className={styles.stop} style={{left: `${Math.min(stop / limit, 1) * 100}%`}} title={`ระบบหยุดที่ ${usd(stop)} USD`}/> : null}
    </div>
    <span className={styles.note}>{note}</span>
  </div>;
}

/** Spend bars for paid features. `refresh` changes after a paid action so the bar catches up. */
export function UsageBars({show, refresh = 0}: {show: ('collect' | 'ai')[]; refresh?: number}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/usage').then(response => response.ok ? response.json() : null).then(data => { if (live && data) setUsage(data); }).catch(() => {});
    return () => { live = false; };
  }, [refresh]);
  if (!usage) return null;
  const {collect, ai} = usage;
  return <div className={styles.bars} data-testid="usage-bars">
    {show.includes('collect') ? collect.account
      ? <Bar label="เก็บข้อมูลคู่แข่ง (Apify)" used={collect.account.usedUsd} limit={collect.account.limitUsd}
          note={`ยอดจากบัญชี Apify รอบ ${day(collect.account.cycleStart)}–${day(collect.account.cycleEnd)}`
            + (collect.budgetUsd != null && collect.finalUsd != null ? ` · งบที่ระบบตั้งไว้เดือนนี้ ${usd(collect.budgetUsd)} ใช้จริง ${usd(collect.finalUsd)}` : '')
            + (collect.heldUsd ? ` · กันไว้ ${usd(collect.heldUsd)} สำหรับรอบที่ยังรอยอดจริง` : '')}/>
      : collect.budgetUsd != null && collect.finalUsd != null
        ? <Bar label="เก็บข้อมูลคู่แข่ง" used={collect.finalUsd + (collect.heldUsd ?? 0)} limit={collect.budgetUsd}
            note={`งบที่ระบบตั้งไว้ถึง ${day(collect.windowEnd)} · ใช้จริง ${usd(collect.finalUsd)}${collect.heldUsd ? ` + กันไว้ ${usd(collect.heldUsd)}` : ''} · อ่านยอดจากบัญชี Apify ไม่ได้`}/>
        : null : null}
    {show.includes('ai') && ai
      ? <Bar label="วิเคราะห์ด้วย AI (OpenAI)" used={ai.usedUsd} limit={ai.creditUsd} stop={ai.stopAtUsd}
          note={`นับจากที่ระบบบันทึกไว้ทุกครั้งที่เรียก · ระบบหยุดเรียกที่ ${usd(ai.stopAtUsd)} · วันนี้ ${usd(ai.todayUsd)} / ${usd(ai.dailyCapUsd)} · ${ai.model}`}/>
      : null}
  </div>;
}
