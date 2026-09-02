import { notFound } from "next/navigation";
import { getDatasetContext, getDatasetQuality } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { QualityBadge } from "@/components/QualityBadge";
import { QualityStrip } from "@/components/QualityStrip";
import { worstTier } from "@/lib/domain/quality-tier";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { PartialBanner } from "@/components/PartialBanner";
import { Explorer } from "./explorer";

export const dynamic = "force-dynamic";

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getDatasetContext(id);
  if (!context) notFound();
  const quality = await getDatasetQuality(id);

  return (
    <>
      <PageHeader
        title={context.dataset_name}
        back={{ href: "/datasets", label: "ชุดข้อมูลทั้งหมด" }}
      />

      {/* Every value here comes from the run this dataset was built from, not
          from the master ads table, so it stays fixed when a newer run lands. */}
      <ContextBar
        items={[
          { label: "หมวดหมู่", value: context.category_name },
          { label: "คำค้น", value: context.scope_query ?? "—" },
          { label: "ประเทศ", value: context.scope_country ?? "—" },
          { label: "วิธีเก็บ", value: context.collection_method, testId: "context-method" },
          { label: "เก็บเมื่อ", value: new Date(context.collected_at).toLocaleString("th-TH") },
          { label: "สถานะรอบ", value: context.run_status, testId: "context-status" },
          { label: "Ads", value: String(context.ads_in_dataset), testId: "context-ads" },
          { label: "Pages", value: String(context.pages_in_dataset), testId: "context-pages" },
          // Run provenance, kept beside the dataset figure rather than instead of
          // it: this counts every page the collector saw, including pages that
          // only appear on quarantined rows, so on a partial run it is larger.
          {
            label: "Pages ที่พบในรอบเก็บ",
            value: String(context.computed_unique_pages),
            testId: "context-run-pages",
          },
          { label: "กันไว้ตรวจ", value: String(context.quarantine_count), testId: "context-quarantine" },
          { label: "คุณภาพข้อมูล", value: <QualityBadge tier={worstTier(quality)} /> },
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

      <KPIRow>
        <KPIStat label="Ads" value={context.ads_in_dataset} helper="ในชุดข้อมูลนี้" />
        {/* The primary KPI describes the dataset. The run's own page count stays
            in the context bar above as provenance, never swapped in here. */}
        <KPIStat label="Pages" value={context.pages_in_dataset} helper="ในชุดข้อมูลนี้" />
        <KPIStat label="เก็บเมื่อ" value={new Date(context.collected_at).toLocaleString("th-TH")} />
        <KPIStat
          label="สถานะรอบ"
          value={context.run_status}
          helper={`กันไว้ตรวจ ${context.quarantine_count} แถว`}
          status={<QualityBadge tier={worstTier(quality)} />}
        />
      </KPIRow>

      <h2>คุณภาพข้อมูล</h2>
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

