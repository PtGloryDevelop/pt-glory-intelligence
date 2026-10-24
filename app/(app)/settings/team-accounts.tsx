import { listTeam, type TeamMember } from "@/lib/auth/password-reset";
import { Icon } from "@/components/shell/icons";
import { ResetLinkButton } from "./reset-link";
import { RoleControl } from "./team-role";
import styles from "./settings.module.css";

const when = (value: string | null) => value ? new Date(value).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "ยังไม่เคยเข้า";

/**
 * Every account, for admins: change a role or take access away, and make a new-password link. Anyone who asked for
 * a new password is first, marked; accounts without access are last, so access can be given back.
 */
export async function TeamAccounts() {
  let team: TeamMember[] | null = null;
  try { team = await listTeam(); } catch { team = null; }
  const asked = team?.filter((member) => member.reset_requested_at).length ?? 0;
  return (
    <section className={styles.group} aria-labelledby="settings-team" id="team" data-testid="settings-team">
      <h2 id="settings-team">ผู้ใช้งาน {asked ? <span className={styles.count}>{asked} ขอตั้งรหัสใหม่</span> : null}</h2>
      <div className={styles.list}>
        {team == null ? <div className={styles.row}><span className={styles.hint}>เปิดรายชื่อผู้ใช้งานไม่สำเร็จ</span></div>
          : team.map((member) => (
            <div key={member.user_id} className={styles.request} data-asked={member.reset_requested_at ? true : undefined} data-revoked={member.role ? undefined : true}
              data-testid={`team-${member.email}`}>
              <span className={styles.avatarSmall} aria-hidden><Icon name="shield" size={16} /></span>
              <span className={styles.text}>
                <span className={styles.name}>{member.email}{member.self ? <span className={styles.you}>คุณ</span> : null}</span>
                <span className={styles.hint}>
                  {member.role ? `สิทธิ์ ${member.role}` : "ถอนสิทธิ์แล้ว เข้าใช้ไม่ได้"} · เข้าล่าสุด {when(member.last_sign_in_at)}
                  {member.reset_requested_at ? <b className={styles.asked}> · ขอตั้งรหัสใหม่ {when(member.reset_requested_at)}</b> : null}
                </span>
              </span>
              {member.self ? null : <RoleControl userId={member.user_id} email={member.email} role={member.role} />}
              {member.role ? <ResetLinkButton userId={member.user_id} email={member.email} /> : null}
            </div>
          ))}
      </div>
      <p className={styles.recent}>เปลี่ยนสิทธิ์หรือถอนสิทธิ์มีผลทันที ประวัติที่คนนั้นทำไว้ยังอยู่ · ลบบัญชีได้เฉพาะบัญชีที่ยังไม่มีงานในระบบ เช่น บัญชีที่ไม่เคยใช้ · สิทธิ์ของตัวเองต้องให้ผู้ดูแลอีกคนเปลี่ยน · คนที่ลืมรหัสผ่านกด “ลืมรหัสผ่าน?” ที่หน้าเข้าสู่ระบบ คำขอจะขึ้นบนสุด</p>
    </section>
  );
}
