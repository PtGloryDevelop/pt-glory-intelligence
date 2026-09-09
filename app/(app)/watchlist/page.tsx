import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { listWatchItems } from "@/lib/read/watchlist";
import {
  SIGNAL_META, WATCHLIST_BASIS, isSnapshotScope,
} from "@/lib/watchlist/contract";
import { scopeLabel } from "@/lib/pages/scope";
import { thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import styles from "./watchlist.module.css";

export const dynamic = "force-dynamic";

/**
 * The saved research targets.
 *
 * Compact on purpose: identity, scope, baseline, what is tracked, and when the
 * scope was last collected. No signal is computed here — a list that ran seven
 * intelligence queries per row would be slow and would still not be the page
 * where anyone reads them.
 */
export default async function WatchlistPage() {
  await requireActorOrRedirect();
  const items = await listWatchItems();

  return (
    <>
      <PageHeader
        eyebrow="Watchlist"
        title="รายการติดตาม"
        description="เป้าหมายที่บันทึกไว้ตรวจดูเอง · ไม่ใช่การเฝ้าดูอัตโนมัติ และไม่มีการแจ้งเตือน"
      />

      {/* The sentence that keeps the feature honest, on the first screen. */}
      <p className={styles.basis} data-testid="watchlist-basis">{WATCHLIST_BASIS}</p>

      {items.length === 0 ? (
        <EmptyState
          testId="watchlist-empty"
          title="ยังไม่มีรายการติดตาม"
          body="เพิ่มได้จากหน้าเพจ หรือหน้าหมวดหมู่ — ระบบจะจำเป้าหมายและขอบเขตข้อมูลที่คุณเลือกไว้"
          action={<Link href="/pages">ไปที่เพจ / แบรนด์</Link>}
        />
      ) : (
        <Panel>
          <PanelHead title="เป้าหมายที่บันทึกไว้" meta={`${items.length} รายการ`} />
          <TableWrap>
            <table data-testid="watchlist-table">
              <thead>
                <tr>
                  <th>เป้าหมาย</th>
                  <th>ชนิด</th>
                  <th>ขอบเขตข้อมูล</th>
                  <th>จุดอ้างอิง</th>
                  <th>สัญญาณที่ติดตาม</th>
                  <th>เก็บข้อมูลล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} data-testid={`watch-row-${item.id}`}>
                    <td>
                      <Link href={`/watchlist/${item.id}`}>{item.target_name}</Link>
                    </td>
                    <td>{item.target_type === "page" ? "เพจ" : "หมวดหมู่"}</td>
                    <td className={styles.scopeCell}>
                      {scopeLabel(
                        item.scope_kind === "all"
                          ? { kind: "all" }
                          : item.scope_kind === "dataset"
                            ? { kind: "dataset", id: item.scope_dataset_id! }
                            : { kind: "category", id: item.scope_category_id! },
                        item.scope_name,
                      )}
                      {/* A snapshot scope has nothing for a baseline to measure,
                          and the list says so rather than implying it might. */}
                      {isSnapshotScope(item.scope_kind) ? (
                        <span className={styles.snapshotTag} data-testid={`watch-snapshot-${item.id}`}>
                          Snapshot
                        </span>
                      ) : null}
                      {!item.scope_available ? (
                        <span className={styles.unavailableTag} data-testid={`watch-unavailable-${item.id}`}>
                          ขอบเขตถูกลบแล้ว
                        </span>
                      ) : null}
                    </td>
                    <td>{thaiDateTime(item.baseline_at)}</td>
                    <td className={styles.signalCell}>
                      {item.tracked_signals.length} · {item.tracked_signals
                        .map((signal) => SIGNAL_META[signal].label)
                        .join(" · ")}
                    </td>
                    <td>
                      {item.latest_collected_at ? thaiDateTime(item.latest_collected_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      <p className={styles.note}>
        ตัวเลขการเปลี่ยนแปลงอยู่ในหน้ารายละเอียดของแต่ละรายการ — คำนวณสดตอนเปิดดู
        ไม่มีการประเมินเบื้องหลัง
      </p>

      {/* Kept where the researcher can see it while looking at watches. */}
      <p className={styles.note} data-testid="watchlist-scope-hint">
        ขอบเขตข้อมูลเป็นส่วนหนึ่งของรายการ: ติดตามเพจเดียวกันคนละขอบเขต คือคนละรายการ
      </p>
    </>
  );
}
