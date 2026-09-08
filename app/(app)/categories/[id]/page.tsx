import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import {
  getCategoryActivity, getCategoryCreativeMix, getCategoryDatasets, getCategoryDetail,
  getCategoryEvidence, getCategoryPages, getCategoryRunHistory,
} from "@/lib/read/categories";
import { signArchivedPreviews } from "@/lib/media/presentation";
import {
  CATEGORY_BASIS, CATEGORY_PAGE_SORTS, DEFAULT_CATEGORY_SORT,
  categorySortKey, datasetComparability, observedShare,
} from "@/lib/categories/workspace";
import { PAGE_SIGNALS, RECENT_DAYS, SIGNAL_LABEL, pageSignal, recentDays } from "@/lib/pages/scope";
import {
  GRAINS, GRAIN_LABEL, METRIC_LABEL, METRIC_SOURCE, RANGES, RANGE_LABEL,
  bucketEnd, rangeWindow, timelineGrain, timelineMetric, timelineRange,
} from "@/lib/pages/timeline";
import { coverageOf } from "@/lib/domain/coverage-language";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { StatusBadge } from "@/components/StatusBadge";
import { DistributionBars } from "@/components/DistributionBars";
import { TimelineChart } from "@/components/TimelineChart";
import { EvidenceGrid } from "@/components/EvidenceGrid";
import { EmptyState } from "@/components/states/EmptyState";
import styles from "./category.module.css";

export const dynamic = "force-dynamic";

const RANKING_SIZE = 25;
const EVIDENCE_SIZE = 24;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The category workspace.
 *
 * A research surface, not a dashboard: identity and its caveats first, then who
 * is advertising, then what the creatives look like, then the ads themselves.
 * Every count on the way down opens the exact rows behind it.
 *
 * Two truth layers, kept apart. The overview, the ranking, the mixes and the
 * signals all read ONE primitive — the latest observation of each distinct ad in
 * the category — so nothing on screen can disagree about what "latest" means.
 * The activity chart does not use that reduction at all; it reads the ads and
 * the runs, exactly as the page timeline does.
 */
export default async function CategoryWorkspace({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  await requireActorOrRedirect();
  const query = await searchParams;

  const days = recentDays(one(query.recentDays));
  const detail = await getCategoryDetail(id, days);
  if (!detail) notFound();

  const sort = categorySortKey(one(query.sort)) ?? DEFAULT_CATEGORY_SORT;
  const search = one(query.search) ?? "";
  const rankOffsetRaw = Number(one(query.rank));
  const rankOffset = Number.isFinite(rankOffsetRaw) && rankOffsetRaw > 0 ? Math.trunc(rankOffsetRaw) : 0;

  const range = timelineRange(one(query.range));
  const grain = timelineGrain(one(query.grain), range);
  const window = rangeWindow(range);

  const [datasets, runs, pages, mix, activity] = await Promise.all([
    getCategoryDatasets(id),
    getCategoryRunHistory(id),
    getCategoryPages(id, { recentDays: days, search: search || null, sort, limit: RANKING_SIZE, offset: rankOffset }),
    getCategoryCreativeMix(id),
    getCategoryActivity(id, { bucket: grain, from: window.from, to: window.to }),
  ]);

  const comparable = datasetComparability(datasets);
  const selection = await resolveSelection(id, query, days, grain);

  const link = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (days !== 30) next.set("recentDays", String(days));
    if (sort !== DEFAULT_CATEGORY_SORT) next.set("sort", sort);
    if (search) next.set("search", search);
    if (range !== "all") next.set("range", range);
    if (grain !== timelineGrain(undefined, range)) next.set("grain", grain);
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return `/categories/${id}${qs ? `?${qs}` : ""}`;
  };

  const dimension = (name: string) => mix.filter((row) => row.dimension === name);
  const observed = mix[0]?.observed ?? detail.observed_ads;
  const coveredOf = (name: string) => dimension(name)[0]?.covered ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Category Workspace"
        title={detail.category_name}
        back={{ href: "/categories", label: "หมวดหมู่ทั้งหมด" }}
        description="หมวดหมู่วิจัยของ PT Glory · จัดอันดับตามเพจ ยังไม่มีการจับคู่เป็นแบรนด์"
      />

      <ContextBar
        items={[
          { label: "Dataset ที่ใช้", value: String(detail.dataset_count), testId: "context-datasets" },
          { label: "รอบเก็บ", value: String(detail.run_count) },
          { label: "Ads ที่พบ", value: String(detail.observed_ads), testId: "context-ads" },
          { label: "เพจที่พบ", value: String(detail.observed_pages), testId: "context-pages" },
          { label: "เก็บครั้งแรก", value: thaiDate(detail.first_collected_at) },
          { label: "เก็บล่าสุด", value: thaiDate(detail.last_collected_at) },
        ]}
      />

      {/* The caveat belongs here, once, in front of every number below it. */}
      <p className={styles.basis} data-testid="category-basis">{CATEGORY_BASIS}</p>
      {comparable.note ? (
        <p className={styles.caveat} data-testid="comparability-note">{comparable.note}</p>
      ) : null}

      {detail.observed_ads === 0 ? (
        <EmptyState
          testId="category-empty"
          title={detail.dataset_count === 0 ? "หมวดนี้ยังไม่มี Dataset" : "หมวดนี้ยังไม่มีโฆษณา"}
          body={
            detail.dataset_count === 0
              ? "นำเข้าไฟล์เข้าหมวดนี้ก่อน แล้วหน้านี้จะมีข้อมูลให้วิเคราะห์"
              : "มี Dataset อยู่ แต่ยังไม่มีโฆษณาที่นำเข้าได้สำเร็จ"
          }
          action={<Link href="/import">ไปที่นำเข้าข้อมูล</Link>}
        />
      ) : (
        <>
          <KPIRow>
            <KPIStat
              label="Ads ที่พบ" value={detail.observed_ads}
              helper="โฆษณาที่ไม่ซ้ำกันในหมวดนี้" testId="kpi-observed"
            />
            <KPIStat
              label="เพจที่พบ" value={detail.observed_pages}
              helper="ตัวตนเพจที่ไม่ซ้ำกัน · ยังไม่ได้รวมเป็นแบรนด์" testId="kpi-pages"
            />
            <KPIStat
              label={`พบใหม่ใน ${days} วัน`} value={detail.recently_found}
              helper="นับจากวันที่ PT Glory เห็นครั้งแรก" testId="kpi-recent"
            />
            <KPIStat
              label="Evergreen" value={detail.evergreen_ads}
              helper={`ยังแสดงอยู่ และอายุ ≥ ${detail.evergreen_threshold_days} วัน`}
              testId="kpi-evergreen"
            />
            <KPIStat
              label="ใช้ซ้ำ" value={detail.reused_ads}
              helper="โฆษณาที่ collation > 1" testId="kpi-reused"
            />
          </KPIRow>

          <Panel padded className={styles.section}>
            <h2 className={styles.sectionTitle}>สถานะโฆษณาที่พบล่าสุด</h2>
            <div className={styles.states} data-testid="category-states">
              <StatusBadge isActive={true} count={detail.active_ads} />
              <StatusBadge isActive={false} count={detail.inactive_ads} />
              <StatusBadge isActive={null} count={detail.unknown_ads} />
              <span className={styles.stateNote}>
                จาก {detail.observed_ads.toLocaleString("th-TH")} รายการ ·
                “ไม่ทราบ” คือรอบเก็บอ่านสถานะไม่ได้ ไม่ใช่หยุดแสดง
              </span>
            </div>
          </Panel>

          {/* ---------------------------------------------------- activity */}

          <Panel padded className={styles.section}>
            <PanelHead
              title="กิจกรรมตามช่วงเวลา"
              meta={
                <span className={styles.controlRow}>
                  {RANGES.map((option) => (
                    <Link
                      key={option}
                      href={link({ range: option === "all" ? null : option, grain: null, metric: null, bucket: null })}
                      className={option === range ? styles.controlOn : styles.control}
                      data-testid={`range-${option}`}
                    >
                      {RANGE_LABEL[option]}
                    </Link>
                  ))}
                  {GRAINS.map((option) => (
                    <Link
                      key={option}
                      href={link({ grain: option, metric: null, bucket: null })}
                      className={option === grain ? styles.controlOn : styles.control}
                      data-testid={`grain-${option}`}
                    >
                      {GRAIN_LABEL[option]}
                    </Link>
                  ))}
                </span>
              }
            />
            {/* The two clocks are named where they are drawn. This chart reads
                the ads themselves, never the latest-observation reduction the
                panels above it use. */}
            <ul className={styles.sources}>
              <li><strong>{METRIC_LABEL.started}</strong> — {METRIC_SOURCE.started}</li>
              <li><strong>{METRIC_LABEL.first_seen}</strong> — {METRIC_SOURCE.first_seen}</li>
            </ul>
            <TimelineChart
              points={activity}
              grain={grain}
              selected={selection?.kind === "bucket" ? { metric: selection.metric, bucket: selection.bucket } : null}
              href={(series, start) => link({ metric: series, bucket: start, signal: null, format: null, cta: null, platform: null, page: null })}
            />
          </Panel>

          {/* ----------------------------------------------- page ranking */}

          <Panel padded className={styles.section}>
            <PanelHead
              title="เพจ ตามจำนวน Ads ที่เราพบ"
              meta={`${pages.total.toLocaleString("th-TH")} เพจ`}
            />
            <form className={styles.rankControls} data-testid="ranking-controls">
              <label className={styles.field} htmlFor="rank-sort">
                <span className={styles.label}>เรียงตาม</span>
                <select id="rank-sort" name="sort" defaultValue={sort} data-testid="rank-sort">
                  {CATEGORY_PAGE_SORTS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field} htmlFor="rank-search">
                <span className={styles.label}>ค้นชื่อเพจ</span>
                <input id="rank-search" name="search" defaultValue={search} data-testid="rank-search" />
              </label>
              <label className={styles.field} htmlFor="rank-days">
                <span className={styles.label}>หน้าต่าง “พบใหม่”</span>
                <select id="rank-days" name="recentDays" defaultValue={String(days)} data-testid="rank-days">
                  {RECENT_DAYS.map((option) => (
                    <option key={option} value={option}>{option} วัน</option>
                  ))}
                </select>
              </label>
              <button type="submit" data-variant="primary" data-testid="rank-apply">ใช้ตัวกรอง</button>
            </form>

            {pages.rows.length === 0 ? (
              <EmptyState
                testId="ranking-empty"
                title="ไม่พบเพจที่ตรงกับตัวกรองนี้"
                body="ลองล้างคำค้น หรือเปลี่ยนการเรียงลำดับ"
              />
            ) : (
              <TableWrap>
                <table data-testid="page-ranking">
                  <thead>
                    <tr>
                      <th>เพจ</th>
                      <th>Ads ที่พบ</th>
                      <th>สัดส่วนจาก Ads ที่เราพบ</th>
                      <th>สถานะ</th>
                      <th>พบใหม่ {days} วัน</th>
                      <th>เริ่มแสดงใหม่ {days} วัน</th>
                      <th>Evergreen</th>
                      <th>ใช้ซ้ำ</th>
                      <th>สังเกตล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.rows.map((row) => {
                      const share = observedShare(row.observed_ads, row.share_denominator);
                      return (
                        <tr key={row.page_id} data-testid={`rank-row-${row.page_id}`}>
                          <td>
                            {/* The category stays the scope: a page opened from
                                here answers about this category, not about
                                everything we have ever collected. */}
                            <Link href={`/pages/${row.page_id}?scope=category:${id}`}>
                              {row.page_name ?? row.page_id}
                            </Link>
                          </td>
                          <td>
                            <Link
                              href={link({ page: row.page_id, signal: null, metric: null, bucket: null, format: null, cta: null, platform: null })}
                              data-testid={`rank-ads-${row.page_id}`}
                              data-numeral
                            >
                              {row.observed_ads}
                            </Link>
                          </td>
                          {/* Never a bare percentage: the pair it came from is
                              in the same cell. */}
                          <td className={styles.share} data-testid={`rank-share-${row.page_id}`}>
                            <span data-numeral>{share.percent.toFixed(1)}%</span>
                            <span className={styles.sharePair}>{share.pair}</span>
                          </td>
                          <td className={styles.states}>
                            <StatusBadge isActive={true} count={row.active_ads} />
                            <StatusBadge isActive={false} count={row.inactive_ads} />
                            <StatusBadge isActive={null} count={row.unknown_ads} />
                          </td>
                          <td data-numeral>{row.recently_found}</td>
                          <td data-numeral>{row.started_recently}</td>
                          <td data-numeral>{row.evergreen_ads}</td>
                          <td data-numeral>{row.reused_ads}</td>
                          <td>{thaiDate(row.last_observed_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}

            {pages.total > RANKING_SIZE ? (
              <nav className={styles.pager} aria-label="หน้าอันดับเพจ">
                {rankOffset > 0 ? (
                  <Link data-testid="rank-prev" href={link({ rank: String(Math.max(rankOffset - RANKING_SIZE, 0)) })}>
                    ← ก่อนหน้า
                  </Link>
                ) : <span />}
                <span className={styles.pagerLabel}>
                  {rankOffset + 1}–{rankOffset + pages.rows.length} จาก {pages.total.toLocaleString("th-TH")}
                </span>
                {rankOffset + RANKING_SIZE < pages.total ? (
                  <Link data-testid="rank-next" href={link({ rank: String(rankOffset + RANKING_SIZE) })}>
                    ถัดไป →
                  </Link>
                ) : <span />}
              </nav>
            ) : null}
          </Panel>

          {/* ------------------------------------------------ creative mix */}

          <div className={styles.mix}>
            <Panel padded>
              <DistributionBars
                testId="mix-format" title="รูปแบบครีเอทีฟ"
                items={dimension("display_format").map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf("display_format")} observed={observed} exclusive
                evidenceHref={(value) => link({ format: value, signal: null, metric: null, bucket: null, cta: null, platform: null, page: null })}
              />
              <DistributionBars
                testId="mix-cta" title="ปุ่ม CTA"
                items={dimension("cta_type").map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf("cta_type")} observed={observed} exclusive
                evidenceHref={(value) => link({ cta: value, signal: null, metric: null, bucket: null, format: null, platform: null, page: null })}
              />
            </Panel>
            <Panel padded>
              <DistributionBars
                testId="mix-platform" title="แพลตฟอร์ม"
                items={dimension("publisher_platform").map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf("publisher_platform")} observed={observed} exclusive={false}
                evidenceHref={(value) => link({ platform: value, signal: null, metric: null, bucket: null, format: null, cta: null, page: null })}
              />
              {/* Meta's own label for a page. Named as such so it cannot be read
                  as the research category this workspace is about. */}
              <DistributionBars
                testId="mix-page-category" title="หมวดเพจ (จาก Meta)"
                items={dimension("page_category").map((row) => ({ value: row.value, n: row.n }))}
                covered={coveredOf("page_category")} observed={observed} exclusive={false}
              />
            </Panel>
          </div>

          {/* --------------------------------------------------- evidence */}

          <Panel padded className={styles.section}>
            <span id="evidence" className={styles.anchor} />
            <PanelHead
              title={selection ? selection.heading : "หลักฐาน: เลือกสัญญาณเพื่อดูโฆษณา"}
              meta={selection ? `${selection.total.toLocaleString("th-TH")} รายการ` : undefined}
            />

            <div className={styles.signals} role="group" aria-label="เลือกสัญญาณ" data-testid="signal-tabs">
              {PAGE_SIGNALS.map((key) => (
                <Link
                  key={key}
                  href={link({ signal: key, metric: null, bucket: null, format: null, cta: null, platform: null, page: null })}
                  className={selection?.kind === "signal" && selection.signal === key ? styles.signalOn : styles.signal}
                  data-testid={`signal-${key}`}
                >
                  {SIGNAL_LABEL[key]}
                </Link>
              ))}
              {selection ? (
                <Link href={link({ signal: null, metric: null, bucket: null, format: null, cta: null, platform: null, page: null })} className={styles.signal} data-testid="signal-clear">
                  ล้าง
                </Link>
              ) : null}
            </div>

            {selection ? (
              <>
                <p className={styles.source} data-testid="evidence-source">{selection.source}</p>
                {selection.rows.length === 0 ? (
                  <EmptyState
                    testId="evidence-empty"
                    title="ไม่มีโฆษณาในกลุ่มนี้"
                    body="ตัวเลขของกลุ่มนี้เป็นศูนย์ในหมวดนี้"
                  />
                ) : (
                  <EvidenceGrid rows={selection.rows} datasetId={null} testId="category-evidence" />
                )}
                {selection.total > EVIDENCE_SIZE ? (
                  <p className={styles.source}>
                    แสดง {selection.rows.length} จาก {selection.total.toLocaleString("th-TH")} รายการ
                  </p>
                ) : null}
              </>
            ) : (
              <p className={styles.source} data-testid="evidence-hint">
                ทุกตัวเลขในหน้านี้เปิดดูโฆษณาจริงได้ — กดที่สัญญาณด้านบน ที่แถบรูปแบบครีเอทีฟ
                ที่จำนวน Ads ของเพจ หรือที่ช่วงเวลาในกราฟ
              </p>
            )}
          </Panel>

          {/* ------------------------------------------- contributing data */}

          <Panel padded className={styles.section}>
            <PanelHead title="ข้อมูลที่ใช้" meta={`${datasets.length} Dataset · ${runs.length} รอบเก็บ`} />
            <TableWrap>
              <table data-testid="contributing-datasets">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>เก็บเมื่อ</th>
                    <th>คำค้น / ประเทศ</th>
                    <th>สถานะรอบ</th>
                    <th>Ads</th>
                    <th>เพจ</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((row) => (
                    <tr key={row.dataset_id} data-testid={`dataset-row-${row.dataset_id}`}>
                      <td><Link href={`/datasets/${row.dataset_id}`}>{row.dataset_name}</Link></td>
                      <td>{thaiDateTime(row.collected_at)}</td>
                      <td className={styles.runScope}>
                        {row.scope_query ?? "—"} · {row.scope_country ?? "—"}
                      </td>
                      {/* Import status of the run — not the field coverage of
                          the insights above. Two different kinds of quality. */}
                      <td>{row.run_status}</td>
                      <td data-numeral>{row.ads_in_dataset}</td>
                      <td data-numeral>{row.pages_in_dataset}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        </>
      )}
    </>
  );
}

/**
 * The one selected slice, resolved into one query, one heading and one source
 * sentence — so a heading can never describe something the rows do not answer.
 */
async function resolveSelection(
  categoryId: string,
  query: Search,
  days: number,
  grain: "day" | "week",
) {
  const signal = pageSignal(one(query.signal));
  const metric = timelineMetric(one(query.metric));
  const bucket = one(query.bucket) ?? null;
  const format = one(query.format) ?? null;
  const cta = one(query.cta) ?? null;
  const platform = one(query.platform) ?? null;
  const pageId = one(query.page) ?? null;

  const chosen =
    signal ? { kind: "signal" as const }
    : metric && metric !== "run" && bucket ? { kind: "bucket" as const }
    : format || cta || platform ? { kind: "dimension" as const }
    : pageId ? { kind: "page" as const }
    : null;
  if (!chosen) return null;

  const { rows, total } = await getCategoryEvidence(categoryId, {
    signal,
    recentDays: days,
    format, cta, platform, pageId,
    windowMetric: chosen.kind === "bucket" ? (metric as "started" | "first_seen") : null,
    from: chosen.kind === "bucket" ? bucket : null,
    to: chosen.kind === "bucket" && bucket ? bucketEnd(bucket, grain) : null,
    limit: EVIDENCE_SIZE,
  });
  const signed = await signArchivedPreviews(rows);
  const withPreviews = rows.map(({ total_count, ...row }) => {
    void total_count;
    return { ...row, archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null };
  });

  if (chosen.kind === "signal") {
    return {
      kind: "signal" as const, signal: signal!,
      heading: `หลักฐาน: ${SIGNAL_LABEL[signal!]}`,
      source:
        signal === "recent" ? `นับจากวันที่ PT Glory เห็นครั้งแรก ภายใน ${days} วัน`
        : signal === "started_recently" ? `นับจากวันที่ Meta ระบุว่าเริ่มแสดง ภายใน ${days} วัน`
        : signal === "unknown" ? "รอบเก็บล่าสุดอ่านสถานะไม่ได้ — ไม่ใช่หยุดแสดง"
        : "นิยามเดียวกับที่ใช้ในหน้าเพจ",
      total, rows: withPreviews,
    };
  }

  if (chosen.kind === "bucket") {
    return {
      kind: "bucket" as const, metric: metric!, bucket: bucket!,
      heading: `หลักฐาน: ${METRIC_LABEL[metric!]} · ${thaiDate(bucket!)}`,
      source: METRIC_SOURCE[metric!],
      total, rows: withPreviews,
    };
  }

  if (chosen.kind === "dimension") {
    const value = [format, cta, platform].filter(Boolean).join(" · ");
    const dimensionCoverage = coverageOf(total, total);
    void dimensionCoverage;
    return {
      kind: "dimension" as const,
      heading: `หลักฐาน: ${value}`,
      source: "โฆษณาที่มีค่านี้ในการสังเกตล่าสุดของหมวดนี้",
      total, rows: withPreviews,
    };
  }

  return {
    kind: "page" as const,
    heading: `หลักฐาน: เพจ ${rows[0]?.page_name ?? pageId}`,
    source: "โฆษณาของเพจนี้ในหมวดนี้ ตามการสังเกตล่าสุด",
    total, rows: withPreviews,
  };
}
