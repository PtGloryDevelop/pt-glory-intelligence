import Link from "next/link";
import { listDatasets } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";

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
        <table data-testid="dataset-list">
          <thead>
            <tr><th>ชุดข้อมูล</th><th>สร้างเมื่อ</th></tr>
          </thead>
          <tbody>
            {datasets.map((dataset) => (
              <tr key={dataset.id}>
                <td><Link href={`/datasets/${dataset.id}`}>{dataset.name}</Link></td>
                <td>{new Date(dataset.created_at).toLocaleString("th-TH")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
