import { notFound } from "next/navigation";
import { getDatasetContext, getDatasetQuality, type QualityRow } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { QualityBadge } from "@/components/QualityBadge";
import { ErrorState } from "@/components/states/ErrorState";
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
          { label: "Pages", value: String(context.computed_unique_pages), testId: "context-pages" },
          { label: "กันไว้ตรวจ", value: String(context.quarantine_count), testId: "context-quarantine" },
          { label: "คุณภาพข้อมูล", value: <QualityBadge tier={worstTier(quality)} /> },
        ]}
      />

      {context.run_status === "partial" ? (
        <div style={{ marginBottom: "var(--gap-section)" }}>
          <ErrorState
            testId="partial-banner"
            title={`รอบนี้นำเข้าได้บางส่วน — มี ${context.quarantine_count} แถวที่กันไว้ตรวจ`}
            detail={`ตัวเลขทั้งหมดด้านล่างนับเฉพาะ ${context.ads_in_dataset} โฆษณาที่นำเข้าสำเร็จ`}
          />
        </div>
      ) : null}

      <h2>คุณภาพข้อมูล</h2>
      <table data-testid="quality-strip">
        <thead>
          <tr><th>ฟิลด์</th><th>พบ / ทั้งหมด</th><th>สัดส่วน</th><th>ระดับ</th></tr>
        </thead>
        <tbody>
          {quality.map((row) => (
            <tr key={row.field} data-testid={`quality-${row.field}`}>
              <td>{row.field}</td>
              {/* Denominator always travels with the percentage. */}
              <td>{row.present_count} / {row.total_count}</td>
              <td>{(Number(row.coverage) * 100).toFixed(1)}%</td>
              <td>
                <QualityBadge tier={row.tier} />
                {row.tier !== "normal" ? (
                  <span data-testid={`quality-warning-${row.field}`} style={{ color: "var(--muted)", fontSize: "var(--fs-meta)" }}>
                    {" "}อ้างได้เฉพาะในกลุ่มที่อ่านค่าได้ ไม่ใช่ทั้งชุดข้อมูล
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Explorer datasetId={id} />
    </>
  );
}

/**
 * The context bar's single quality chip.
 *
 * Deliberately the worst tier present, not an average: averaging coverage across
 * fields would invent a number that describes no field, and a dataset is only as
 * trustworthy as its weakest measured field.
 */
function worstTier(quality: QualityRow[]): "normal" | "partial" | "low" {
  if (quality.some((row) => row.tier === "low")) return "low";
  if (quality.some((row) => row.tier === "partial")) return "partial";
  return "normal";
}
