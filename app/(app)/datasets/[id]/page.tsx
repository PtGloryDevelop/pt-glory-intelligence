import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { thaiDateTime } from "@/lib/format/date";
import { getDatasetContext, getDatasetQuality } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { QualityBadge } from "@/components/QualityBadge";
import { QualityStrip } from "@/components/QualityStrip";
import { worstTier } from "@/lib/domain/quality-tier";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { PartialBanner } from "@/components/PartialBanner";
import { Explorer } from "./explorer";
import styles from "./dataset.module.css";

export const dynamic = "force-dynamic";

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  await requireActorOrRedirect();

  const context = await getDatasetContext(id);
  if (!context) notFound();
  const quality = await getDatasetQuality(id);

  return (
    <>
      <div className={styles.operational}>
      <PageHeader
        title={context.dataset_name}
        back={{ href: "/datasets", label: "ชุดข้อมูลทั้งหมด" }}
      />

      {/*
        * The context bar answers "which dataset am I looking at?" and nothing
        * else. It used to also carry Ads, Pages, quality and the run status,
        * which the KPI row below then repeated — the same five facts stated
        * twice, one on top of the other.
        *
        * Every value still comes from the run this dataset was built from, not
        * from the master ads table, so it stays fixed when a newer run lands.
        */}
      <ContextBar
        items={[
          { label: "หมวดหมู่", value: context.category_name },
          { label: "คำค้น", value: context.scope_query ?? "—" },
          { label: "ประเทศ", value: context.scope_country ?? "—" },
          { label: "วิธีเก็บ", value: context.collection_method, testId: "context-method" },
          { label: "เก็บเมื่อ", value: thaiDateTime(context.collected_at) },
          { label: "สถานะรอบ", value: context.run_status, testId: "context-status" },
          // Run provenance sits with run identity rather than in a card of its
          // own: it describes the collection, not the dataset. "Pages พบในรอบเก็บ"
          // counts every page the collector saw — including pages that appear
          // only on quarantined rows — so on a partial run it is legitimately
          // larger than the dataset's own Pages above.
          {
            label: "Pages พบในรอบเก็บ",
            value: String(context.computed_unique_pages),
            testId: "context-run-pages",
          },
          {
            label: "กันไว้ตรวจ",
            value: String(context.quarantine_count),
            testId: "context-quarantine",
          },
        ]}
      />

      {/* Both numbers come from the run itself; nothing here is counted in the
          browser, and the banner is amber because a partial run is readable. */}
      {context.run_status === "partial" ? (
        <PartialBanner
          importedAds={Number(context.ads_in_dataset)}
          quarantined={Number(context.quarantine_count)}
        />
      ) : null}

      {/*
        * The KPI row answers "what is inside this dataset?" — three real facts
        * rather than four cards padded out with values the bar above already
        * shows. The testids ride on the values so an assertion reads the number
        * and not the label wrapped around it.
        */}
      <KPIRow>
        <KPIStat
          label="Ads"
          value={<span data-testid="context-ads">{context.ads_in_dataset}</span>}
          helper="ในชุดข้อมูลนี้"
        />
        {/* The dataset's own page count. The run's wider count is provenance and
            lives in the line below, never swapped in here. */}
        <KPIStat
          label="Pages"
          value={<span data-testid="context-pages">{context.pages_in_dataset}</span>}
          helper="ในชุดข้อมูลนี้"
        />
        <KPIStat
          label="คุณภาพข้อมูล"
          value={<QualityBadge tier={worstTier(quality)} />}
          helper="ระดับต่ำสุดของฟิลด์ที่วัดได้"
        />
      </KPIRow>


      <h2 className={styles.qualityHeading}>คุณภาพข้อมูล</h2>
      <QualityStrip
        testId="quality-strip"
        rows={quality.map((row) => ({
          field: row.field,
          presentCount: row.present_count,
          totalCount: row.total_count,
          coverage: Number(row.coverage),
          tier: row.tier,
        }))}
      />

      </div>

      {/* Coverage travels with the filters so "มีลิงก์ปลายทาง" can say how many
          ads the field was readable on, instead of implying the rest have none. */}
      <Explorer
        datasetId={id}
        coverage={quality.map((row) => ({
          field: row.field, present_count: row.present_count, total_count: row.total_count,
        }))}
      />
    </>
  );
}

