import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { getCompareMix, getCompareSummary, getCompareTimeline } from "@/lib/read/compare";
import { getPageAds, getPageList, getPageTimelineEvidence } from "@/lib/read/pages";
import { listCategories, listDatasets } from "@/lib/read/queries";
import { signArchivedPreviews } from "@/lib/media/presentation";
import {
  COMPARE_ROWS, REFUSAL_MESSAGE, compareClock, compareMetric, delta,
  isComparablePageId, validateCompare, type CompareClock, type Side,
} from "@/lib/compare/contract";
import {
  RECENT_DAYS, parseScope, pageSignal, recentDays, scopeBasis, scopeLabel,
  scopeToParam, type PageScope,
} from "@/lib/pages/scope";
import {
  GRAINS, GRAIN_LABEL, METRIC_LABEL, METRIC_SOURCE, RANGES, RANGE_LABEL,
  bucketEnd, rangeWindow, timelineGrain, timelineRange,
} from "@/lib/pages/timeline";
import { thaiDate } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { StatusBadge } from "@/components/StatusBadge";
import { CompareBars } from "@/components/CompareBars";
import { CompareChart } from "@/components/CompareChart";
import { EvidenceGrid } from "@/components/EvidenceGrid";
import { EmptyState } from "@/components/states/EmptyState";
import { CompareChooser } from "./chooser";
import styles from "./compare.module.css";

export const dynamic = "force-dynamic";

const EVIDENCE_SIZE = 24;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Page A vs Page B, inside one scope.
 *
 * Compare invents nothing. Every number here is produced by the same function
 * that produces it on the page's own screen, and every one of them opens the
 * same ads. What this surface adds is alignment and subtraction — which is why
 * the wording work matters more than the arithmetic: a delta is a difference in
 * what we observed, never a verdict about who is doing better.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireActorOrRedirect();
  const query = await searchParams;

  const scope = parseScope(one(query.scope));
  const rawA = one(query.a);
  const rawB = one(query.b);
  const pageA = isComparablePageId(rawA) ? rawA : null;
  const pageB = isComparablePageId(rawB) ? rawB : null;

  // Nothing to compare yet, or nothing valid: ask, rather than guess.
  if (!scope || !pageA || !pageB) {
    return <Chooser scope={scope} pageA={pageA} pageB={pageB} />;
  }

  const days = recentDays(one(query.recentDays));
  const clock: CompareClock = compareClock(one(query.clock));
  const range = timelineRange(one(query.range));
  const grain = timelineGrain(one(query.grain), range);
  const window = rangeWindow(range);

  const summary = await getCompareSummary(scope, pageA, pageB, days);
  const refusal = validateCompare({
    pageA, pageB,
    aInScope: summary.a?.in_scope ?? false,
    bInScope: summary.b?.in_scope ?? false,
  });

  if (refusal) {
    return (
      <>
        <PageHeader eyebrow="Compare" title="เปรียบเทียบเพจ" back={{ href: "/compare", label: "เริ่มใหม่" }} />
        <EmptyState
          testId={`compare-refused-${refusal.kind}`}
          title="ยังเปรียบเทียบไม่ได้"
          body={REFUSAL_MESSAGE[refusal.kind]}
          action={<Link href={`/compare?scope=${scopeToParam(scope)}`}>เลือกเพจใหม่</Link>}
        />
      </>
    );
  }

  const a = summary.a!;
  const b = summary.b!;
  const scopeParam = scopeToParam(scope);

  const [mix, timeline, scopeName] = await Promise.all([
    getCompareMix(scope, pageA, pageB),
    getCompareTimeline(scope, pageA, pageB, {
      metric: clock, bucket: grain, from: window.from, to: window.to,
    }),
    nameOfScope(scope),
  ]);

  const link = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams({ scope: scopeParam, a: pageA, b: pageB });
    if (days !== 30) next.set("recentDays", String(days));
    if (clock !== "started") next.set("clock", clock);
    if (range !== "all") next.set("range", range);
    if (grain !== timelineGrain(undefined, range)) next.set("grain", grain);
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/compare?${next.toString()}`;
  };

  const swapHref = (() => {
    const next = new URLSearchParams({ scope: scopeParam, a: pageB, b: pageA });
    if (days !== 30) next.set("recentDays", String(days));
    if (clock !== "started") next.set("clock", clock);
    if (range !== "all") next.set("range", range);
    if (grain !== timelineGrain(undefined, range)) next.set("grain", grain);
    return `/compare?${next.toString()}`;
  })();

  const names = { a: a.page_name ?? a.page_id, b: b.page_name ?? b.page_id };
  const selection = await resolveSelection({ scope, pageA, pageB, query, days, grain, clock });

  const dimension = (name: string, side: Side) =>
    mix.filter((row) => row.dimension === name && row.side === side);
  const coverageOfDimension = (name: string) => ({
    a: {
      covered: dimension(name, "a")[0]?.covered ?? 0,
      observed: dimension(name, "a")[0]?.observed ?? a.observed_ads,
    },
    b: {
      covered: dimension(name, "b")[0]?.covered ?? 0,
      observed: dimension(name, "b")[0]?.observed ?? b.observed_ads,
    },
  });
  const items = (name: string) => {
    const values = [...new Set(mix.filter((row) => row.dimension === name).map((row) => row.value))];
    return values.map((value) => ({
      value,
      a: dimension(name, "a").find((row) => row.value === value)?.n ?? 0,
      b: dimension(name, "b").find((row) => row.value === value)?.n ?? 0,
    }));
  };

  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title="เปรียบเทียบเพจ"
        description="Page ต่อ Page ในขอบเขตเดียวกัน · ยังไม่มีการจับคู่เป็นแบรนด์"
        actions={<Link href="/compare">เลือกเพจใหม่</Link>}
      />

      {/* Both sides, the one scope they share, and the swap. */}
      <section className={styles.identity} data-testid="compare-identity">
        <div className={styles.sideCard} data-side="a">
          <span className={styles.sideTag}>Page A</span>
          <Link href={`/pages/${a.page_id}?scope=${scopeParam}`} className={styles.sideName}>
            {names.a}
          </Link>
          <span className={styles.sideMeta}>{a.page_id}</span>
        </div>
        <div className={styles.versus}>
          <span aria-hidden>VS</span>
          <Link href={swapHref} className={styles.swap} data-testid="compare-swap"
            aria-label={`สลับด้าน: ให้ ${names.b} เป็น Page A และ ${names.a} เป็น Page B`}>
            สลับ A ↔ B
          </Link>
        </div>
        <div className={styles.sideCard} data-side="b">
          <span className={styles.sideTag}>Page B</span>
          <Link href={`/pages/${b.page_id}?scope=${scopeParam}`} className={styles.sideName}>
            {names.b}
          </Link>
          <span className={styles.sideMeta}>{b.page_id}</span>
        </div>
      </section>

      <ContextBar
        items={[
          { label: "ขอบเขต", value: scopeLabel(scope, scopeName), testId: "scope-label" },
          { label: "หน้าต่าง “พบใหม่”", value: `${days} วัน` },
          { label: "A เริ่มพบ", value: thaiDate(a.first_observed_at) },
          { label: "B เริ่มพบ", value: thaiDate(b.first_observed_at) },
          { label: "A สังเกตล่าสุด", value: thaiDate(a.last_observed_at) },
          { label: "B สังเกตล่าสุด", value: thaiDate(b.last_observed_at) },
        ]}
      />

      {/* The scope caveat, once, in front of every number below it. */}
      <p className={styles.basis} data-testid="scope-basis">{scopeBasis(scope)}</p>

      <form className={styles.controls} data-testid="compare-controls">
        <span className={styles.controlLabel}>หน้าต่าง “พบใหม่”</span>
        <span className={styles.controlRow}>
          {RECENT_DAYS.map((option) => (
            <Link
              key={option} href={link({ recentDays: String(option) })}
              className={option === days ? styles.controlOn : styles.control}
              data-testid={`recent-${option}`}
            >
              {option} วัน
            </Link>
          ))}
        </span>
      </form>

      {/* ------------------------------------------------ summary matrix */}

      <Panel className={styles.section}>
        <PanelHead title="สรุปเปรียบเทียบ" meta="ตัวเลขทั้งหมดคือสิ่งที่ PT Glory เก็บมาได้" />
        <TableWrap>
          <table data-testid="compare-matrix">
            <thead>
              <tr>
                <th>ค่า</th>
                <th>A · {names.a}</th>
                <th>B · {names.b}</th>
                <th>ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => {
                const left = valueOf(a, row.metric);
                const right = valueOf(b, row.metric);
                const difference = delta(left, right);
                return (
                  <tr key={row.metric} data-testid={`row-${row.metric}`}>
                    <th scope="row" className={styles.rowLabel}>
                      {row.label}
                      <span className={styles.rowHelper}>{row.helper}</span>
                    </th>
                    {(["a", "b"] as const).map((side) => {
                      const n = side === "a" ? left : right;
                      return (
                        <td key={side}>
                          {row.signal && n > 0 ? (
                            <Link
                              href={link({ metric: row.metric, side, bucket: null, dim: null, value: null })}
                              data-testid={`cell-${row.metric}-${side}`}
                              data-numeral
                            >
                              {n}
                            </Link>
                          ) : (
                            <span data-testid={`cell-${row.metric}-${side}`} data-numeral>{n}</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Arithmetic only. Which side has more, and by how many. */}
                    <td className={styles.delta} data-testid={`delta-${row.metric}`}>
                      {difference.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>

        <div className={styles.states} data-testid="compare-states">
          {(["a", "b"] as const).map((side) => {
            const row = side === "a" ? a : b;
            return (
              <div key={side} className={styles.stateGroup}>
                <span className={styles.sideTag}>{side.toUpperCase()}</span>
                <StatusBadge isActive={true} count={row.active_ads} />
                <StatusBadge isActive={false} count={row.inactive_ads} />
                <StatusBadge isActive={null} count={row.unknown_ads} />
              </div>
            );
          })}
          <span className={styles.stateNote}>
            “ไม่ทราบ” คือรอบเก็บอ่านสถานะไม่ได้ ไม่ใช่หยุดแสดง
          </span>
        </div>

        {/* Page-level context, never a competitive metric. */}
        <p className={styles.likes} data-testid="compare-likes">
          ผู้ติดตามเพจ (ค่าล่าสุดในขอบเขตนี้) · A{" "}
          {a.page_like_count === null ? "ไม่ทราบ" : a.page_like_count.toLocaleString("th-TH")} · B{" "}
          {b.page_like_count === null ? "ไม่ทราบ" : b.page_like_count.toLocaleString("th-TH")}
          {" — เป็นข้อมูลของเพจ ไม่ใช่ผลของโฆษณา และไม่นำมารวมกัน"}
        </p>
      </Panel>

      {/* ----------------------------------------------------- timeline */}

      <Panel padded className={styles.section}>
        <PanelHead
          title="ตามช่วงเวลา"
          meta={
            <span className={styles.controlRow}>
              {(["started", "first_seen"] as const).map((option) => (
                <Link
                  key={option} href={link({ clock: option, bucket: null, metric: null })}
                  className={option === clock ? styles.controlOn : styles.control}
                  data-testid={`clock-${option}`}
                >
                  {METRIC_LABEL[option]}
                </Link>
              ))}
              {RANGES.map((option) => (
                <Link
                  key={option}
                  href={link({ range: option === "all" ? null : option, grain: null, bucket: null })}
                  className={option === range ? styles.controlOn : styles.control}
                  data-testid={`range-${option}`}
                >
                  {RANGE_LABEL[option]}
                </Link>
              ))}
              {GRAINS.map((option) => (
                <Link
                  key={option} href={link({ grain: option, bucket: null })}
                  className={option === grain ? styles.controlOn : styles.control}
                  data-testid={`grain-${option}`}
                >
                  {GRAIN_LABEL[option]}
                </Link>
              ))}
            </span>
          }
        />
        {/* One clock for both sides, chosen once. */}
        <CompareChart
          points={timeline}
          grain={grain}
          clockLabel={METRIC_LABEL[clock]}
          clockSource={METRIC_SOURCE[clock]}
          names={names}
          selected={selection?.kind === "bucket" ? { bucket: selection.bucket, side: selection.side } : null}
          href={(bucket, side) => link({ bucket, side, metric: null, dim: null, value: null })}
        />
      </Panel>

      {/* -------------------------------------------------- creative mix */}

      <div className={styles.mix}>
        <Panel padded>
          <CompareBars
            testId="mix-format" title="รูปแบบครีเอทีฟ" exclusive
            items={items("display_format")}
            coverage={coverageOfDimension("display_format")}
            evidenceHref={(value, side) => link({ dim: "format", value, side, metric: null, bucket: null })}
          />
          <CompareBars
            testId="mix-cta" title="ปุ่ม CTA" exclusive
            items={items("cta_type")}
            coverage={coverageOfDimension("cta_type")}
            evidenceHref={(value, side) => link({ dim: "cta", value, side, metric: null, bucket: null })}
          />
        </Panel>
        <Panel padded>
          <CompareBars
            testId="mix-platform" title="แพลตฟอร์ม" exclusive={false}
            items={items("publisher_platform")}
            coverage={coverageOfDimension("publisher_platform")}
            evidenceHref={(value, side) => link({ dim: "platform", value, side, metric: null, bucket: null })}
          />
          <CompareBars
            testId="mix-page-category" title="หมวดเพจ (จาก Meta)" exclusive={false}
            items={items("page_category")}
            coverage={coverageOfDimension("page_category")}
          />
        </Panel>
      </div>

      {/* --------------------------------------------------- evidence */}

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
                body="ตัวเลขของกลุ่มนี้เป็นศูนย์สำหรับฝั่งที่เลือก"
              />
            ) : (
              <EvidenceGrid
                rows={selection.rows}
                datasetId={scope.kind === "dataset" ? scope.id : null}
                testId={`evidence-${selection.side}`}
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
            ทุกตัวเลขในหน้านี้เปิดดูโฆษณาจริงได้ — กดที่ตัวเลขในตารางสรุป ที่แถบครีเอทีฟ
            หรือที่ช่วงเวลาในกราฟ แล้วเลือกฝั่ง A หรือ B
          </p>
        )}
      </Panel>
    </>
  );
}

/** One row's value, read from the frozen summary. No arithmetic of its own. */
function valueOf(row: { [key: string]: unknown }, metric: string): number {
  const column = {
    observed: "observed_ads", recent: "recently_found",
    started_recently: "started_recently", evergreen: "evergreen_ads",
    reused: "reused_ads", active: "active_ads", inactive: "inactive_ads",
    unknown: "unknown_ads",
  }[metric]!;
  return Number(row[column] ?? 0);
}

/**
 * The selected slice: one side, one definition, one query.
 *
 * The ads come from the frozen page readers — `page_ads` for a signal or a
 * creative dimension, `page_timeline_evidence` for a bucket — so a compared
 * number and the rows behind it cannot drift apart.
 */
async function resolveSelection(input: {
  scope: PageScope;
  pageA: string;
  pageB: string;
  query: Search;
  days: number;
  grain: "day" | "week";
  clock: CompareClock;
}) {
  const { scope, pageA, pageB, query, days, grain, clock } = input;
  const side = one(query.side) === "b" ? "b" : one(query.side) === "a" ? "a" : null;
  if (!side) return null;
  const pageId = side === "a" ? pageA : pageB;

  const metric = compareMetric(one(query.metric));
  const bucket = one(query.bucket) ?? null;
  const dim = one(query.dim) ?? null;
  const value = one(query.value) ?? null;

  if (bucket) {
    const { rows, total } = await getPageTimelineEvidence(scope, pageId, {
      metric: clock, from: bucket, to: bucketEnd(bucket, grain), limit: EVIDENCE_SIZE,
    });
    return {
      kind: "bucket" as const, side, bucket,
      heading: `หลักฐาน ${side.toUpperCase()}: ${METRIC_LABEL[clock]} · ${thaiDate(bucket)}`,
      source: METRIC_SOURCE[clock],
      total, rows: await withPreviews(rows),
    };
  }

  if (dim && value) {
    const { rows, total } = await getPageAds(scope, pageId, {
      format: dim === "format" ? value : null,
      cta: dim === "cta" ? value : null,
      platform: dim === "platform" ? value : null,
      recentDays: days, limit: EVIDENCE_SIZE,
    });
    return {
      kind: "dimension" as const, side,
      heading: `หลักฐาน ${side.toUpperCase()}: ${value}`,
      source: "โฆษณาที่มีค่านี้ในการสังเกตล่าสุดของขอบเขตนี้",
      total, rows: await withPreviews(rows),
    };
  }

  if (metric) {
    const row = COMPARE_ROWS.find((entry) => entry.metric === metric)!;
    const { rows, total } = await getPageAds(scope, pageId, {
      signal: pageSignal(row.signal), recentDays: days, limit: EVIDENCE_SIZE,
    });
    return {
      kind: "metric" as const, side,
      heading: `หลักฐาน ${side.toUpperCase()}: ${row.label}`,
      source: row.helper,
      total, rows: await withPreviews(rows),
    };
  }

  return null;
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

/**
 * The chooser: scope first, then two pages that are actually in it.
 *
 * The page list is read server-side from the chosen scope, so a page that this
 * scope has never seen is never offered — the refusal in §6 is a backstop, not
 * the normal path.
 */
async function Chooser({ scope, pageA, pageB }: {
  scope: PageScope | null; pageA: string | null; pageB: string | null;
}) {
  const [categories, datasets] = await Promise.all([listCategories(), listDatasets()]);
  const pages = scope
    ? (await getPageList(scope, { limit: 200, sort: "observed_ads" })).rows
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title="เปรียบเทียบเพจ"
        description="เลือกขอบเขตข้อมูลหนึ่งขอบเขต แล้วเลือกสองเพจในขอบเขตนั้น"
      />
      <CompareChooser
        scope={scope ? scopeToParam(scope) : ""}
        pageA={pageA ?? ""}
        pageB={pageB ?? ""}
        datasets={datasets.map((row) => ({
          value: `dataset:${row.dataset_id}`,
          label: `Dataset: ${row.dataset_name}`,
        }))}
        categories={categories.map((row) => ({
          value: `category:${row.id}`, label: `หมวดหมู่: ${row.name}`,
        }))}
        pages={pages.map((row) => ({
          id: row.page_id,
          label: `${row.page_name ?? row.page_id} · ${row.observed_ads} Ads`,
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
