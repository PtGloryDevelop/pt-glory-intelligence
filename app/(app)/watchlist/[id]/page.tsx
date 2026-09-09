import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { getWatchEvidence, getWatchItem, getWatchSignals } from "@/lib/read/watchlist";
import { getPageDetail } from "@/lib/read/pages";
import { getCategoryDetail } from "@/lib/read/categories";
import { signArchivedPreviews } from "@/lib/media/presentation";
import {
  BASELINE_RESET_EXPLANATION, SIGNAL_META, SNAPSHOT_NOTE, WATCHLIST_BASIS,
  isSnapshotScope, pageScopeFromWatch, stateNote, watchScopeParam, watchSignal,
} from "@/lib/watchlist/contract";
import { scopeBasis, scopeLabel } from "@/lib/pages/scope";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { StatusBadge } from "@/components/StatusBadge";
import { EvidenceGrid } from "@/components/EvidenceGrid";
import { EmptyState } from "@/components/states/EmptyState";
import { WatchControls } from "./controls";
import styles from "../watchlist.module.css";

export const dynamic = "force-dynamic";

const EVIDENCE_SIZE = 24;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * One saved watch.
 *
 * Two panels that must never be confused: what is true now, and what has changed
 * since the baseline. The first is the frozen Page or Category intelligence,
 * reused unchanged. The second is the only thing this feature adds — and each of
 * its rows says whether it is an event that happened, a state compared against
 * an older observation, or a value seen for the first time.
 */
export default async function WatchDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  await requireActorOrRedirect();
  const query = await searchParams;

  // RLS makes this a 404 for somebody else's watch, without a separate check.
  const item = await getWatchItem(id);
  if (!item) notFound();

  const scope = pageScopeFromWatch(item);
  const scopeParam = watchScopeParam(item);
  const snapshot = isSnapshotScope(item.scope_kind);

  const [signals, pageDetail, categoryDetail] = await Promise.all([
    getWatchSignals(id),
    item.target_type === "page" && scope
      ? getPageDetail(scope, item.target_page_id!)
      : Promise.resolve(null),
    item.target_type === "category" && item.target_category_id
      ? getCategoryDetail(item.target_category_id)
      : Promise.resolve(null),
  ]);

  const tracked = signals.filter((row) => item.tracked_signals.includes(row.signal));
  const selected = watchSignal(one(query.signal));
  const selectedRow = selected ? tracked.find((row) => row.signal === selected) : null;

  const evidence = selectedRow
    ? await getWatchEvidence(id, selectedRow.signal, { limit: EVIDENCE_SIZE })
    : null;
  const evidenceRows = evidence ? await withPreviews(evidence.rows) : [];

  const baselineAt = item.baseline_at;

  return (
    <>
      <PageHeader
        eyebrow="Watchlist"
        title={item.target_name}
        back={{ href: "/watchlist", label: "รายการติดตามทั้งหมด" }}
        description={
          item.target_type === "page"
            ? "เพจที่บันทึกไว้ตรวจดูเอง · ยังไม่ได้จับคู่เป็นแบรนด์"
            : "หมวดหมู่ที่บันทึกไว้ตรวจดูเอง"
        }
        actions={
          item.target_type === "page" ? (
            <Link href={`/pages/${item.target_page_id}?scope=${scopeParam}`}>เปิดหน้าเพจ</Link>
          ) : (
            <Link href={`/categories/${item.target_category_id}`}>เปิดหน้าหมวดหมู่</Link>
          )
        }
      />

      <ContextBar
        items={[
          { label: "ชนิดเป้าหมาย", value: item.target_type === "page" ? "เพจ" : "หมวดหมู่" },
          {
            label: "ตัวระบุที่บันทึกไว้",
            value: item.target_page_id ?? item.target_category_id ?? "—",
            testId: "watch-identity",
          },
          {
            label: "ขอบเขตข้อมูล",
            value: scope ? scopeLabel(scope, item.scope_name) : "—",
            testId: "watch-scope",
          },
          { label: "จุดอ้างอิง", value: thaiDateTime(baselineAt), testId: "watch-baseline" },
          {
            label: "เก็บข้อมูลล่าสุด",
            value: item.latest_collected_at ? thaiDateTime(item.latest_collected_at) : "—",
            testId: "watch-latest-collection",
          },
        ]}
      />

      <p className={styles.basis} data-testid="watchlist-basis">{WATCHLIST_BASIS}</p>
      {scope ? <p className={styles.basis}>{scopeBasis(scope)}</p> : null}

      {!item.scope_available ? (
        // The scope is gone; the watch is not silently widened to something else.
        <p className={styles.caveat} data-testid="watch-scope-unavailable">
          ขอบเขตข้อมูลของรายการนี้ถูกลบไปแล้ว — ตัวเลขด้านล่างจึงอาจว่าง
          ระบบไม่ได้เปลี่ยนขอบเขตให้อัตโนมัติ
        </p>
      ) : null}

      {/* ------------------------------------------------- current state */}

      <Panel padded className={styles.section}>
        <PanelHead
          title="สถานะปัจจุบัน"
          meta="ค่าจากหน้า Intelligence เดิม ไม่ใช่การเปลี่ยนแปลง"
        />
        {pageDetail ? (
          <KPIRow>
            <KPIStat label="Ads ที่พบ" value={pageDetail.observed_ads}
              helper="โฆษณาที่ไม่ซ้ำกันในขอบเขตนี้" testId="current-observed" />
            <KPIStat label="Evergreen" value={pageDetail.evergreen_ads}
              helper="ยังแสดงอยู่ และอายุถึงเกณฑ์" testId="current-evergreen" />
            <KPIStat label="ใช้ซ้ำ" value={pageDetail.reused_ads}
              helper="collation > 1" testId="current-reused" />
            <KPIStat label="เริ่มพบ" value={thaiDate(pageDetail.first_observed_at)}
              helper="รอบเก็บแรกที่เห็นเพจนี้" />
          </KPIRow>
        ) : null}
        {categoryDetail ? (
          <KPIRow>
            <KPIStat label="Ads ที่พบ" value={categoryDetail.observed_ads}
              helper="โฆษณาที่ไม่ซ้ำกันในหมวดนี้" testId="current-observed" />
            <KPIStat label="เพจที่พบ" value={categoryDetail.observed_pages}
              helper="ตัวตนเพจที่ไม่ซ้ำกัน" testId="current-pages" />
            <KPIStat label="Evergreen" value={categoryDetail.evergreen_ads}
              helper={`อายุ ≥ ${categoryDetail.evergreen_threshold_days} วัน`} testId="current-evergreen" />
            <KPIStat label="ใช้ซ้ำ" value={categoryDetail.reused_ads}
              helper="collation > 1" testId="current-reused" />
          </KPIRow>
        ) : null}
        {pageDetail ? (
          <div className={styles.states} data-testid="current-states">
            <StatusBadge isActive={true} count={pageDetail.active_ads} />
            <StatusBadge isActive={false} count={pageDetail.inactive_ads} />
            <StatusBadge isActive={null} count={pageDetail.unknown_ads} />
            <span className={styles.stateNote}>
              “ไม่ทราบ” คือรอบเก็บอ่านสถานะไม่ได้ ไม่ใช่หยุดแสดง
            </span>
          </div>
        ) : null}
      </Panel>

      {/* --------------------------------------------- since the baseline */}

      <Panel className={styles.section}>
        <PanelHead
          title="ตั้งแต่จุดอ้างอิง"
          meta={`นับจาก ${thaiDateTime(baselineAt)}`}
        />
        {snapshot ? (
          <div className={styles.snapshotPanel} data-testid="watch-snapshot-note">
            <p>{SNAPSHOT_NOTE}</p>
            <p className={styles.stateNote}>
              รอบเก็บอื่นที่เกิดขึ้นทีหลังไม่ถูกนำมาใช้กับรายการนี้ เพราะจะทำให้ค่าของ Dataset เปลี่ยนความหมาย
            </p>
          </div>
        ) : (
          <TableWrap>
            <table data-testid="watch-signals">
              <thead>
                <tr>
                  <th>สัญญาณ</th>
                  <th>ชนิด</th>
                  <th>จำนวน</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {tracked.map((row) => {
                  const meta = SIGNAL_META[row.signal];
                  const note = meta.kind === "state" ? stateNote(Number(row.new_observations)) : null;
                  const value = Number(row.value);
                  return (
                    <tr key={row.signal} data-testid={`signal-row-${row.signal}`} data-kind={meta.kind}>
                      <th scope="row" className={styles.signalLabel}>
                        {meta.label}
                        <span className={styles.signalHelper}>{meta.helper}</span>
                      </th>
                      <td className={styles.kind} data-testid={`signal-kind-${row.signal}`}>
                        {meta.kind === "event" ? "เหตุการณ์หลังจุดอ้างอิง"
                          : meta.kind === "state" ? "เทียบกับการสังเกต ณ จุดอ้างอิง"
                          : "พบครั้งแรกหลังจุดอ้างอิง"}
                      </td>
                      <td>
                        {value > 0 ? (
                          <Link
                            href={`/watchlist/${id}?signal=${row.signal}#evidence`}
                            data-testid={`signal-value-${row.signal}`}
                            data-numeral
                          >
                            {value}
                          </Link>
                        ) : (
                          <span data-testid={`signal-value-${row.signal}`} data-numeral>{value}</span>
                        )}
                      </td>
                      <td className={styles.signalNote}>
                        {/* "No new observation" and "no change" are different
                            answers, and only one of them is ever true here. */}
                        {note ? (
                          <span className={styles.caveatInline} data-testid={`signal-note-${row.signal}`}>
                            {note}
                          </span>
                        ) : row.new_values && row.new_values.length > 0 ? (
                          <span data-testid={`signal-values-${row.signal}`}>
                            {row.new_values.join(" · ")}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {/* ---------------------------------------------------- evidence */}

      <Panel padded className={styles.section}>
        <span id="evidence" className={styles.anchor} />
        <PanelHead
          title={selectedRow ? `หลักฐาน: ${SIGNAL_META[selectedRow.signal].label}` : "หลักฐาน"}
          meta={evidence ? `${evidence.total.toLocaleString("th-TH")} รายการ` : undefined}
        />
        {selectedRow ? (
          <>
            <p className={styles.stateNote} data-testid="evidence-source">
              {SIGNAL_META[selectedRow.signal].helper}
            </p>
            {evidenceRows.length === 0 ? (
              <EmptyState
                testId="evidence-empty"
                title="ไม่มีโฆษณาในกลุ่มนี้"
                body="สัญญาณนี้เป็นศูนย์สำหรับจุดอ้างอิงและขอบเขตปัจจุบัน"
              />
            ) : (
              <EvidenceGrid
                rows={evidenceRows}
                datasetId={item.scope_kind === "dataset" ? item.scope_dataset_id : null}
                testId="watch-evidence"
              />
            )}
            {evidence && evidence.total > EVIDENCE_SIZE ? (
              <p className={styles.stateNote}>
                แสดง {evidenceRows.length} จาก {evidence.total.toLocaleString("th-TH")} รายการ
              </p>
            ) : null}
          </>
        ) : (
          <p className={styles.stateNote} data-testid="evidence-hint">
            กดตัวเลขในตาราง “ตั้งแต่จุดอ้างอิง” เพื่อดูโฆษณาที่นับไว้จริง
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------- manage watch */}

      <WatchControls
        id={id}
        targetType={item.target_type}
        signals={item.tracked_signals}
        baselineAt={baselineAt}
        resetExplanation={BASELINE_RESET_EXPLANATION}
      />
    </>
  );
}

async function withPreviews<
  T extends { archive_path: string | null; archive_status: string | null; total_count: number },
>(rows: T[]) {
  const signed = await signArchivedPreviews(rows);
  return rows.map(({ total_count, ...row }) => {
    void total_count;
    return { ...row, archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null };
  });
}
