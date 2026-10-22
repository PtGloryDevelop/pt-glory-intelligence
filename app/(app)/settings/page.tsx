import Link from "next/link";
import { requireActorOrRedirect } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/role-model";
import { PageHeader } from "@/components/shell/PageHeader";
import { Icon } from "@/components/shell/icons";
import { Tile } from "@/components/shell/Tile";
import { visibleAdminTools, visibleNav, type NavItem } from "@/components/shell/nav";
import { getFreshness, type FreshnessChip } from "@/lib/shell/freshness";
import { signOut } from "../sign-out";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

const ROLE_NOTE: Record<Role, string> = {
  viewer: "ดูข้อมูลได้ แต่เก็บหรืออัปเดตข้อมูลไม่ได้",
  analyst: "ดูข้อมูล เก็บแอดคู่แข่ง และอัปเดตแอดของเราได้",
  admin: "ทำได้ทุกอย่าง รวมถึงเครื่องมือดูแลระบบ",
};

/**
 * The account, how fresh the data is, and every upkeep tool the role may open.
 *
 * The list is decided here on the server from the same menu model as the
 * sidebar: an admin tool never reaches an analyst's HTML. Each tool's own page
 * still checks the role itself; this page only decides what to offer. On a
 * phone this is also the only way to the two update pages and to signing out.
 */
export default async function SettingsPage() {
  const actor = await requireActorOrRedirect();
  const updates = visibleNav(actor.role).find(section => section.heading === "อัปเดตข้อมูล")?.items ?? [];
  const admin = visibleAdminTools(actor.role);
  const freshness = await getFreshness(actor.role);
  const status = ([["ours", freshness.owned], ["rival", freshness.rivals]] as const)
    .filter((entry): entry is readonly ["ours" | "rival", FreshnessChip] => entry[1] != null);

  const row = (item: NavItem) => (
    <Link key={item.href} href={item.href} className={styles.row} data-testid={`settings-${item.href}`}>
      <Tile icon={item.icon} tone={item.tone} />
      <span className={styles.text}>
        <span className={styles.name}>{item.label}</span>
        {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
      </span>
      <span className={styles.chevron}><Icon name="chevron" size={15} /></span>
    </Link>
  );

  return (
    <>
      <PageHeader title="ตั้งค่า" />
      <div className={styles.page}>
        <section className={styles.account} aria-label="บัญชี">
          <span className={styles.avatar} aria-hidden><Icon name="shield" size={22} /></span>
          <span className={styles.text}>
            <span className={styles.accountName}>สิทธิ์ {actor.role}</span>
            <span className={styles.hint}>{ROLE_NOTE[actor.role]}</span>
          </span>
          {/* A server action, not a click handler: the session is a cookie, and only a server response can clear one. */}
          <form action={signOut}>
            <button type="submit" className={styles.signOut} data-testid="sign-out">ออกจากระบบ</button>
          </form>
        </section>

        <section className={styles.group} aria-labelledby="settings-status">
          <h2 id="settings-status">สถานะข้อมูล</h2>
          <div className={styles.list} data-testid="settings-freshness">
            {status.length ? status.map(([tone, chip]) => (
              <div key={tone} className={styles.row}>
                <Tile icon={tone === "ours" ? "chart" : "swords"} tone={tone} />
                <span className={styles.text}><span className={styles.name}>{chip.label}</span></span>
                {chip.stale ? <span className={styles.stale}>เก่ากว่าที่ควร</span> : null}
              </div>
            )) : <div className={styles.row}><span className={styles.hint}>ยังอ่านสถานะข้อมูลไม่ได้</span></div>}
          </div>
        </section>

        {updates.length ? (
          <section className={styles.group} aria-labelledby="settings-updates">
            <h2 id="settings-updates">อัปเดตข้อมูล</h2>
            <div className={styles.list}>{updates.map(row)}</div>
          </section>
        ) : null}

        {admin.length ? (
          <section className={styles.group} aria-labelledby="settings-admin">
            <h2 id="settings-admin">ผู้ดูแลระบบ <span className={styles.badge}>เฉพาะ admin</span></h2>
            <div className={styles.list}>{admin.map(row)}</div>
          </section>
        ) : null}
      </div>
    </>
  );
}
