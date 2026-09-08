import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import { thaiDateTime } from "@/lib/format/date";
import { listCategories, listDatasets } from "@/lib/read/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel, PanelHead } from "@/components/Surface";
import { Icon } from "@/components/shell/icons";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Awaited before any read: layout and page render concurrently, so the
  // layout's redirect cannot order this on the page's behalf.
  const actor = await requireActorOrRedirect();

  // Only now, with a real actor, do the reads run.
  const [datasets, categories] = await Promise.all([listDatasets(), listCategories()]);

  // Every figure below is a count of rows the user can go and look at. There is
  // no engagement, reach or spend to show here, and a home screen is exactly
  // where the temptation to invent one would be strongest.
  const latest = datasets[0];

  return (
    <>
      <PageHeader
        eyebrow="ยินดีต้อนรับ"
        title="PT Glory Intelligence"
        description="ระบบวิเคราะห์โฆษณาคู่แข่งภายใน · Phase 1 นำเข้าข้อมูลจาก Extension แล้วสำรวจ Dataset ได้"
        badge={<span data-eyebrow>สิทธิ์ {actor.role}</span>}
      />

      <div className={styles.cards}>
        <Link href="/datasets" className={styles.card} data-testid="home-card-datasets">
          <span className={`${styles.icon} ${styles.iconBrand}`}><Icon name="layers" /></span>
          <div className={styles.cardTitle}>ชุดข้อมูล</div>
          <p className={styles.cardBody}>
            เปิด Dataset ที่นำเข้าไว้ ดูคุณภาพข้อมูล และสำรวจโฆษณาในรอบเก็บนั้น
          </p>
          <span className={styles.cardGo}>ดูทั้งหมด →</span>
        </Link>

        <Link href="/import" className={styles.card} data-testid="home-card-import">
          <span className={`${styles.icon} ${styles.iconBlue}`}><Icon name="upload" /></span>
          <div className={styles.cardTitle}>นำเข้าข้อมูล</div>
          <p className={styles.cardBody}>
            อัปโหลดไฟล์ JSON จาก PT Glory Extension · ขั้นตรวจไม่เขียนฐานข้อมูล
          </p>
          <span className={styles.cardGo}>เริ่มนำเข้า →</span>
        </Link>
      </div>

      <Panel testId="home-status">
        <PanelHead title="สถานะระบบ" meta="นับจากข้อมูลจริงในฐานข้อมูล" />
        <div className={styles.status}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>ชุดข้อมูลทั้งหมด</div>
            <div className={styles.statValue} data-numeral data-testid="home-dataset-count">
              {datasets.length}
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>หมวดหมู่</div>
            <div className={styles.statValue} data-numeral>{categories.length}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>นำเข้าล่าสุด</div>
            <div className={styles.statValueSm}>
              {thaiDateTime(latest?.created_at)}
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Dataset ล่าสุด</div>
            <div className={styles.statValueSm}>
              {latest ? (
                <Link href={`/datasets/${latest.dataset_id}`}>{latest.dataset_name}</Link>
              ) : "—"}
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
