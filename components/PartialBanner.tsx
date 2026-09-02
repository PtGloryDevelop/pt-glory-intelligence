import styles from "./PartialBanner.module.css";

/**
 * A partial run is a warning, not an error: rows were imported and are safe to
 * read — some were not. It gets the amber semantic tokens rather than danger,
 * and every number in it is passed in from the server. Nothing here is counted
 * client-side.
 */
export function PartialBanner({
  importedAds, quarantined, reasons, testId = "partial-banner",
}: {
  importedAds: number;
  quarantined: number;
  /** Server-supplied reason → count. Rendered verbatim when present. */
  reasons?: Record<string, number> | null;
  testId?: string;
}) {
  const detail = reasons && Object.keys(reasons).length
    ? Object.entries(reasons).map(([reason, n]) => `${reason} ${n}`).join(" · ")
    : null;

  return (
    <div role="status" className={styles.banner} data-testid={testId}>
      <strong className={styles.title}>
        รอบนี้นำเข้าได้บางส่วน — บันทึกสำเร็จ {importedAds} โฆษณา · กันไว้ตรวจ {quarantined} แถว
      </strong>
      <p className={styles.body}>
        แถวที่กันไว้ตรวจยังไม่ถูกนำเข้า ตัวเลขและสัดส่วนทั้งหมดในหน้านี้จึงนับจาก {importedAds} โฆษณาที่นำเข้าสำเร็จเท่านั้น
        {detail ? <> · สาเหตุ: {detail}</> : null}
      </p>
    </div>
  );
}
