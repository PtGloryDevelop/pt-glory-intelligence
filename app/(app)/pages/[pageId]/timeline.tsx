import Link from "next/link";
import {
  getPageRunHistory, getPageRunMix, getPageTimeline, getPageTimelineEvidence,
} from "@/lib/read/pages";
import { signArchivedPreviews } from "@/lib/media/presentation";
import { scopeToParam, type PageScope } from "@/lib/pages/scope";
import {
  GRAINS, GRAIN_LABEL, METRIC_LABEL, METRIC_SOURCE, RANGES, RANGE_LABEL,
  bucketEnd, comparability, rangeWindow, timelineGrain, timelineMetric,
  timelineRange, runStatus, STATUS_LABEL,
  type Grain, type TimelineMetric, type TimelineRange,
} from "@/lib/pages/timeline";
import { statusFilterNote, type CollectionFilters } from "@/lib/domain/collection-filters";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { StatusBadge } from "@/components/StatusBadge";
import { TimelineChart } from "@/components/TimelineChart";
import { DistributionBars } from "@/components/DistributionBars";
import { EmptyState } from "@/components/states/EmptyState";
import { BucketEvidence } from "./bucket-evidence";
import styles from "./page-detail.module.css";

/**
 * The timeline view of one page.
 *
 * Three clocks, three sections, never mixed: the two ad-property series in the
 * chart, the collection runs in their own table, and — when a bucket is chosen
 * — the exact ads that bucket counted. The selection lives in the URL, so a
 * week worth arguing about can be sent to somebody else.
 */

const EVIDENCE_SIZE = 24;

export async function PageTimeline({ scope, pageId, datasetId, query, pageName, filters }: {
  scope: PageScope;
  pageId: string;
  datasetId: string | null;
  query: Record<string, string | undefined>;
  pageName: string;
  /** Already read by the page, and the same answer for both tabs. */
  filters: CollectionFilters | null;
}) {
  const range = timelineRange(query.range);
  const grain = timelineGrain(query.grain, range);
  const window = rangeWindow(range);
  const metric = timelineMetric(query.metric);
  const bucket = query.bucket ?? null;
  const runId = query.run ?? null;
  const status = runStatus(query.status);

  const [points, runs] = await Promise.all([
    getPageTimeline(scope, pageId, { bucket: grain, from: window.from, to: window.to }),
    getPageRunHistory(scope, pageId),
  ]);

  const scopeParam = scopeToParam(scope);
  const base = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams({ scope: scopeParam, view: "timeline" });
    if (range !== "all") next.set("range", range);
    if (grain !== timelineGrain(undefined, range)) next.set("grain", grain);
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/pages/${pageId}?${next.toString()}`;
  };

  const comparable = comparability(runs);

  // What the reader selected, resolved into one query and one heading.
  const selection = await resolveSelection({
    scope, pageId, metric, bucket, grain, runId, status,
  });

  return (
    <>
      <form className={styles.timelineControls} data-testid="timeline-controls">
        <span className={styles.controlLabel}>ช่วงเวลา</span>
        <div className={styles.controlRow}>
          {RANGES.map((option) => (
            <Link
              key={option}
              href={base({ range: option === "all" ? null : option, grain: null, bucket: null, metric: null, run: null, status: null })}
              className={option === range ? styles.controlOn : styles.control}
              data-testid={`range-${option}`}
            >
              {RANGE_LABEL[option]}
            </Link>
          ))}
        </div>
        <span className={styles.controlLabel}>ความละเอียด</span>
        <div className={styles.controlRow}>
          {GRAINS.map((option) => (
            <Link
              key={option}
              href={base({ grain: option, bucket: null, metric: null })}
              className={option === grain ? styles.controlOn : styles.control}
              data-testid={`grain-${option}`}
            >
              {GRAIN_LABEL[option]}
            </Link>
          ))}
        </div>
        <p className={styles.period} data-testid="timeline-period">
          {window.from
            ? `${thaiDate(window.from)} — ${thaiDate(new Date().toISOString())}`
            : "ทั้งหมดเท่าที่เก็บมา"}
          {" · "}{GRAIN_LABEL[grain]}
        </p>
      </form>

      <Panel padded className={styles.section}>
        <PanelHead title="โฆษณาตามช่วงเวลา" meta="นับโฆษณาที่ไม่ซ้ำกัน" />
        {/* The two clocks are named where they are drawn, not only in a legend
            somewhere else on the page. */}
        <ul className={styles.sources}>
          <li><strong>{METRIC_LABEL.started}</strong> — {METRIC_SOURCE.started}</li>
          <li><strong>{METRIC_LABEL.first_seen}</strong> — {METRIC_SOURCE.first_seen}</li>
        </ul>
        <TimelineChart
          points={points}
          grain={grain}
          selected={metric && bucket ? { metric, bucket } : null}
          href={(series, start) => base({ metric: series, bucket: start, run: null, status: null })}
        />
      </Panel>

      <Panel padded className={styles.section}>
        <PanelHead
          title="รอบเก็บที่เห็นเพจนี้"
          meta={`${runs.length} รอบ · ${METRIC_SOURCE.run}`}
        />

        {/*
          * Runs are only comparable if they asked the same question of the same
          * market. When they did not, a difference between two rows is a
          * difference in what was collected — said here, in front of the numbers,
          * rather than left for the reader to infer a trend from.
          */}
        {comparable.note ? (
          <p className={styles.caveat} data-testid="comparability-note">{comparable.note}</p>
        ) : null}

        {runs.length === 0 ? (
          <EmptyState
            testId="runs-empty"
            title="ยังไม่มีรอบเก็บที่เห็นเพจนี้"
            body="ขอบเขตที่เลือกไม่มีรอบเก็บที่บันทึกเพจนี้ไว้"
          />
        ) : (
          <TableWrap>
            <table data-testid="run-history">
              <thead>
                <tr>
                  <th>เก็บเมื่อ</th>
                  <th>Dataset</th>
                  <th>คำค้น / ประเทศ</th>
                  <th>Ads ที่พบ</th>
                  <th>สถานะที่สังเกตได้</th>
                  <th>เพิ่งพบในขอบเขตนี้</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.collection_run_id} data-testid={`run-row-${run.collection_run_id}`}>
                    <td>{thaiDateTime(run.collected_at)}</td>
                    <td>
                      <Link href={`/datasets/${run.dataset_id}`}>{run.dataset_name}</Link>
                    </td>
                    <td className={styles.runScope}>
                      {run.scope_query ?? "—"} · {run.scope_country ?? "—"}
                    </td>
                    <td>
                      <Link
                        href={base({ metric: "run", run: run.collection_run_id, status: null, bucket: null })}
                        data-testid={`run-observed-${run.collection_run_id}`}
                        data-numeral
                      >
                        {run.observed_ads}
                      </Link>
                    </td>
                    <td className={styles.runStates}>
                      {/* Each state opens its own evidence. Unknown included:
                          "we could not read it" is an answer worth inspecting. */}
                      {([["active", run.active_ads], ["inactive", run.inactive_ads],
                         ["unknown", run.unknown_ads]] as const).map(([state, n]) => (
                        <Link
                          key={state}
                          href={base({ metric: "run", run: run.collection_run_id, status: state, bucket: null })}
                          data-testid={`run-${state}-${run.collection_run_id}`}
                          className={styles.stateLink}
                        >
                          <StatusBadge
                            isActive={state === "active" ? true : state === "inactive" ? false : null}
                            count={n}
                          />
                        </Link>
                      ))}
                    </td>
                    <td data-numeral>{run.newly_encountered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {/* The same sentence the overview tab carries. Per-run status badges
            sit here too, and a reader on this tab never sees the other one. */}
        {statusFilterNote(filters) ? (
          <p className={styles.filterNote} data-testid="status-filter-note">
            {statusFilterNote(filters)}
          </p>
        ) : null}
        <p className={styles.caveat}>
          ตัวเลขเหล่านี้คือสิ่งที่เราพบในแต่ละรอบเก็บ ไม่ใช่จำนวนโฆษณาทั้งหมดที่เพจนี้มีอยู่จริง
          และการที่ตัวเลขเปลี่ยนระหว่างรอบไม่ได้แปลว่าเพจเปลี่ยนพฤติกรรมการยิงโฆษณา
        </p>
      </Panel>

      {selection ? (
        <Panel padded className={styles.section}>
          <span id="bucket" className={styles.anchor} />
          <PanelHead
            title={selection.heading}
            meta={`${selection.total.toLocaleString("th-TH")} รายการ`}
          />
          <p className={styles.caveat} data-testid="selection-source">{selection.source}</p>

          {selection.mix.length > 0 ? (
            <div className={styles.runMix}>
              <DistributionBars
                testId="run-mix-format" title="รูปแบบครีเอทีฟในรอบนี้"
                items={selection.mix.filter((row) => row.dimension === "display_format")
                  .map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf(selection.mix, "display_format")}
                observed={selection.mix[0]?.observed ?? 0}
                exclusive
              />
              <DistributionBars
                testId="run-mix-cta" title="ปุ่ม CTA ในรอบนี้"
                items={selection.mix.filter((row) => row.dimension === "cta_type")
                  .map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf(selection.mix, "cta_type")}
                observed={selection.mix[0]?.observed ?? 0}
                exclusive
              />
              <DistributionBars
                testId="run-mix-platform" title="แพลตฟอร์มในรอบนี้"
                items={selection.mix.filter((row) => row.dimension === "publisher_platform")
                  .map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf(selection.mix, "publisher_platform")}
                observed={selection.mix[0]?.observed ?? 0}
                exclusive={false}
              />
            </div>
          ) : null}

          {selection.rows.length === 0 ? (
            <EmptyState
              testId="bucket-empty"
              title="ไม่มีโฆษณาในช่วงนี้"
              body="ช่วงเวลาที่เลือกไม่มีโฆษณาของเพจนี้"
            />
          ) : (
            <BucketEvidence rows={selection.rows} datasetId={datasetId} testId="bucket-evidence" />
          )}

          {selection.total > EVIDENCE_SIZE ? (
            <p className={styles.caveat}>
              แสดง {selection.rows.length} จาก {selection.total.toLocaleString("th-TH")} รายการ ·
              เปิด Ads ทั้งหมดของเพจนี้ได้ที่แท็บ ภาพรวม
            </p>
          ) : null}
        </Panel>
      ) : (
        <p className={styles.hint} data-testid="timeline-hint">
          เลือกตัวเลขในตารางช่วงเวลา หรือในตารางรอบเก็บ เพื่อดูโฆษณาที่นับไว้จริง — ทุกตัวเลขเปิดดูได้
        </p>
      )}

      {/* Page name is carried so a shared link reads as being about this page. */}
      <span hidden data-testid="timeline-page">{pageName}</span>
    </>
  );
}

function coveredOf(mix: { dimension: string; covered: number }[], dimension: string): number {
  return mix.find((row) => row.dimension === dimension)?.covered ?? 0;
}

/**
 * One selection, one query.
 *
 * The heading, the source sentence and the rows all come from the same branch,
 * so a bucket can never be labelled as one clock and filled from another.
 */
async function resolveSelection(input: {
  scope: PageScope;
  pageId: string;
  metric: TimelineMetric | null;
  bucket: string | null;
  grain: Grain;
  runId: string | null;
  status: ReturnType<typeof runStatus>;
}) {
  const { scope, pageId, metric, bucket, grain, runId, status } = input;
  if (!metric) return null;

  if (metric === "run") {
    if (!runId) return null;
    const [{ rows, total }, mix] = await Promise.all([
      getPageTimelineEvidence(scope, pageId, {
        metric: "run", runId, status, limit: EVIDENCE_SIZE,
      }),
      getPageRunMix(scope, pageId, runId),
    ]);
    const signed = await signArchivedPreviews(rows);
    return {
      heading: status
        ? `รอบเก็บนี้ · ${STATUS_LABEL[status]}`
        : "โฆษณาที่พบในรอบเก็บนี้",
      source: status
        ? `สถานะที่รอบเก็บนี้อ่านได้ ณ เวลานั้น — ไม่ใช่สถานะปัจจุบัน${
            status === "unknown" ? " · “ไม่ทราบ” คือรอบนี้อ่านสถานะไม่ได้ ไม่ใช่หยุดแสดง" : ""
          }`
        : METRIC_SOURCE.run,
      total,
      mix,
      rows: withPreviews(rows, signed),
    };
  }

  if (!bucket) return null;
  const from = bucket;
  const to = bucketEnd(bucket, grain);
  const { rows, total } = await getPageTimelineEvidence(scope, pageId, {
    metric, from, to, limit: EVIDENCE_SIZE,
  });
  const signed = await signArchivedPreviews(rows);
  return {
    heading: `${METRIC_LABEL[metric]} · ${thaiDate(bucket)}`,
    source: METRIC_SOURCE[metric],
    total,
    mix: [],
    rows: withPreviews(rows, signed),
  };
}

function withPreviews<T extends { archive_path: string | null; total_count: number }>(
  rows: T[],
  signed: Map<string, string>,
) {
  return rows.map(({ total_count, ...row }) => {
    void total_count;
    return { ...row, archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null };
  });
}

export type { TimelineRange };
