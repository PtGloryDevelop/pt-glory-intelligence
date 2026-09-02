import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import { getDatasetContext, getDatasetQuality } from "@/lib/read/queries";
import { Explorer } from "./explorer";

export const dynamic = "force-dynamic";

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getActor())) redirect("/login");
  const { id } = await params;

  const context = await getDatasetContext(id);
  if (!context) notFound();
  const quality = await getDatasetQuality(id);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/datasets">← ชุดข้อมูลทั้งหมด</Link>
      <h1>{context.dataset_name}</h1>

      {/* Every number here comes from the run this dataset was built from, not
          from the master ads table, so it stays fixed when a newer run lands. */}
      <section data-testid="context-bar"
        style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid rgba(0,0,0,.1)" }}>
        <Item label="หมวดหมู่" value={context.category_name} />
        <Item label="คำค้น" value={context.scope_query ?? "—"} />
        <Item label="ประเทศ" value={context.scope_country ?? "—"} />
        <Item label="วิธีเก็บ" value={context.collection_method} testId="context-method" />
        <Item label="เก็บเมื่อ" value={new Date(context.collected_at).toLocaleString("th-TH")} />
        <Item label="สถานะรอบ" value={context.run_status} testId="context-status" />
        <Item label="Ads ในชุดนี้" value={String(context.ads_in_dataset)} testId="context-ads" />
        <Item label="Pages" value={String(context.computed_unique_pages)} testId="context-pages" />
        <Item label="กันไว้ตรวจ" value={String(context.quarantine_count)} testId="context-quarantine" />
      </section>

      {context.run_status === "partial" ? (
        <p role="status" data-testid="partial-banner">
          รอบนี้นำเข้าได้บางส่วน — มี {context.quarantine_count} แถวที่กันไว้ตรวจ
          ตัวเลขทั้งหมดด้านล่างนับเฉพาะ {context.ads_in_dataset} โฆษณาที่นำเข้าสำเร็จ
        </p>
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
                {row.tier}
                {row.tier !== "normal" ? (
                  <span data-testid={`quality-warning-${row.field}`}>
                    {" "}⚠ อ้างได้เฉพาะในกลุ่มที่อ่านค่าได้ ไม่ใช่ทั้งชุดข้อมูล
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Explorer datasetId={id} />
    </main>
  );
}

function Item({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div data-testid={testId}><strong>{value}</strong></div>
    </div>
  );
}
