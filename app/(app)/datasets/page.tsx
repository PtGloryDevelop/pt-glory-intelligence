import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { listDatasets } from "@/lib/read/queries";
import { labelProvenanceRows } from "@/lib/collect/labels";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { QualityBadge } from "@/components/QualityBadge";
import { thaiDateTime } from "@/lib/format/date";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  await requireActorOrRedirect();
  // Neutralised on the server, for every role: this is an ordinary product
  // screen, so the collector's own names stay out of the HTML and out of the
  // payload behind it.
  const datasets = labelProvenanceRows(await listDatasets());

  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="ชุดข้อมูล"
        description="แต่ละชุดผูกกับรอบเก็บของตัวเอง ตัวเลขที่เห็นคือค่าของรอบนั้น ไม่ใช่ค่าล่าสุด"
        actions={
          <Link href="/import" data-cta>นำเข้าข้อมูล</Link>
        }
      />
      {datasets.length === 0 ? (
        <EmptyState
          testId="datasets-empty"
          title="ยังไม่มีชุดข้อมูล"
          body="เริ่มจากการนำเข้าไฟล์ JSON หนึ่งไฟล์"
          action={<Link href="/import">นำเข้าไฟล์แรก</Link>}
        />
      ) : (
        <Panel>
          <PanelHead
            title="ชุดข้อมูลทั้งหมด"
            meta={`${datasets.length} ชุด`}
          />
          {/* Ten columns do not fit a phone; the table scrolls inside its own
              panel rather than dragging the whole page sideways. */}
          <TableWrap>
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
                <td>{thaiDateTime(dataset.collected_at)}</td>
                <td data-numeral>{dataset.ads_in_dataset}</td>
                <td data-numeral>{dataset.pages_in_dataset}</td>
                <td>{dataset.run_status}</td>
                <td><QualityBadge tier={dataset.quality_tier} /></td>
              </tr>
            ))}
          </tbody>
        </table>
          </TableWrap>
        </Panel>
      )}
    </>
  );
}
