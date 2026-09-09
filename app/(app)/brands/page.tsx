import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { listBrands, listUnmappedPages } from "@/lib/read/brands";
import { BRAND_BASIS, STATUS_LABEL, brandStatus } from "@/lib/brands/contract";
import { thaiDateTime } from "@/lib/format/date";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { BrandCreate } from "./create";
import styles from "./brands.module.css";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Brand management.
 *
 * An editorial surface, not an analytics one. Every number here is about the
 * grouping itself — how many Pages, when it last changed — because a Brand-level
 * ad count needs a stated data scope and a list row has nowhere to state one.
 */
export default async function BrandsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireActorOrRedirect();
  const query = await searchParams;

  const search = (one(query.q) ?? "").slice(0, 200);
  const status = brandStatus(one(query.status)) ?? (one(query.status) === "all" ? null : "active");
  const canEdit = satisfies(actor.role, "analyst");

  const [brands, unmapped] = await Promise.all([
    listBrands({ search: search || null, status: status ?? "all", limit: 50 }),
    listUnmappedPages({ scope: { kind: "all" }, limit: 1 }),
  ]);

  const link = (next: Record<string, string>) => {
    const params = new URLSearchParams({ ...(search ? { q: search } : {}), ...next });
    const suffix = params.toString();
    return suffix ? `/brands?${suffix}` : "/brands";
  };

  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="แบรนด์"
        description="จัดกลุ่มเพจเป็นแบรนด์ด้วยการตัดสินใจของคน — เพจไม่ใช่แบรนด์โดยอัตโนมัติ"
        actions={
          <Link href="/unmapped-pages" data-testid="unmapped-shortcut">
            เพจที่ยังไม่จับคู่ ({unmapped.total.toLocaleString("th-TH")})
          </Link>
        }
      />

      <p className={styles.basis} data-testid="brand-basis">{BRAND_BASIS}</p>

      <Panel padded className={styles.controls}>
        <form className={styles.search} action="/brands" method="get" data-testid="brand-search-form">
          <label htmlFor="brand-q">ค้นหาแบรนด์</label>
          <input id="brand-q" name="q" defaultValue={search} data-testid="brand-search" />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" data-testid="brand-search-submit">ค้นหา</button>
        </form>
        <nav className={styles.filters} aria-label="สถานะแบรนด์">
          {([
            ["active", STATUS_LABEL.active], ["archived", STATUS_LABEL.archived], ["all", "ทั้งหมด"],
          ] as const).map(([value, label]) => (
            <Link
              key={value}
              href={link({ status: value })}
              className={(status ?? "all") === value ? styles.filterOn : styles.filter}
              aria-current={(status ?? "all") === value ? "true" : undefined}
              data-testid={`brand-filter-${value}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </Panel>

      {canEdit ? <BrandCreate /> : null}

      {brands.rows.length === 0 ? (
        <EmptyState
          testId="brands-empty"
          title="ยังไม่มีแบรนด์"
          body="แบรนด์ถูกสร้างโดยทีมวิจัย ไม่ได้มาจากข้อมูลที่เก็บมา — เริ่มจากคิวเพจที่ยังไม่จับคู่"
          action={<Link href="/unmapped-pages">ไปที่เพจที่ยังไม่จับคู่</Link>}
        />
      ) : (
        <Panel>
          <PanelHead
            title="แบรนด์ทั้งหมด"
            meta={`${brands.total.toLocaleString("th-TH")} แบรนด์`}
          />
          <TableWrap>
            <table data-testid="brand-table">
              <thead>
                <tr>
                  <th>แบรนด์</th>
                  <th>เพจที่จับคู่อยู่</th>
                  <th>เคยจับคู่ทั้งหมด</th>
                  <th>สถานะ</th>
                  <th>แก้ไขการจับคู่ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {brands.rows.map((brand) => (
                  <tr key={brand.id} data-testid={`brand-row-${brand.id}`}>
                    <td>
                      <Link href={`/brands/${brand.id}`}>{brand.name}</Link>
                    </td>
                    <td data-numeral>{brand.active_pages}</td>
                    {/* Pages that ever belonged here, including ones that moved
                        away. The difference between the two columns is history. */}
                    <td data-numeral>{brand.mapped_pages_ever}</td>
                    <td>
                      <span
                        className={brand.status === "archived" ? styles.archived : styles.active}
                        data-testid={`brand-status-${brand.id}`}
                      >
                        {STATUS_LABEL[brand.status]}
                      </span>
                    </td>
                    <td>{brand.last_mapping_change ? thaiDateTime(brand.last_mapping_change) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}

      <p className={styles.note}>
        แบรนด์คือการจัดกลุ่มภายในของ PT Glory · หน้านี้ไม่ใช่ส่วนแบ่งตลาด ไม่มีงบโฆษณา และไม่มีตัวเลขผลลัพธ์ของโฆษณา
      </p>
    </>
  );
}
