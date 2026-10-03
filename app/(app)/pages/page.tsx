import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { getPageList } from "@/lib/read/pages";
import { listCategories, listDatasets } from "@/lib/read/queries";
import {
  DEFAULT_PAGE_SORT, parseScope, pageSortKey, recentDays,
  scopeBasis, scopeLabel, scopeToParam, type PageScope,
} from "@/lib/pages/scope";
import { PageHeader } from "@/components/shell/PageHeader";
import { ContextBar } from "@/components/ContextBar";
import { EmptyState } from "@/components/states/EmptyState";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { StatusBreakdown } from "@/components/StatusBreakdown";
import { thaiDate } from "@/lib/format/date";
import { PageToolbar } from "./toolbar";
import styles from "./pages.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function PagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireActorOrRedirect();
  const params = await searchParams;

  const scope = parseScope(one(params.scope)??'all');

  // Open the team's full catalog by default; an invalid explicit scope still
  // requires a choice rather than silently widening the evidence.
  if (!scope) return <ScopeChooser />;

  const sort = pageSortKey(one(params.sort)) ?? DEFAULT_PAGE_SORT;
  const days = recentDays(one(params.recentDays));
  const search = one(params.search) ?? "";
  const active = one(params.active) ?? "";
  const offsetRaw = Number(one(params.offset));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.trunc(offsetRaw) : 0;

  const [{ rows, total }, scopeName] = await Promise.all([
    getPageList(scope, {
      search: search || null,
      active: active || null,
      recentDays: days,
      sort,
      limit: PAGE_SIZE,
      offset,
    }),
    nameOfScope(scope),
  ]);

  const query = (extra: Record<string, string>) => {
    const next = new URLSearchParams();
    next.set("scope", scopeToParam(scope));
    if (search) next.set("search", search);
    if (active) next.set("active", active);
    if (sort !== DEFAULT_PAGE_SORT) next.set("sort", sort);
    if (days !== 30) next.set("recentDays", String(days));
    for (const [key, value] of Object.entries(extra)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="เพจ / แบรนด์"
        description="ข้อมูลระดับเพจจากโฆษณาที่เก็บมาแล้ว · ยังไม่มีการจับคู่เพจเข้าเป็นแบรนด์"
        actions={<Link href="/pages">เปลี่ยนขอบเขตข้อมูล</Link>}
      />

      <ContextBar
        items={[
          { label: "ขอบเขต", value: scopeLabel(scope, scopeName), testId: "scope-label" },
          { label: "เพจที่พบ", value: String(total), testId: "scope-pages" },
          { label: "หน้าต่างเวลา “พบใหม่”", value: `${days} วัน` },
        ]}
      />

      <p className={styles.basis} data-testid="scope-basis">{scopeBasis(scope)}</p>

      <PageToolbar
        scope={scopeToParam(scope)}
        search={search}
        active={active}
        sort={sort}
        recentDays={days}
      />

      {rows.length === 0 ? (
        <EmptyState
          testId="pages-empty"
          title={search || active ? "ไม่พบเพจที่ตรงกับตัวกรองนี้" : "ยังไม่มีเพจในขอบเขตนี้"}
          body={
            search || active
              ? "ลองล้างตัวกรอง หรือเปลี่ยนขอบเขตข้อมูล"
              : "ขอบเขตนี้ยังไม่มีโฆษณาที่เก็บไว้"
          }
          action={search || active ? <Link href={query({ search: "", active: "" })}>ล้างตัวกรอง</Link> : null}
        />
      ) : (
        <Panel>
          <PanelHead
            title="เพจที่พบในขอบเขตนี้"
            meta={`${total.toLocaleString("th-TH")} เพจ · แสดง ${offset + 1}–${offset + rows.length}`}
          />
          {/* Ten columns do not fit a phone; the table scrolls inside its own
              panel rather than dragging the whole page sideways. */}
          <TableWrap>
            <table data-testid="page-list">
              <thead>
                <tr>
                  <th>เพจ</th>
                  <th>หมวดเพจ</th>
                  <th>Ads ที่พบ</th>
                  <th>สถานะโฆษณา</th>
                  <th>พบใหม่ {days} วัน</th>
                  <th>Evergreen</th>
                  <th>ใช้ซ้ำ</th>
                  <th>เริ่มพบ</th>
                  <th>สังเกตล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.page_id} data-testid={`page-row-${row.page_id}`}>
                    <td>
                      <Link href={`/pages/${row.page_id}?scope=${scopeToParam(scope)}`}>
                        {row.page_name ?? row.page_id}
                      </Link>
                    </td>
                    <td className={styles.categories}>
                      {row.page_categories?.length ? row.page_categories.join(" · ") : "—"}
                    </td>
                    <td data-numeral>{row.observed_ads}</td>
                    {/* Only the states this page actually has ads in. Unknown
                        is never folded into inactive — the collector failing to
                        read a state is not the advertiser having stopped — and
                        what is hidden is always a zero, checkable against the
                        total in the column before this one. */}
                    <td className={styles.states}>
                      <StatusBreakdown
                        active={row.active_ads}
                        inactive={row.inactive_ads}
                        unknown={row.unknown_ads}
                        testId={`states-${row.page_id}`}
                      />
                    </td>
                    <td data-numeral>{row.recently_found}</td>
                    <td data-numeral>{row.evergreen_ads}</td>
                    <td data-numeral>{row.reused_ads}</td>
                    <td>{thaiDate(row.first_observed_at)}</td>
                    <td>{thaiDate(row.last_observed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      {total > PAGE_SIZE ? (
        <nav className={styles.pager} aria-label="หน้า">
          {offset > 0 ? (
            <Link data-testid="pages-prev" href={query({ offset: String(Math.max(offset - PAGE_SIZE, 0)) })}>
              ← ก่อนหน้า
            </Link>
          ) : <span />}
          {offset + PAGE_SIZE < total ? (
            <Link data-testid="pages-next" href={query({ offset: String(offset + PAGE_SIZE) })}>
              ถัดไป →
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </>
  );
}

/** The dataset or category name, so the scope reads as something recognisable. */
async function nameOfScope(scope: PageScope): Promise<string | null> {
  if (scope.kind === "all") return null;
  if (scope.kind === "dataset") {
    const datasets = await listDatasets();
    return datasets.find((row) => row.dataset_id === scope.id)?.dataset_name ?? null;
  }
  const categories = await listCategories();
  return categories.find((row) => row.id === scope.id)?.name ?? null;
}

/**
 * Choosing the scope is the first research decision, not a settings dialog.
 *
 * "Everything we have ever collected" is on the list, but it is a choice like
 * the others rather than the default that happens when nobody chooses.
 */
async function ScopeChooser() {
  const [categories, datasets] = await Promise.all([listCategories(), listDatasets()]);

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="เพจ / แบรนด์"
        description="เลือกขอบเขตข้อมูลก่อน — ตัวเลขระดับเพจทุกตัวคำนวณจากขอบเขตที่เลือกเท่านั้น"
      />

      {datasets.length === 0 ? (
        <EmptyState
          testId="scope-empty"
          title="ยังไม่มีข้อมูลให้วิเคราะห์"
          body="นำเข้าไฟล์ข้อมูลก่อน แล้วหน้านี้จะมีเพจให้ดู"
          action={<Link href="/import">ไปที่นำเข้าข้อมูล</Link>}
        />
      ) : (
        <div className={styles.scopeGrid} data-testid="scope-chooser">
          <Panel padded>
            <h2 className={styles.scopeHeading}>Dataset เดียว</h2>
            <p className={styles.scopeNote}>
              ค่าที่เห็นคือ snapshot ของรอบเก็บนั้น ไม่เปลี่ยนเมื่อมีรอบใหม่เข้ามา
            </p>
            <ul className={styles.scopeList}>
              {datasets.slice(0, 12).map((row) => (
                <li key={row.dataset_id}>
                  <Link href={`/pages?scope=dataset:${row.dataset_id}`} data-testid={`scope-dataset-${row.dataset_id}`}>
                    {row.dataset_name}
                  </Link>
                  <span className={styles.scopeMeta}>
                    {row.category_name} · {row.pages_in_dataset} เพจ · {thaiDate(row.collected_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel padded>
            <h2 className={styles.scopeHeading}>ทั้งหมวดหมู่</h2>
            <p className={styles.scopeNote}>
              รวมทุก Dataset ในหมวดนี้ · ใช้การสังเกตล่าสุดของแต่ละโฆษณา
            </p>
            <ul className={styles.scopeList}>
              {categories.map((row) => (
                <li key={row.id}>
                  <Link href={`/pages?scope=category:${row.id}`} data-testid={`scope-category-${row.id}`}>
                    {row.name}
                  </Link>
                </li>
              ))}
            </ul>

            <h2 className={`${styles.scopeHeading} ${styles.scopeAll}`}>ทุกข้อมูลที่เก็บมา</h2>
            <p className={styles.scopeNote}>
              ทุก Dataset ทุกหมวด · กว้างที่สุดและอ้างอิงเฉพาะสิ่งที่ PT Glory เก็บได้จริง
            </p>
            <Link href="/pages?scope=all" data-cta data-testid="scope-all">
              ดูทุกข้อมูล
            </Link>
          </Panel>
        </div>
      )}
    </>
  );
}
