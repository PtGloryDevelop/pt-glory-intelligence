import Link from "next/link";
import { requireActorOrRedirect, satisfies } from "@/lib/auth/roles";
import { listResearchCategories } from "@/lib/read/categories";
import { thaiDate } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { CategoryCreate, CategoryRowActions } from "./controls";
import styles from "./categories.module.css";

export const dynamic = "force-dynamic";

/**
 * The research categories.
 *
 * A PT Glory Category is our own grouping — what a dataset was imported into.
 * It is not Meta's page category, and the two are never mixed; the workspace
 * behind each row says so again where both appear on one screen.
 *
 * No averaged quality score here on purpose: a category's datasets can each be
 * fine and still not be comparable with one another, and a single number would
 * hide exactly that.
 */
export default async function CategoriesPage() {
  const actor = await requireActorOrRedirect();
  const canEdit = satisfies(actor.role, "analyst");
  const categories = await listResearchCategories();

  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="หมวดหมู่"
        description="หมวดหมู่วิจัยของ PT Glory — คนละอย่างกับหมวดเพจที่ Meta ให้มา"
      />

      {canEdit ? <CategoryCreate /> : null}

      {categories.length === 0 ? (
        <EmptyState
          testId="categories-empty"
          title="ยังไม่มีหมวดหมู่"
          body={canEdit ? "เพิ่มหมวดหมู่ด้านบน แล้วเลือกหมวดนี้ตอนนำเข้าข้อมูล" : "ยังไม่มีหมวดหมู่ ให้ Analyst หรือ Admin เพิ่มก่อน"}
          action={<Link href="/import">ไปที่นำเข้าข้อมูล</Link>}
        />
      ) : (
        <Panel>
          <PanelHead title="หมวดหมู่ทั้งหมด" meta={`${categories.length} หมวด`} />
          <TableWrap>
            <table data-testid="category-list">
              <thead>
                <tr>
                  <th>หมวดหมู่</th>
                  <th>Dataset</th>
                  <th>Ads ที่พบ</th>
                  <th>เพจที่พบ</th>
                  <th>เก็บครั้งแรก</th>
                  <th>เก็บล่าสุด</th>
                  {canEdit ? <th><span className={styles.srOnly}>จัดการ</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr key={row.category_id} data-testid={`category-row-${row.category_id}`}>
                    <td>
                      <Link href={`/categories/${row.category_id}`}>{row.category_name}</Link>
                    </td>
                    <td data-numeral>{row.dataset_count}</td>
                    {/* Distinct ads: one ad in four datasets of this category is
                        one ad, not four. */}
                    <td data-numeral>{row.observed_ads}</td>
                    <td data-numeral>{row.observed_pages}</td>
                    <td>{thaiDate(row.first_collected_at)}</td>
                    <td>{thaiDate(row.last_collected_at)}</td>
                    {canEdit ? (
                      <td>
                        <CategoryRowActions id={row.category_id} name={row.category_name}
                          datasets={row.dataset_count} canDelete={actor.role === "admin"} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      <p className={styles.note}>
        ตัวเลขทั้งหมดคือสิ่งที่ PT Glory เก็บมาได้ในแต่ละหมวด ไม่ใช่จำนวนโฆษณาทั้งหมดที่มีอยู่จริงในตลาด
      </p>
    </>
  );
}
