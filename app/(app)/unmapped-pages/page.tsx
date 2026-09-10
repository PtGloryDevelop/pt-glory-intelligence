import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { listUnmappedPages } from "@/lib/read/brands";
import { getPageList } from "@/lib/read/pages";
import { listCategories, listDatasets } from "@/lib/read/queries";
import { parseScope, scopeBasis, scopeLabel, scopeToParam } from "@/lib/pages/scope";
import {
  BRAND_BASIS, UNMAPPED_MEANING, UNMAPPED_SORTS, UNMAPPED_SORT_LABEL, unmappedSort,
} from "@/lib/brands/contract";
import { thaiDate } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { EmptyState } from "@/components/states/EmptyState";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { MapPageControl } from "@/components/brand/MapPageControl";
import styles from "./unmapped.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The review queue.
 *
 * An unmapped Page is a Page nobody has grouped yet. That is not a data
 * problem, not a coverage tier and not a warning — it is work waiting, so the
 * ordering is about review efficiency and never about which Brand a Page is
 * "probably" in. Nothing here suggests an answer.
 */
export default async function UnmappedPagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireActorOrRedirect();
  const query = await searchParams;

  const scope = parseScope(one(query.scope) ?? "all") ?? { kind: "all" as const };
  const sort = unmappedSort(one(query.sort));
  const search = (one(query.q) ?? "").slice(0, 200);
  const page = Math.max(1, Number(one(query.page) ?? 1) || 1);
  const canEdit = satisfies(actor.role, "analyst");

  const [queue, scopeName, allPages] = await Promise.all([
    listUnmappedPages({
      scope, search: search || null, sort,
      limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
    }),
    nameOfScope(scope),
    // Pages in this scope, mapped or not. The difference is what has been done,
    // which a queue of 351 rows otherwise never shows.
    getPageList(scope, { limit: 1 }),
  ]);

  const inScope = allPages.total;
  const mapped = Math.max(0, inScope - queue.total);

  const scopeParam = scopeToParam(scope);
  const link = (next: Record<string, string>) => {
    const params = new URLSearchParams({
      scope: scopeParam, sort, ...(search ? { q: search } : {}), ...next,
    });
    return `/unmapped-pages?${params.toString()}`;
  };

  const lastPage = Math.max(1, Math.ceil(queue.total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="เพจที่ยังไม่จับคู่แบรนด์"
        description="คิวตรวจของทีมวิจัย — จับคู่เพจเข้าแบรนด์ทีละรายการ"
        actions={<Link href="/brands" data-testid="brands-link">ไปที่แบรนด์</Link>}
      />

      <ContextBar
        items={[
          { label: "ขอบเขตข้อมูล", value: scopeLabel(scope, scopeName), testId: "unmapped-scope" },
          { label: "เพจที่ยังไม่จับคู่", value: queue.total.toLocaleString("th-TH"), testId: "unmapped-total" },
          {
            // Progress, in the only terms that are true: pages this scope has
            // seen, and how many of them somebody has already decided about.
            label: "จับคู่แล้ว",
            value: `${mapped.toLocaleString("th-TH")} จาก ${inScope.toLocaleString("th-TH")}`,
            testId: "unmapped-progress",
          },
          { label: "เรียงตาม", value: UNMAPPED_SORT_LABEL[sort], testId: "unmapped-sort-label" },
        ]}
      />

      <p className={styles.basis} data-testid="unmapped-meaning">{UNMAPPED_MEANING}</p>
      <p className={styles.basis} data-testid="brand-basis">{BRAND_BASIS}</p>
      <p className={styles.basis}>{scopeBasis(scope)}</p>

      <Panel padded className={styles.controls}>
        <form className={styles.search} action="/unmapped-pages" method="get" data-testid="unmapped-search-form">
          <label htmlFor="unmapped-q">ค้นหาเพจ (ชื่อหรือ Page ID)</label>
          <input id="unmapped-q" name="q" defaultValue={search} data-testid="unmapped-search" />
          <input type="hidden" name="scope" value={scopeParam} />
          <input type="hidden" name="sort" value={sort} />
          <button type="submit" data-testid="unmapped-search-submit">ค้นหา</button>
        </form>
        <nav className={styles.sorts} aria-label="เรียงลำดับคิว">
          {UNMAPPED_SORTS.map((option) => (
            <Link
              key={option}
              href={link({ sort: option, page: "1" })}
              className={sort === option ? styles.sortOn : styles.sort}
              aria-current={sort === option ? "true" : undefined}
              data-testid={`unmapped-sort-${option}`}
            >
              {UNMAPPED_SORT_LABEL[option]}
            </Link>
          ))}
        </nav>
      </Panel>

      {queue.rows.length === 0 ? (
        <EmptyState
          testId="unmapped-empty"
          title="ไม่มีเพจที่รอจับคู่"
          body="ทุกเพจในขอบเขตนี้ถูกจับคู่กับแบรนด์แล้ว หรือยังไม่มีข้อมูลเพจในขอบเขตนี้"
          action={<Link href="/brands">ดูแบรนด์ทั้งหมด</Link>}
        />
      ) : (
        <Panel>
          <PanelHead
            title="คิวตรวจ"
            meta={`หน้า ${page} จาก ${lastPage} · ${queue.total.toLocaleString("th-TH")} เพจ`}
          />
          <TableWrap>
            <table data-testid="unmapped-table">
              <thead>
                {/* Marked columns fold away below 640px so the decision — who
                    is this page, how big is it, and the button — fits a phone
                    without a sideways swipe. Nothing is lost: the page's own
                    screen has all of it, and the note under the table says so. */}
                <tr>
                  <th>เพจ</th>
                  <th className={styles.secondary}>หมวดเพจ (จาก Meta)</th>
                  <th>Ads ที่พบ</th>
                  <th className={styles.secondary}>พบใหม่ 30 วัน</th>
                  <th className={styles.secondary}>เริ่มพบ</th>
                  <th className={styles.secondary}>สังเกตล่าสุด</th>
                  <th>จับคู่</th>
                </tr>
              </thead>
              <tbody>
                {queue.rows.map((row) => (
                  <tr key={row.page_id} data-testid={`unmapped-row-${row.page_id}`}>
                    <td>
                      {/* Two identities, because two Pages can share a name and
                          the reviewer must not pick from the display name. */}
                      <span className={styles.pageCell}>
                        <Link href={`/pages/${row.page_id}?scope=${scopeParam}`}>
                          {row.page_name ?? row.page_id}
                        </Link>
                        <span className={styles.pageId} data-numeral>{row.page_id}</span>
                      </span>
                    </td>
                    <td className={`${styles.categories} ${styles.secondary}`}>
                      {row.page_categories?.length ? row.page_categories.join(" · ") : "—"}
                    </td>
                    <td data-numeral>{row.observed_ads}</td>
                    <td className={styles.secondary} data-numeral>{row.recently_found}</td>
                    <td className={styles.secondary}>{thaiDate(row.first_observed_at)}</td>
                    <td className={styles.secondary}>{thaiDate(row.last_observed_at)}</td>
                    <td className={styles.mapCell}>
                      <MapPageControl
                        pageId={row.page_id} currentBrand={null} canEdit={canEdit}
                        testId={`map-${row.page_id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      {lastPage > 1 ? (
        <nav className={styles.pager} aria-label="หน้าในคิว" data-testid="unmapped-pager">
          {page > 1 ? <Link href={link({ page: String(page - 1) })}>ก่อนหน้า</Link> : <span>ก่อนหน้า</span>}
          <span>หน้า {page} / {lastPage}</span>
          {page < lastPage ? <Link href={link({ page: String(page + 1) })}>ถัดไป</Link> : <span>ถัดไป</span>}
        </nav>
      ) : null}

      {/* Said rather than left to be discovered: columns disappear on a phone,
          and the reader is told where the rest of it lives. */}
      <p className={styles.mobileNote} data-testid="unmapped-mobile-note">
        บนจอเล็กแสดงเฉพาะคอลัมน์ที่ใช้ตัดสินใจ — หมวดเพจ วันที่พบ และวันที่สังเกตล่าสุด
        ดูได้ในหน้าเพจ
      </p>

      <p className={styles.note}>
        ตรวจเพจก่อนจับคู่ได้จากลิงก์ชื่อเพจ — หน้าเพจเดิมคือหลักฐานทั้งหมดที่ระบบมี
        ระบบไม่แนะนำแบรนด์ให้ และไม่มีคะแนนความน่าจะเป็น
      </p>
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
