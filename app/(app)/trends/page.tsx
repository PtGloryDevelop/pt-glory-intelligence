import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import {
  getTrendContext, getTrendEvidence, getTrendMix, getTrendPages, getTrendSummary,
} from "@/lib/read/trends";
import { getPageDetail } from "@/lib/read/pages";
import { listCategories, listDatasets } from "@/lib/read/queries";
import { signArchivedPreviews } from "@/lib/media/presentation";
import {
  DIRECTION_MARK, NOT_COLLECTED, PERIOD_LENGTHS, changeOf, comparabilityOf,
  periodLength, trendPeriods,
} from "@/lib/trends/periods";
import {
  RANK_DIRECTIONS, RANK_LABEL, TREND_ROWS, metricRow, rankDirection, trendMetric,
} from "@/lib/trends/metrics";
import { isComparablePageId } from "@/lib/compare/contract";
import { isPageInScope } from "@/lib/read/compare";
import { parseScope, scopeBasis, scopeLabel, scopeToParam, type PageScope } from "@/lib/pages/scope";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { TrendMix } from "@/components/TrendMix";
import { EvidenceGrid } from "@/components/EvidenceGrid";
import { EmptyState } from "@/components/states/EmptyState";
import { TrendChooser } from "./chooser";
import styles from "./trends.module.css";

export const dynamic = "force-dynamic";

const EVIDENCE_SIZE = 24;
const RANK_SIZE = 10;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Trends: what changed between two equal windows of OUR observed data.
 *
 * The screen is built around one distinction. An EVENT — an ad's start date, or
 * the day we first saw it — belongs to a window. A STATE — active, evergreen,
 * reused, the creative mix — is only ever true as of an instant, so each period
 * is reconstructed at its own end from the observations that existed by then.
 * Every row says which kind it is, because the two answer different questions.
 *
 * Nothing here predicts, scores or explains. A trend is a subtraction, and the
 * caveats around it are about how the data was collected, never about what an
 * advertiser decided.
 */
export default async function TrendsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireActorOrRedirect();
  const query = await searchParams;

  const scope = parseScope(one(query.scope));
  if (!scope) return <Chooser />;

  const rawPage = one(query.page);
  const pageId = isComparablePageId(rawPage) ? rawPage : null;
  const days = periodLength(one(query.days));
  const periods = trendPeriods(days);

  const [summary, mix, currentContext, previousContext, scopeName, pageDetail] = await Promise.all([
    getTrendSummary(scope, pageId, periods.current, periods.previous),
    getTrendMix(scope, pageId, periods.current, periods.previous),
    getTrendContext(scope, periods.current),
    getTrendContext(scope, periods.previous),
    nameOfScope(scope),
    pageId ? getPageDetail(scope, pageId) : Promise.resolve(null),
  ]);

  /*
   * A page asked for but not represented in this scope is not a page with zero
   * activity, and the screen must not render one as the other.
   *
   * Membership is asked for directly: page_detail returns a row of zeroes for a
   * page the product knows from another scope, so its presence proves nothing.
   */
  const pageInScope = pageId ? await isPageInScope(scope, pageId) : true;
  if (pageId && !pageInScope) {
    return (
      <>
        <PageHeader eyebrow="Trends" title="แนวโน้ม" back={{ href: "/trends", label: "เลือกใหม่" }} />
        <EmptyState
          testId="trends-page-missing"
          title="เพจนี้ไม่ได้อยู่ในขอบเขตที่เลือก"
          body="ไม่ใช่ว่าพบ 0 รายการ — ขอบเขตนี้ไม่มีข้อมูลของเพจนี้เลย"
          action={<Link href={`/trends?scope=${scopeToParam(scope)}`}>ดูทั้งหมวด</Link>}
        />
      </>
    );
  }

  const comparability = comparabilityOf(currentContext, previousContext);
  const scopeParam = scopeToParam(scope);
  const entityName = pageDetail ? (pageDetail.page_name ?? pageDetail.page_id) : scopeLabel(scope, scopeName);

  const link = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams({ scope: scopeParam });
    if (pageId) next.set("page", pageId);
    if (days !== 30) next.set("days", String(days));
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/trends?${next.toString()}`;
  };

  const rankMetric = one(query.rankMetric) === "started" ? "started" : "first_seen";
  const direction = rankDirection(one(query.direction));
  const ranking = pageId
    ? { rows: [], total: 0 }
    : await getTrendPages(scope, rankMetric, periods.current, periods.previous, {
        direction, limit: RANK_SIZE,
      });

  const selection = await resolveSelection({ scope, pageId, query, periods });

  const valueOf = (metric: string) => summary.find((row) => row.metric === metric);
  const mixFor = (dimension: string, period: "current" | "previous") =>
    mix.filter((row) => row.dimension === dimension && row.period === period);
  const mixItems = (dimension: string) => {
    const values = [...new Set(mix.filter((row) => row.dimension === dimension).map((row) => row.value))];
    return values.map((value) => ({
      value,
      current: mixFor(dimension, "current").find((row) => row.value === value)?.n ?? 0,
      previous: mixFor(dimension, "previous").find((row) => row.value === value)?.n ?? 0,
    }));
  };
  const mixCoverage = (dimension: string) => ({
    current: {
      covered: mixFor(dimension, "current")[0]?.covered ?? 0,
      observed: mixFor(dimension, "current")[0]?.observed ?? 0,
    },
    previous: {
      covered: mixFor(dimension, "previous")[0]?.covered ?? 0,
      observed: mixFor(dimension, "previous")[0]?.observed ?? 0,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Trends"
        title={pageDetail ? `แนวโน้ม · ${entityName}` : `แนวโน้ม · ${entityName}`}
        back={pageId
          ? { href: `/trends?scope=${scopeParam}`, label: "แนวโน้มทั้งหมวด" }
          : { href: "/trends", label: "เลือกขอบเขตใหม่" }}
        description="เปรียบเทียบสองช่วงเวลาของข้อมูลที่ PT Glory เก็บมาได้ · ไม่ใช่การพยากรณ์"
      />

      <ContextBar
        items={[
          { label: "ขอบเขตข้อมูล", value: scopeLabel(scope, scopeName), testId: "scope-label" },
          { label: "สิ่งที่วิเคราะห์", value: pageDetail ? `เพจ ${entityName}` : "ทั้งหมวด", testId: "entity" },
          {
            label: "ช่วงล่าสุด",
            value: `${thaiDate(periods.current.from)} — ${thaiDate(periods.current.to)}`,
            testId: "current-period",
          },
          {
            label: "ช่วงก่อนหน้า",
            value: `${thaiDate(periods.previous.from)} — ${thaiDate(periods.previous.to)}`,
            testId: "previous-period",
          },
          { label: "รอบเก็บช่วงล่าสุด", value: String(currentContext.length), testId: "current-runs" },
          { label: "รอบเก็บช่วงก่อน", value: String(previousContext.length), testId: "previous-runs" },
        ]}
      />

      <p className={styles.basis} data-testid="scope-basis">{scopeBasis(scope)}</p>

      {/* Whether the two periods can be put beside each other at all. */}
      <p
        className={comparability.verdict === "comparable" ? styles.note : styles.caveat}
        data-testid="comparability"
        data-verdict={comparability.verdict}
      >
        {comparability.label}
        {comparability.note ? ` — ${comparability.note}` : ""}
      </p>

      <form className={styles.controls} data-testid="trend-controls">
        <span className={styles.controlLabel}>ความยาวช่วง</span>
        <span className={styles.controlRow}>
          {PERIOD_LENGTHS.map((option) => (
            <Link
              key={option}
              href={link({ days: String(option), metric: null, period: null, dim: null, value: null })}
              className={option === days ? styles.controlOn : styles.control}
              data-testid={`days-${option}`}
            >
              {option} วัน
            </Link>
          ))}
        </span>
        <span className={styles.controlNote}>
          เทียบ {days} วันล่าสุด กับ {days} วันก่อนหน้า — ความยาวเท่ากันเสมอ
        </span>
      </form>

      {/* ------------------------------------------------ summary deltas */}

      <Panel className={styles.section}>
        <PanelHead
          title="สรุปการเปลี่ยนแปลง"
          meta="ทุกตัวเลขคือสิ่งที่ PT Glory เก็บมาได้ ไม่ใช่ทั้งตลาด"
        />
        <TableWrap>
          <table data-testid="trend-summary">
            <thead>
              <tr>
                <th>ค่า</th>
                <th>ชนิด</th>
                <th>ช่วงนี้</th>
                <th>ช่วงก่อน</th>
                <th>ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {TREND_ROWS.map((row) => {
                const value = valueOf(row.metric);
                if (!value) return null;
                const change = changeOf(Number(value.current_value), Number(value.previous_value));
                return (
                  <tr key={row.metric} data-testid={`row-${row.metric}`} data-kind={row.kind}>
                    <th scope="row" className={styles.rowLabel}>
                      {row.label}
                      <span className={styles.rowHelper}>{row.helper}</span>
                    </th>
                    {/* Event and state are different questions; the row says which. */}
                    <td className={styles.kind} data-testid={`kind-${row.metric}`}>
                      {row.kind === "event" ? "เหตุการณ์ในช่วง" : "สถานะ ณ ปลายช่วง"}
                    </td>
                    {(["current", "previous"] as const).map((period) => {
                      const n = period === "current" ? change.current : change.previous;
                      return (
                        <td key={period}>
                          {n > 0 ? (
                            <Link
                              href={link({ metric: row.metric, period, dim: null, value: null })}
                              data-testid={`cell-${row.metric}-${period}`}
                              data-numeral
                            >
                              {n}
                            </Link>
                          ) : (
                            <span data-testid={`cell-${row.metric}-${period}`} data-numeral>{n}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={styles.delta} data-testid={`delta-${row.metric}`}>
                      {/* An arrow as well as the words: direction is never
                          carried by colour alone. */}
                      <span aria-hidden>{DIRECTION_MARK[change.direction]}</span> {change.label}
                      {change.percent !== null && !change.lowBase ? (
                        <span className={styles.percent}>
                          {" "}({change.percent > 0 ? "+" : ""}{change.percent.toFixed(0)}%)
                        </span>
                      ) : null}
                      {change.lowBase && change.previous > 0 ? (
                        <span className={styles.lowBase}> · ฐานช่วงก่อนต่ำ</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      {/* ------------------------------------------- page change ranking */}

      {!pageId ? (
        <Panel padded className={styles.section}>
          <PanelHead
            title={`เพจ · ${RANK_LABEL[direction]}`}
            meta={
              <span className={styles.controlRow}>
                {(["first_seen", "started"] as const).map((option) => (
                  <Link
                    key={option} href={link({ rankMetric: option })}
                    className={option === rankMetric ? styles.controlOn : styles.control}
                    data-testid={`rank-metric-${option}`}
                  >
                    {metricRow(option).label}
                  </Link>
                ))}
                {RANK_DIRECTIONS.map((option) => (
                  <Link
                    key={option} href={link({ direction: option })}
                    className={option === direction ? styles.controlOn : styles.control}
                    data-testid={`direction-${option}`}
                  >
                    {RANK_LABEL[option]}
                  </Link>
                ))}
              </span>
            }
          />
          {ranking.rows.length === 0 ? (
            <EmptyState
              testId="ranking-empty"
              title="ไม่มีการเปลี่ยนแปลงให้จัดอันดับ"
              body="ทั้งสองช่วงไม่มีโฆษณาที่เข้าเงื่อนไขนี้ในขอบเขตที่เลือก"
            />
          ) : (
            <TableWrap>
              <table data-testid="trend-pages">
                <thead>
                  <tr>
                    <th>เพจ</th>
                    <th>ช่วงนี้</th>
                    <th>ช่วงก่อน</th>
                    <th>ต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.rows.map((row) => (
                    <tr key={row.page_id} data-testid={`rank-row-${row.page_id}`}>
                      <td>
                        <Link href={link({ page: row.page_id, metric: null, period: null })}>
                          {row.page_name ?? row.page_id}
                        </Link>
                      </td>
                      <td data-numeral>{row.current_value}</td>
                      <td data-numeral>
                        {previousContext.length > 0
                          ? row.previous_value
                          : <span className={styles.absent}>{NOT_COLLECTED}</span>}
                      </td>
                      {/* Ranked by arithmetic delta. No weighting, no score —
                          and no delta at all when the previous period was never
                          collected, because "+28" would then describe our
                          collection schedule rather than the page. */}
                      <td className={styles.delta} data-testid={`rank-change-${row.page_id}`}>
                        {previousContext.length > 0 ? (
                          <>
                            <span aria-hidden>
                              {row.change > 0 ? "▲" : row.change < 0 ? "▼" : "—"}
                            </span>{" "}
                            {row.change > 0 ? `+${row.change}` : String(row.change)}
                          </>
                        ) : (
                          <span
                            className={styles.absent}
                            title="ช่วงก่อนหน้าไม่มีรอบเก็บ จึงยังไม่มีอะไรให้เทียบ"
                          >
                            ยังเทียบไม่ได้
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      ) : null}

      {/* --------------------------------------------------- mix change */}

      <div className={styles.mix}>
        <Panel padded>
          <TrendMix
            previousCollected={previousContext.length > 0}
            testId="mix-format" title="รูปแบบครีเอทีฟ" exclusive
            items={mixItems("display_format")}
            coverage={mixCoverage("display_format")}
            evidenceHref={(value, period) => link({ dim: "format", value, period, metric: null })}
          />
          <TrendMix
            previousCollected={previousContext.length > 0}
            testId="mix-cta" title="ปุ่ม CTA" exclusive
            items={mixItems("cta_type")}
            coverage={mixCoverage("cta_type")}
            evidenceHref={(value, period) => link({ dim: "cta", value, period, metric: null })}
          />
        </Panel>
        <Panel padded>
          <TrendMix
            previousCollected={previousContext.length > 0}
            testId="mix-platform" title="แพลตฟอร์ม" exclusive={false}
            items={mixItems("publisher_platform")}
            coverage={mixCoverage("publisher_platform")}
            evidenceHref={(value, period) => link({ dim: "platform", value, period, metric: null })}
          />
        </Panel>
      </div>

      {/* ---------------------------------------------------- evidence */}

      <Panel padded className={styles.section}>
        <span id="evidence" className={styles.anchor} />
        <PanelHead
          title={selection ? selection.heading : "หลักฐาน: เลือกตัวเลขเพื่อดูโฆษณา"}
          meta={selection ? `${selection.total.toLocaleString("th-TH")} รายการ` : undefined}
        />
        {selection ? (
          <>
            <p className={styles.source} data-testid="evidence-source">{selection.source}</p>
            {selection.rows.length === 0 ? (
              <EmptyState
                testId="evidence-empty"
                title="ไม่มีโฆษณาในกลุ่มนี้"
                body="ช่วงที่เลือกไม่มีโฆษณาที่เข้าเงื่อนไขนี้ในขอบเขตนี้"
              />
            ) : (
              <EvidenceGrid
                rows={selection.rows}
                datasetId={scope.kind === "dataset" ? scope.id : null}
                testId={`evidence-${selection.period}`}
              />
            )}
            {selection.total > EVIDENCE_SIZE ? (
              <p className={styles.source}>
                แสดง {selection.rows.length} จาก {selection.total.toLocaleString("th-TH")} รายการ
              </p>
            ) : null}
          </>
        ) : (
          <p className={styles.source} data-testid="evidence-hint">
            ทุกตัวเลขในหน้านี้เปิดดูโฆษณาจริงได้ — กดที่ตัวเลขในตารางสรุป หรือในตารางครีเอทีฟ
            แล้วเลือกช่วงที่ต้องการ
          </p>
        )}
      </Panel>

      {/* ---------------------------------------------- contributing data */}

      <Panel padded className={styles.section}>
        <PanelHead
          title="ข้อมูลที่ใช้ในแต่ละช่วง"
          meta={`ช่วงนี้ ${currentContext.length} รอบ · ช่วงก่อน ${previousContext.length} รอบ`}
        />
        <div className={styles.contexts}>
          {([["current", currentContext], ["previous", previousContext]] as const).map(
            ([period, rows]) => (
              <div key={period} className={styles.contextGroup} data-testid={`context-${period}`}>
                <h3 className={styles.contextTitle}>
                  {period === "current" ? "ช่วงล่าสุด" : "ช่วงก่อนหน้า"}
                </h3>
                {rows.length === 0 ? (
                  // The distinction the whole screen depends on.
                  <p className={styles.caveat}>
                    ไม่มีรอบเก็บในช่วงนี้ — “ไม่มีข้อมูล” ไม่เท่ากับ “ไม่มีโฆษณา”
                  </p>
                ) : (
                  <ul className={styles.contextList}>
                    {rows.map((row) => (
                      <li key={row.collection_run_id}>
                        <Link href={`/datasets/${row.dataset_id}`}>{row.dataset_name}</Link>
                        <span className={styles.contextMeta}>
                          {thaiDateTime(row.collected_at)} · {row.scope_query ?? "—"} ·{" "}
                          {row.scope_country ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
        </div>
      </Panel>
    </>
  );
}

/**
 * The selected slice: one metric or one creative value, in one period.
 *
 * An event metric reads its window; a state metric reads the reconstruction at
 * that period's end. The branch that picks the heading is the branch that picks
 * the query, so a heading can never describe rows it did not select.
 */
async function resolveSelection(input: {
  scope: PageScope;
  pageId: string | null;
  query: Search;
  periods: ReturnType<typeof trendPeriods>;
}) {
  const { scope, pageId, query, periods } = input;
  const period = one(query.period) === "previous" ? "previous" : one(query.period) === "current" ? "current" : null;
  if (!period) return null;
  const window = period === "current" ? periods.current : periods.previous;
  const periodLabel = period === "current" ? "ช่วงล่าสุด" : "ช่วงก่อนหน้า";

  const metric = trendMetric(one(query.metric));
  const dim = one(query.dim) ?? null;
  const value = one(query.value) ?? null;

  if (dim && value) {
    const { rows, total } = await getTrendEvidence(scope, {
      pageId,
      // A creative value is a state: it is read from the reconstruction at the
      // end of the period being asked about.
      reference: window.to,
      format: dim === "format" ? value : null,
      cta: dim === "cta" ? value : null,
      platform: dim === "platform" ? value : null,
      limit: EVIDENCE_SIZE,
    });
    return {
      period,
      heading: `หลักฐาน ${periodLabel}: ${value}`,
      source: `สถานะ ณ ${thaiDate(window.to)} — จากการสังเกตล่าสุดที่มีอยู่ตอนนั้น`,
      total, rows: await withPreviews(rows),
    };
  }

  if (!metric) return null;
  const row = metricRow(metric);

  if (row.kind === "event") {
    const { rows, total } = await getTrendEvidence(scope, {
      pageId, event: metric as "first_seen" | "started",
      from: window.from, to: window.to, limit: EVIDENCE_SIZE,
    });
    return {
      period,
      heading: `หลักฐาน ${periodLabel}: ${row.label}`,
      source: `${row.helper} · ${thaiDate(window.from)} — ${thaiDate(window.to)}`,
      total, rows: await withPreviews(rows),
    };
  }

  const { rows, total } = await getTrendEvidence(scope, {
    pageId, reference: window.to, signal: metric, limit: EVIDENCE_SIZE,
  });
  return {
    period,
    heading: `หลักฐาน ${periodLabel}: ${row.label}`,
    source: `${row.helper} · สถานะ ณ ${thaiDate(window.to)}`,
    total, rows: await withPreviews(rows),
  };
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

/** Scope first: a trend with no stated scope is a claim about nothing. */
async function Chooser() {
  const [categories, datasets] = await Promise.all([listCategories(), listDatasets()]);
  return (
    <>
      <PageHeader
        eyebrow="Trends"
        title="แนวโน้ม"
        description="เลือกขอบเขตข้อมูลก่อน — แนวโน้มคือความต่างระหว่างสองช่วงของข้อมูลที่เราเก็บมา ไม่ใช่การพยากรณ์"
      />
      <TrendChooser
        categories={categories.map((row) => ({ value: `category:${row.id}`, label: `หมวดหมู่: ${row.name}` }))}
        datasets={datasets.map((row) => ({
          value: `dataset:${row.dataset_id}`, label: `Dataset: ${row.dataset_name}`,
        }))}
      />
    </>
  );
}

async function nameOfScope(scope: PageScope): Promise<string | null> {
  if (scope.kind === "all") return null;
  if (scope.kind === "dataset") {
    const datasets = await listDatasets();
    return datasets.find((row) => row.dataset_id === scope.id)?.dataset_name ?? null;
  }
  const categories = await listCategories();
  return categories.find((row) => row.id === scope.id)?.name ?? null;
}
