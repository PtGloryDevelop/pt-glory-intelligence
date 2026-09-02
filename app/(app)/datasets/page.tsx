import Link from "next/link";
import { listDatasets } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { QualityBadge } from "@/components/QualityBadge";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const datasets = await listDatasets();

  return (
    <>
      <PageHeader
        title="ชุดข้อมูล"
        description={`${datasets.length} ชุด`}
        actions={<Link href="/import">นำเข้าข้อมูล</Link>}
      />
      {datasets.length === 0 ? (
        <EmptyState
          testId="datasets-empty"
          title="ยังไม่มีชุดข้อมูล"
          body="เริ่มจากการนำเข้าไฟล์ JSON จาก Extension"
          action={<Link href="/import">นำเข้าไฟล์แรก</Link>}
        />
      ) : (
        // Ten columns do not fit a phone; the table scrolls inside itself
        // rather than dragging the whole page sideways.
        <div style={{ overflowX: "auto" }}>
        <table data-testid="dataset-list">
          <thead>
            <tr>
              <th>ชุดข้อมูล</th><th>หมวดหมู่</th><th>คำค้น</th><th>ประเทศ</th>
              <th>แหล่งข้อมูล</th><th>เก็บเมื่อ</th><th>Ads</th><th>Pages</th>
              <th>สถานะรอบ</th><th>คุณภาพข้อมูล</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((dataset) => (
              <tr key={dataset.dataset_id} data-testid={`dataset-row-${dataset.dataset_id}`}>
                <td>
                  <Link href={`/datasets/${dataset.dataset_id}`}>{dataset.dataset_name}</Link>
                </td>
                <td>{dataset.category_name}</td>
                {/* A scope the run did not record stays an em dash. */}
                <td>{dataset.scope_query ?? "—"}</td>
                <td>{dataset.scope_country ?? "—"}</td>
                <td>{dataset.source_product}</td>
                <td>{new Date(dataset.collected_at).toLocaleString("th-TH")}</td>
                <td>{dataset.ads_in_dataset}</td>
                <td>{dataset.pages_in_dataset}</td>
                <td>{dataset.run_status}</td>
                <td><QualityBadge tier={dataset.quality_tier} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
