import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import { listDatasets } from "@/lib/read/queries";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  if (!(await getActor())) redirect("/login");
  const datasets = await listDatasets();

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      <h1>ชุดข้อมูล</h1>
      {datasets.length === 0 ? (
        <p data-testid="datasets-empty">
          ยังไม่มีชุดข้อมูล · <Link href="/import">นำเข้าไฟล์แรก</Link>
        </p>
      ) : (
        <ul data-testid="dataset-list">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              <Link href={`/datasets/${dataset.id}`}>{dataset.name}</Link>
              <span style={{ color: "var(--muted)" }}> · {new Date(dataset.created_at).toLocaleString("th-TH")}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
