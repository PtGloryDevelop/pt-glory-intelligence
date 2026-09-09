import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { getBrandDetail, getBrandPages, getMappingHistory } from "@/lib/read/brands";
import { parseScope, scopeBasis, scopeLabel, scopeToParam } from "@/lib/pages/scope";
import { listCategories, listDatasets } from "@/lib/read/queries";
import { BRAND_ADS_BASIS, BRAND_BASIS, STATUS_LABEL } from "@/lib/brands/contract";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { EmptyState } from "@/components/states/EmptyState";
import { MapPageControl } from "@/components/brand/MapPageControl";
import { BrandControls } from "./controls";
import styles from "../brands.module.css";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * One Brand: who is in it now, and every decision that got it here.
 *
 * The ad count is the only aggregate, and it is deliberately hemmed in — it
 * counts distinct ads reached through the Pages mapped to this Brand *today*,
 * inside one stated scope. It is not a historical attribution, and there is no
 * share, spend or ranking here: those need a denominator this phase has not
 * designed.
 */
export default async function BrandDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const query = await searchParams;

  // Brand membership is scope-free, but ad counts are not. `all` is the default
  // and it is written on the screen rather than assumed.
  const scope = parseScope(one(query.scope) ?? "all") ?? { kind: "all" as const };
  const canEdit = satisfies(actor.role, "analyst");

  const detail = await getBrandDetail(id, scope);
  if (!detail) notFound();

  const [pages, history, scopeName] = await Promise.all([
    getBrandPages(id, scope),
    getMappingHistory({ brandId: id }),
    nameOfScope(scope),
  ]);

  const scopeParam = scopeToParam(scope);

  return (
    <>
      <PageHeader
        eyebrow="Brand"
        title={detail.name}
        back={{ href: "/brands", label: "แบรนด์ทั้งหมด" }}
        description="แบรนด์คือการจัดกลุ่มเพจโดย PT Glory — ข้อมูลระดับเพจยังคงเป็นหลักฐานหลัก"
        actions={
          <span className={styles.headerActions}>
            <span
              className={detail.status === "archived" ? styles.archived : styles.active}
              data-testid="brand-status"
            >
              {STATUS_LABEL[detail.status]}
            </span>
            <Link href="/unmapped-pages" data-testid="add-page">เพิ่มเพจจากคิว</Link>
          </span>
        }
      />

      <ContextBar
        items={[
          { label: "Brand ID", value: detail.id, testId: "brand-identity" },
          { label: "เพจที่จับคู่อยู่", value: String(detail.active_pages), testId: "brand-active-pages" },
          { label: "ขอบเขตข้อมูลของตัวเลข", value: scopeLabel(scope, scopeName), testId: "brand-scope" },
          { label: "สร้างเมื่อ", value: thaiDateTime(detail.created_at) },
          { label: "แก้ไขล่าสุด", value: thaiDateTime(detail.updated_at) },
        ]}
      />

      <p className={styles.basis} data-testid="brand-basis">{BRAND_BASIS}</p>
      <p className={styles.basis} data-testid="brand-scope-basis">{scopeBasis(scope)}</p>

      <KPIRow>
        <KPIStat
          label="เพจที่จับคู่อยู่" value={detail.active_pages}
          helper="ตามการจับคู่ปัจจุบัน" testId="kpi-active-pages"
        />
        <KPIStat
          label="เพจที่มีข้อมูลในขอบเขตนี้" value={detail.pages_in_scope}
          helper="เพจที่จับคู่อยู่ และพบข้อมูลในขอบเขตที่เลือก" testId="kpi-pages-in-scope"
        />
        <KPIStat
          label="Ads ที่พบ" value={detail.observed_ads}
          helper="โฆษณาไม่ซ้ำ (ad_archive_id) จากเพจที่จับคู่อยู่" testId="kpi-observed-ads"
        />
        <KPIStat
          label="สังเกตล่าสุด" value={thaiDate(detail.last_observed_at)}
          helper="รอบเก็บล่าสุดที่เห็นเพจของแบรนด์นี้"
        />
      </KPIRow>

      <p className={styles.basis} data-testid="brand-ads-basis">{BRAND_ADS_BASIS}</p>

      {/* --------------------------------------------------- active pages */}

      <Panel className={styles.section}>
        <PanelHead title="เพจที่จับคู่อยู่" meta={`${pages.length} เพจ`} />
        {pages.length === 0 ? (
          <EmptyState
            testId="brand-pages-empty"
            title="ยังไม่มีเพจในแบรนด์นี้"
            body="เลือกเพจจากคิวเพจที่ยังไม่จับคู่ แล้วจับคู่เข้ามาที่นี่"
            action={<Link href="/unmapped-pages">ไปที่คิว</Link>}
          />
        ) : (
          <TableWrap>
            <table data-testid="brand-pages">
              <thead>
                <tr>
                  <th>เพจ</th>
                  <th>Ads ที่พบ</th>
                  <th>จับคู่ตั้งแต่</th>
                  <th>โดย</th>
                  <th>สังเกตล่าสุด</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.page_id} data-testid={`brand-page-${page.page_id}`}>
                    <td>
                      {/* Every Page opens the frozen Page Intelligence surface:
                          the grouping never replaces the evidence. */}
                      <span className={styles.pageCell}>
                        <Link href={`/pages/${page.page_id}?scope=${scopeParam}`}>
                          {page.page_name ?? page.page_id}
                        </Link>
                        <span className={styles.pageId} data-numeral>{page.page_id}</span>
                      </span>
                    </td>
                    <td data-numeral>{page.observed_ads}</td>
                    <td>{thaiDateTime(page.mapped_since)}</td>
                    <td>{page.mapped_by_label ?? "—"}</td>
                    <td>{thaiDate(page.last_observed_at)}</td>
                    <td className={styles.mapCell}>
                      <MapPageControl
                        pageId={page.page_id}
                        currentBrand={{ id: detail.id, name: detail.name }}
                        canEdit={canEdit}
                        testId={`map-${page.page_id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {/* ------------------------------------------------------- history */}

      <Panel className={styles.section}>
        <PanelHead
          title="ประวัติการจับคู่"
          meta="การแก้ไขไม่ลบของเดิม"
        />
        {history.length === 0 ? (
          <p className={styles.basis} data-testid="brand-history-empty">ยังไม่มีประวัติการจับคู่</p>
        ) : (
          <TableWrap>
            <table data-testid="brand-history">
              <thead>
                <tr>
                  <th>เพจ</th>
                  <th>ช่วงเวลา</th>
                  <th>สถานะ</th>
                  <th>จับคู่โดย</th>
                  <th>ปิดโดย</th>
                  <th>บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.mapping_id} data-testid={`history-row-${row.mapping_id}`}>
                    <td>
                      {/* The id as well as the name: two pages can share a
                          display name, and a history nobody can disambiguate is
                          not a record of anything. */}
                      <span className={styles.pageCell}>
                        <Link href={`/pages/${row.page_id}?scope=all`}>
                          {row.page_name ?? row.page_id}
                        </Link>
                        <span className={styles.pageId} data-numeral>{row.page_id}</span>
                      </span>
                    </td>
                    <td className={styles.historyPeriod}>
                      {thaiDateTime(row.valid_from)} → {row.valid_to ? thaiDateTime(row.valid_to) : "ปัจจุบัน"}
                    </td>
                    <td>
                      {row.is_current
                        ? <span className={styles.current} data-testid={`history-current-${row.mapping_id}`}>ปัจจุบัน</span>
                        : "ปิดแล้ว"}
                    </td>
                    <td>{row.mapped_by_label ?? "—"}</td>
                    <td>{row.ended_by_label ?? "—"}</td>
                    <td>{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {canEdit ? (
        <BrandControls
          id={detail.id}
          name={detail.name}
          notes={detail.notes}
          status={detail.status}
          hasHistory={history.length > 0}
        />
      ) : null}
    </>
  );
}

async function nameOfScope(scope: { kind: string; id?: string }): Promise<string | null> {
  if (scope.kind === "all") return null;
  if (scope.kind === "dataset") {
    const datasets = await listDatasets();
    return datasets.find((row) => row.dataset_id === scope.id)?.dataset_name ?? null;
  }
  const categories = await listCategories();
  return categories.find((row) => row.id === scope.id)?.name ?? null;
}
