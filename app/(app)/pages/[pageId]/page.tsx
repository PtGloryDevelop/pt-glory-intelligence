import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import {
  getPageActivity, getPageCreativeMix, getPageDetail, getPageLikeHistory,
} from "@/lib/read/pages";
import { listCategories, listDatasets } from "@/lib/read/queries";
import {
  parseScope, recentDays, scopeBasis, scopeLabel, scopeToParam, type PageScope,
} from "@/lib/pages/scope";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { Panel, PanelHead } from "@/components/Surface";
import { DistributionBars } from "@/components/DistributionBars";
import { ActivityChart } from "@/components/ActivityChart";
import { StatusBadge } from "@/components/StatusBadge";
import { WatchButton } from "@/components/WatchButton";
import { MapPageControl } from "@/components/brand/MapPageControl";
import { listWatchItems } from "@/lib/read/watchlist";
import { DEFAULT_PAGE_SIGNALS } from "@/lib/watchlist/contract";
import { getPageBrand } from "@/lib/read/brands";
import { BRAND_ON_PAGE_LABEL } from "@/lib/brands/contract";
import { satisfies } from "@/lib/auth/role-model";
import { PageEvidence } from "./evidence";
import { PageTimeline } from "./timeline";
import styles from "./page-detail.module.css";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function PageDetailPage({ params, searchParams }: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<Search>;
}) {
  const { pageId } = await params;
  const actor = await requireActorOrRedirect();
  const query = await searchParams;

  const scope = parseScope(one(query.scope));
  // A page's numbers only mean something inside a scope, so an address without
  // one is not a page — it is an unanswerable question.
  if (!scope) notFound();

  const days = recentDays(one(query.recentDays));
  const bucket = one(query.activity) === "day" ? "day" : "week";
  const view = one(query.view) === "timeline" ? "timeline" : "overview";

  const detail = await getPageDetail(scope, pageId, days);
  // No row means this page is not in this scope. The scope is not widened to
  // find something to show: that would answer a different question.
  if (!detail) notFound();

  const [mix, activity, likes, scopeName, watches, pageBrand] = await Promise.all([
    view === "overview" ? getPageCreativeMix(scope, pageId) : Promise.resolve([]),
    view === "overview" ? getPageActivity(scope, pageId, bucket) : Promise.resolve([]),
    view === "overview" ? getPageLikeHistory(scope, pageId) : Promise.resolve([]),
    nameOfScope(scope),
    listWatchItems(),
    // PT Glory's own grouping, not a Meta field. It is shown as metadata beside
    // the page, and it never replaces the page's identity.
    getPageBrand(pageId),
  ]);

  // Already watching this exact page in this exact scope? Then the control is a
  // link to that watch, not a second copy of it.
  const existingWatch = watches.find((row) =>
    row.target_type === "page" && row.target_page_id === pageId
    && row.scope_kind === scope.kind
    && (scope.kind === "all"
        || (scope.kind === "dataset" && row.scope_dataset_id === scope.id)
        || (scope.kind === "category" && row.scope_category_id === scope.id)))?.id ?? null;

  const scopeParam = scopeToParam(scope);
  // Drilling into a number is a navigation, not a hidden panel state: the URL
  // carries which slice is being looked at, so it can be shared or reloaded.
  const evidence = (extra: Record<string, string>) => {
    const next = new URLSearchParams({ scope: scopeParam, recentDays: String(days), ...extra });
    return `/pages/${pageId}?${next.toString()}#evidence`;
  };

  const dimension = (name: string) => mix.filter((row) => row.dimension === name);
  const observed = mix[0]?.observed ?? detail.observed_ads;
  const coveredOf = (name: string) => dimension(name)[0]?.covered ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Page Intelligence"
        title={detail.page_name ?? detail.page_id}
        back={{ href: `/pages?scope=${scopeParam}`, label: "เพจทั้งหมด" }}
        description="ข้อมูลระดับเพจ · ยังไม่ได้จับคู่เข้าเป็นแบรนด์"
        actions={
          <span className={styles.headerActions}>
            {/* Both carry the scope: a comparison and a watch must be inside the
                same data the reader is already looking at. */}
            <Link href={`/compare?scope=${scopeParam}&a=${pageId}`} data-testid="compare-with">
              เปรียบเทียบกับ…
            </Link>
            <WatchButton
              targetType="page" pageId={pageId} scope={scopeParam}
              signals={DEFAULT_PAGE_SIGNALS} existingId={existingWatch}
            />
            <MapPageControl
              pageId={pageId}
              currentBrand={pageBrand ? { id: pageBrand.brand_id, name: pageBrand.brand_name } : null}
              canEdit={satisfies(actor.role, "analyst")}
            />
          </span>
        }
      />

      <ContextBar
        items={[
          { label: "ขอบเขต", value: scopeLabel(scope, scopeName), testId: "scope-label" },
          { label: "Page ID", value: detail.page_id, testId: "page-identity" },
          {
            // Labelled so it cannot be read as something Meta reported. The page
            // keeps its own name and its own numbers either way.
            label: BRAND_ON_PAGE_LABEL,
            value: pageBrand ? pageBrand.brand_name : "ยังไม่จับคู่",
            testId: "page-brand",
          },
          {
            label: "หมวดเพจ",
            value: detail.page_categories?.length ? detail.page_categories.join(" · ") : "—",
          },
          {
            // Observation-level page data, from the newest observation in scope.
            // Never summed across pages, never treated as ad performance.
            label: "ผู้ติดตามเพจ (ล่าสุดในขอบเขต)",
            value: detail.page_like_count === null
              ? "ไม่ทราบ"
              : detail.page_like_count.toLocaleString("th-TH"),
            testId: "page-likes",
          },
          { label: "เริ่มพบ", value: thaiDate(detail.first_observed_at) },
          { label: "สังเกตล่าสุด", value: thaiDate(detail.last_observed_at) },
          { label: "รอบเก็บในขอบเขต", value: String(detail.runs_in_scope) },
        ]}
      />

      <p className={styles.basis} data-testid="scope-basis">{scopeBasis(scope)}</p>

      {/*
        * Two views of one page, not two products. Overview answers "what is this
        * page doing"; Timeline answers "what changed, and when did we see it".
        */}
      <nav className={styles.tabs} aria-label="มุมมอง" data-testid="page-tabs">
        <Link
          href={`/pages/${pageId}?scope=${scopeParam}`}
          className={view === "overview" ? styles.tabOn : styles.tab}
          aria-current={view === "overview" ? "page" : undefined}
          data-testid="tab-overview"
        >
          ภาพรวม
        </Link>
        <Link
          href={`/pages/${pageId}?scope=${scopeParam}&view=timeline`}
          className={view === "timeline" ? styles.tabOn : styles.tab}
          aria-current={view === "timeline" ? "page" : undefined}
          data-testid="tab-timeline"
        >
          ไทม์ไลน์
        </Link>
      </nav>

      {view === "timeline" ? (
        <PageTimeline
          scope={scope}
          pageId={pageId}
          pageName={detail.page_name ?? detail.page_id}
          datasetId={scope.kind === "dataset" ? scope.id : null}
          query={Object.fromEntries(
            Object.entries(query).map(([key, value]) => [key, one(value)]),
          )}
        />
      ) : (
      <>
      <KPIRow>
        <KPIStat
          label="Ads ที่พบ" value={detail.observed_ads}
          helper="โฆษณาที่ไม่ซ้ำกันในขอบเขตนี้" testId="kpi-observed"
        />
        <KPIStat
          label={`พบใหม่ใน ${days} วัน`} value={detail.recently_found}
          helper="นับจากวันที่ PT Glory เห็นครั้งแรก" testId="kpi-recent"
        />
        <KPIStat
          label={`เริ่มแสดงใน ${days} วัน`} value={detail.started_recently}
          helper="นับจากวันที่ Meta ระบุว่าเริ่มแสดง — คนละค่ากับพบใหม่" testId="kpi-started"
        />
        <KPIStat
          label="Evergreen" value={detail.evergreen_ads}
          helper="ยังแสดงอยู่ และอายุถึงเกณฑ์ที่ตั้งไว้" testId="kpi-evergreen"
        />
        <KPIStat
          label="ใช้ซ้ำ" value={detail.reused_ads}
          helper={`โฆษณาที่ collation > 1 · สูงสุด ${detail.max_collation ?? 0}`}
          testId="kpi-reused"
        />
      </KPIRow>

      <Panel padded className={styles.section}>
        <h2 className={styles.sectionTitle}>สถานะโฆษณาในขอบเขตนี้</h2>
        <div className={styles.states} data-testid="page-states">
          <StatusBadge isActive={true} count={detail.active_ads} />
          <StatusBadge isActive={false} count={detail.inactive_ads} />
          <StatusBadge isActive={null} count={detail.unknown_ads} />
          <span className={styles.stateNote}>
            จากทั้งหมด {detail.observed_ads.toLocaleString("th-TH")} รายการ ·
            “ไม่ทราบ” คือรอบเก็บอ่านสถานะไม่ได้ ไม่ใช่หยุดแสดง
          </span>
        </div>
        <p className={styles.range}>
          เริ่มแสดงเก่าสุด {thaiDate(detail.oldest_start_date)} ·
          ใหม่สุด {thaiDate(detail.newest_start_date)}
        </p>
      </Panel>

      <Panel padded className={styles.section}>
        <PanelHead
          title="กิจกรรมของเพจ"
          meta={
            <Link href={`/pages/${pageId}?scope=${scopeParam}&activity=${bucket === "week" ? "day" : "week"}`}>
              ดูราย{bucket === "week" ? "วัน" : "สัปดาห์"}
            </Link>
          }
        />
        <ActivityChart points={activity} bucket={bucket} />
      </Panel>

      <div className={styles.mix}>
        <Panel padded>
          <DistributionBars
            testId="mix-format" title="รูปแบบครีเอทีฟ"
            items={dimension("display_format").map((row) => ({ value: row.value, n: row.n }))}
            covered={coveredOf("display_format")} observed={observed} exclusive
            evidenceHref={(value) => evidence({ format: value })}
          />
          <DistributionBars
            testId="mix-cta" title="ปุ่ม CTA"
            items={dimension("cta_type").map((row) => ({ value: row.value, n: row.n }))}
            covered={coveredOf("cta_type")} observed={observed} exclusive
            evidenceHref={(value) => evidence({ cta: value })}
          />
        </Panel>
        <Panel padded>
          <DistributionBars
            testId="mix-platform" title="แพลตฟอร์ม"
            items={dimension("publisher_platform").map((row) => ({ value: row.value, n: row.n }))}
            covered={coveredOf("publisher_platform")} observed={observed} exclusive={false}
            evidenceHref={(value) => evidence({ platform: value })}
          />
          <DistributionBars
            testId="mix-category" title="หมวดเพจ"
            items={dimension("page_category").map((row) => ({ value: row.value, n: row.n }))}
            covered={coveredOf("page_category")} observed={observed} exclusive={false}
          />
        </Panel>
      </div>

      {likes.length > 1 ? (
        <Panel padded className={styles.section}>
          <PanelHead title="ผู้ติดตามเพจตามรอบเก็บ" meta={`${likes.length} รอบ`} />
          {/* Observation-level page data over time. Never an ad metric, and
              never added to another page's number. */}
          <ul className={styles.likes} data-testid="page-like-history">
            {likes.map((row) => (
              <li key={row.collection_run_id}>
                <span className={styles.likeDate}>{thaiDateTime(row.observed_at)}</span>
                <span data-numeral>
                  {row.page_like_count === null ? "ไม่ทราบ" : row.page_like_count.toLocaleString("th-TH")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <PageEvidence
        pageId={pageId}
        scope={scopeParam}
        recentDays={days}
        datasetId={scope.kind === "dataset" ? scope.id : null}
        counts={{
          recent: detail.recently_found,
          started_recently: detail.started_recently,
          evergreen: detail.evergreen_ads,
          reused: detail.reused_ads,
          active: detail.active_ads,
          inactive: detail.inactive_ads,
          unknown: detail.unknown_ads,
        }}
      />
      </>
      )}
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
