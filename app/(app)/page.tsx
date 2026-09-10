import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { satisfies } from "@/lib/auth/role-model";
import { thaiDate, thaiDateTime } from "@/lib/format/date";
import { listResearchCategories } from "@/lib/read/categories";
import { listDatasets } from "@/lib/read/queries";
import { listUnmappedPages } from "@/lib/read/brands";
import { collectionAge, freshnessNote } from "@/lib/domain/freshness";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel, PanelHead, TableWrap } from "@/components/Surface";
import { EmptyState } from "@/components/states/EmptyState";
import { Icon } from "@/components/shell/icons";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

/**
 * Where a working day starts.
 *
 * It used to be two links and four counters — true, and no help at all in
 * getting to work. What a researcher needs on opening this is: how old the
 * picture is, what is waiting to be done, and which research they already have.
 *
 * Every figure is still a count of rows they can go and look at. There is no
 * engagement, reach or spend to show here, and a home screen is exactly where
 * the temptation to invent one is strongest.
 */
export default async function HomePage() {
  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  const actor = await requireActorOrRedirect();

  const [datasets, categories, unmapped] = await Promise.all([
    listDatasets(),
    listResearchCategories(),
    listUnmappedPages({ scope: { kind: "all" }, limit: 1 }),
  ]);

  const canEdit = satisfies(actor.role, "analyst");

  /*
   * The clock that matters is when the data was COLLECTED, not when somebody
   * imported it. A three-day-old export uploaded this morning is three days
   * old, and the timeline, trends and watchlist all read it that way.
   */
  const collectedAt = datasets
    .map((row) => row.collected_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const age = collectionAge(collectedAt);
  const note = freshnessNote(age);

  return (
    <>
      <PageHeader
        eyebrow="ยินดีต้อนรับ"
        title="PT Glory Intelligence"
        description="ระบบวิเคราะห์โฆษณาคู่แข่งภายใน · ทุกตัวเลขคือสิ่งที่เราเก็บมาได้ ไม่ใช่ทั้งตลาด"
        badge={<span data-eyebrow>สิทธิ์ {actor.role}</span>}
      />

      {/* ------------------------------------------------- how old the data is */}

      <Panel padded testId="home-freshness" className={styles.freshness}>
        <div className={styles.freshRow}>
          <div>
            <div className={styles.statLabel}>เก็บข้อมูลล่าสุด</div>
            <div className={styles.freshValue} data-testid="home-collected-at">
              {collectedAt ? thaiDateTime(collectedAt) : "ยังไม่มีข้อมูล"}
            </div>
          </div>
          <div>
            <div className={styles.statLabel}>อายุข้อมูล</div>
            <div className={styles.freshValue} data-numeral data-testid="home-collection-age">
              {age === null ? "—" : `${age} วัน`}
            </div>
          </div>
          {canEdit ? (
            <Link href="/import" className={styles.freshAction}>นำเข้ารอบใหม่ →</Link>
          ) : null}
        </div>
        {note ? (
          <p
            className={note.level === "warn" ? styles.freshWarn : styles.freshNote}
            data-testid="home-freshness-note"
          >
            {note.text}
          </p>
        ) : null}
      </Panel>

      {/* --------------------------------------------------------- work waiting */}

      <div className={styles.cards}>
        <Link href="/unmapped-pages" className={styles.card} data-testid="home-card-unmapped">
          <span className={`${styles.icon} ${styles.iconBrand}`}><Icon name="unlink" /></span>
          <div className={styles.cardTitle}>
            เพจรอจับคู่แบรนด์
            <span className={styles.cardCount} data-numeral data-testid="home-unmapped-count">
              {unmapped.total.toLocaleString("th-TH")}
            </span>
          </div>
          <p className={styles.cardBody}>
            เพจที่ยังไม่มีใครจัดเข้าแบรนด์ · ไม่ใช่ข้อผิดพลาดของข้อมูล เป็นคิวงานที่ยังไม่มีใครตรวจ
          </p>
          <span className={styles.cardGo}>เปิดคิว →</span>
        </Link>

        <Link href="/datasets" className={styles.card} data-testid="home-card-datasets">
          <span className={`${styles.icon} ${styles.iconBlue}`}><Icon name="layers" /></span>
          <div className={styles.cardTitle}>
            ชุดข้อมูล
            <span className={styles.cardCount} data-numeral data-testid="home-dataset-count">
              {datasets.length}
            </span>
          </div>
          <p className={styles.cardBody}>
            แต่ละชุดคือภาพนิ่งของรอบเก็บหนึ่งครั้ง · เปิดวันไหนก็ได้เลขเดิมเสมอ
          </p>
          <span className={styles.cardGo}>ดูทั้งหมด →</span>
        </Link>
      </div>

      {/* ------------------------------------------------- what research exists */}

      <Panel className={styles.section}>
        <PanelHead
          title="งานวิจัยที่มีอยู่"
          meta={<Link href="/categories">หมวดหมู่ทั้งหมด →</Link>}
        />
        {categories.length === 0 ? (
          <EmptyState
            testId="home-no-categories"
            title="ยังไม่มีข้อมูลในระบบ"
            body="เริ่มจากนำเข้าไฟล์ export จาก PT Glory Extension หนึ่งไฟล์"
            action={canEdit ? <Link href="/import">ไปที่นำเข้าข้อมูล</Link> : undefined}
          />
        ) : (
          <TableWrap>
            <table data-testid="home-categories">
              <thead>
                <tr>
                  <th>หมวดหมู่</th>
                  <th>รอบเก็บ</th>
                  <th>Ads ที่พบ</th>
                  <th>เพจที่พบ</th>
                  <th>เก็บล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr key={row.category_id} data-testid={`home-category-${row.category_id}`}>
                    <td>
                      <Link href={`/categories/${row.category_id}`}>{row.category_name}</Link>
                    </td>
                    <td data-numeral>{row.dataset_count}</td>
                    {/* Distinct within the category: one ad seen in four of its
                        datasets is one ad, not four. */}
                    <td data-numeral>{row.observed_ads}</td>
                    <td data-numeral>{row.observed_pages}</td>
                    <td>{thaiDate(row.last_collected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {/* ------------------------------------------------------------- shortcuts */}

      <Panel padded className={styles.section}>
        <PanelHead title="ไปที่งาน" meta="เฉพาะหน้าที่เปิดใช้งานแล้ว" />
        <div className={styles.links} data-testid="home-links">
          {[
            ["/pages", "เพจ / แบรนด์", "building"],
            ["/brands", "แบรนด์", "building"],
            ["/trends", "แนวโน้ม", "trend"],
            ["/compare", "Compare", "compare"],
            ["/watchlist", "Watchlist", "bookmark"],
            ["/categories", "หมวดหมู่", "folder"],
          ].map(([href, label, icon]) => (
            <Link key={href} href={href} className={styles.link}>
              <span className={styles.linkIcon}><Icon name={icon as never} /></span>
              {label}
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
