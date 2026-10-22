import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDecisionError, decideAccessRequest, listAccessRequests, type AccessRequestRow } from "@/lib/auth/access-requests";
import { AuthorizationError, isRole, type Role } from "@/lib/auth/role-model";
import { Icon } from "@/components/shell/icons";
import styles from "./settings.module.css";

const ROLE_LABEL: Record<Role, string> = { analyst: "ทีมการตลาด (analyst)", viewer: "ดูอย่างเดียว (viewer)", admin: "ผู้ดูแล (admin)" };
const when = (value: string | null) => value ? new Date(value).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "—";

/** Approve or reject one request. The admin check and the writes are in decideAccessRequest; this only reads the form. */
async function decide(form: FormData) {
  "use server";
  const id = String(form.get("id") ?? "");
  const decision = form.get("decision") === "reject" ? "reject" : "approve";
  const role = isRole(form.get("role")) ? form.get("role") as Role : "analyst";
  let problem: string | null = null;
  try { await decideAccessRequest(id, decision, role); }
  catch (error) {
    if (error instanceof AccessDecisionError || error instanceof AuthorizationError) problem = error.message;
    else { console.error("Access decision failed", (error as { code?: string }).code ?? (error as Error).name); problem = "บันทึกไม่สำเร็จ ลองอีกครั้ง"; }
  }
  revalidatePath("/settings");
  redirect(problem ? `/settings?access_error=${encodeURIComponent(problem)}#access` : `/settings?access=${decision}#access`);
}

/**
 * Who asked for an account and is waiting, for admins on the settings page. One click approves with the role
 * chosen (analyst by default, the team's working role); rejecting asks once more, because it deletes the login.
 */
export async function AccessRequests({ notice, problem }: { notice: string | null; problem: string | null }) {
  let data: { pending: AccessRequestRow[]; recent: AccessRequestRow[] } | null = null;
  try { data = await listAccessRequests(); } catch { data = null; }
  const host = (await headers()).get("host");
  const signup = host ? `${host.startsWith("localhost") ? "http" : "https"}://${host}/signup` : "/signup";

  return (
    <section className={styles.group} aria-labelledby="settings-access" id="access" data-testid="settings-access">
      <h2 id="settings-access">คำขอใช้งาน {data?.pending.length ? <span className={styles.count}>{data.pending.length} รออนุมัติ</span> : null}</h2>
      {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
      {notice ? <p className={styles.done} role="status">{notice === "approve" ? "อนุมัติแล้ว ผู้ขอเข้าสู่ระบบได้ทันที" : "ปฏิเสธแล้ว ลบบัญชีที่สมัครไว้ อีเมลนี้สมัครใหม่ได้"}</p> : null}
      <div className={styles.list}>
        {data == null ? <div className={styles.row}><span className={styles.hint}>เปิดรายการคำขอไม่สำเร็จ</span></div>
          : !data.pending.length ? <div className={styles.row}><span className={styles.hint}>ไม่มีคำขอรออนุมัติ · ส่งลิงก์ <b className={styles.link}>{signup}</b> ให้คนที่ต้องการใช้งาน</span></div>
          : data.pending.map((request) => (
            <div key={request.id} className={styles.request} data-testid={`access-${request.email}`}>
              <span className={styles.avatarSmall} aria-hidden><Icon name="shield" size={16} /></span>
              <span className={styles.text}>
                <span className={styles.name}>{request.full_name}</span>
                <span className={styles.hint}>{request.email}{request.team ? ` · ${request.team}` : ""} · ขอเมื่อ {when(request.created_at)}</span>
                {request.note ? <span className={styles.quote}>“{request.note}”</span> : null}
              </span>
              <form action={decide} className={styles.decide}>
                <input type="hidden" name="id" value={request.id} />
                <label className={styles.srOnly} htmlFor={`role-${request.id}`}>สิทธิ์ของ {request.full_name}</label>
                <select id={`role-${request.id}`} name="role" defaultValue="analyst">
                  {(["analyst", "viewer", "admin"] as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                </select>
                <button type="submit" name="decision" value="approve" data-variant="primary" className={styles.approve}>อนุมัติ</button>
                <details className={styles.reject}>
                  <summary>ปฏิเสธ</summary>
                  <button type="submit" name="decision" value="reject" className={styles.rejectConfirm}>ยืนยันปฏิเสธและลบบัญชีที่สมัคร</button>
                </details>
              </form>
            </div>
          ))}
      </div>
      {data?.recent.length ? (
        <p className={styles.recent}>ล่าสุด: {data.recent.map((request) => `${request.full_name} ${request.status === "approved" ? `อนุมัติเป็น ${request.role}` : "ปฏิเสธ"} (${when(request.decided_at)})`).join(" · ")}</p>
      ) : null}
    </section>
  );
}
