import Link from 'next/link';
import { forbidden } from 'next/navigation';
import { requireActorOrRedirect, satisfies } from '@/lib/auth/roles';
import { listRounds, type RoundRow } from '@/lib/ai/rounds';
import { thaiDateTime } from '@/lib/format/date';
import { PageHeader } from '@/components/shell/PageHeader';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import styles from './rounds.module.css';

export const dynamic = 'force-dynamic';

/** Where a round is reopened: its pair on the compare page, its team view, and the round itself. */
function openHref(round: RoundRow): string {
  const own = round.ads.find(ad => ad.ref.kind === 'own')?.ref;
  const rival = round.ads.find(ad => ad.ref.kind === 'rival')?.ref;
  const params = new URLSearchParams();
  if (own?.kind === 'own') { params.set('account', own.account); params.set('owned', own.ad); }
  if (rival?.kind === 'rival') { params.set('dataset', rival.dataset); params.set('rival', rival.ad); }
  // Rounds live in the ทีมการตลาด tab.
  params.set('view', 'marketing');
  params.set('round', round.id);
  return `/compare/ads?${params}`;
}

/**
 * ประวัติการเทียบแอด: every compare round of the team (team feedback, 31 Oct), newest first, with its note.
 * A round is reopened on the compare page, where its talk continues and nothing read before is paid again.
 */
export default async function RoundsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, 'analyst')) forbidden();
  const params = await searchParams;
  const one = (name: string) => typeof params[name] === 'string' ? params[name] as string : '';
  const unit = one('unit'), noted = one('noted') === '1', mine = one('mine') === '1';

  let rounds: RoundRow[] = [];
  let failed = false;
  try { rounds = await listRounds({ mine }); } catch { failed = true; }
  const units = [...new Set(rounds.map(round => round.unitName).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  const shown = rounds.filter(round => (!unit || round.unitName === unit) && (!noted || round.notedAt));

  return <div className={styles.page}>
    <PageHeader title="ประวัติการเทียบแอด" description="ทุกรอบที่ทีมคุยกับ AI เรื่องแอดที่เทียบ พร้อมสรุปที่บันทึกไว้ · เปิดรอบเก่าแล้วถามต่อได้"
      actions={<Link className={styles.back} href="/compare/ads">เทียบแอดใหม่</Link>} />
    <form className={styles.filters} method="get" action="/compare/rounds">
      <label><span>ยูนิต</span><select name="unit" defaultValue={unit}><option value="">ทั้งหมด</option>{units.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" name="mine" value="1" defaultChecked={mine} />เฉพาะรอบของฉัน</label>
      <label className={styles.check}><input type="checkbox" name="noted" value="1" defaultChecked={noted} />เฉพาะรอบที่มีสรุป</label>
      <button type="submit">กรอง</button>
    </form>
    {failed ? <ErrorState title="เปิดประวัติการเทียบไม่สำเร็จ" detail="ลองโหลดหน้านี้ใหม่อีกครั้ง" testId="rounds-error" />
      : !shown.length ? <EmptyState title={rounds.length ? 'ไม่มีรอบที่ตรงกับตัวกรอง' : 'ยังไม่มีรอบการเทียบ'}
        body={rounds.length ? undefined : 'เลือกแอดเรากับแอดคู่แข่งในหน้าเทียบแอด แล้วพิมพ์ถาม AI รอบนั้นจะขึ้นที่นี่'} testId="rounds-empty" />
      : <div className={styles.tableBox}><table className={styles.table} data-testid="rounds-table">
        <thead><tr><th>รอบ</th><th>แอดที่เทียบ</th><th>สรุป</th><th className={styles.r}>คำถาม</th><th>โดย · เมื่อ</th><th><span className={styles.srOnly}>เปิด</span></th></tr></thead>
        <tbody>{shown.map(round => {
          const own = round.ads.filter(ad => ad.ref.kind === 'own').map(ad => ad.label);
          const rivals = round.ads.filter(ad => ad.ref.kind === 'rival').map(ad => ad.label);
          const planned = round.noteNext.length, tried = round.noteNext.filter(item => item.done).length;
          return <tr key={round.id}>
            <td><b>#{round.number}</b>{round.unitName ? <span className={styles.unit}>{round.unitName}</span> : null}</td>
            <td>{own.join(', ')}<span className={styles.muted}>vs {rivals.join(', ')}</span></td>
            <td>{round.notedAt ? <><b>{round.title}</b>{planned ? <span className={styles.muted}>จะลอง {planned} ข้อ{tried ? ` · ลองแล้ว ${tried}` : ''}</span> : null}</> : <span className={styles.muted}>ยังไม่บันทึกสรุป</span>}</td>
            <td className={styles.r}>{round.questions.toLocaleString('th-TH')}</td>
            <td>{round.createdByName ?? '—'}<span className={styles.muted}>{thaiDateTime(round.createdAt)}</span></td>
            <td className={styles.r}><Link href={openHref(round)} data-testid={`round-open-${round.number}`}>เปิด</Link></td>
          </tr>;
        })}</tbody>
      </table></div>}
  </div>;
}
