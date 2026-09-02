import styles from "./ImportStepper.module.css";

/**
 * A view over the import phase the client already has. It introduces no state
 * of its own and no progress percentage — the import has five discrete steps
 * and no measurable fraction between them, so an animated bar would be a
 * decoration pretending to be information.
 */

export type ImportPhase =
  | "idle" | "validating" | "preview" | "committing"
  | "success" | "partial" | "rejected" | "failed";

const STEPS = [
  { key: "upload", label: "เลือกไฟล์" },
  { key: "validate", label: "ตรวจไฟล์" },
  { key: "preview", label: "ดูผลตรวจ" },
  { key: "confirm", label: "ยืนยันบันทึก" },
  { key: "done", label: "เสร็จสิ้น" },
] as const;

/** Which step each real phase is standing on. */
const AT: Record<ImportPhase, number> = {
  idle: 0, validating: 1, preview: 2, committing: 3,
  success: 4, partial: 4,
  // A rejected file failed validation; a failed commit failed at the commit.
  rejected: 1, failed: 3,
};

const BROKEN: ImportPhase[] = ["rejected", "failed"];

export function ImportStepper({ phase }: { phase: ImportPhase }) {
  const at = AT[phase];
  const broken = BROKEN.includes(phase);

  return (
    <ol className={styles.stepper} data-testid="import-stepper" data-phase={phase}>
      {STEPS.map((step, index) => {
        const state = index === at ? (broken ? "error" : "current")
          : index < at ? "done"
          : "todo";
        return (
          <li key={step.key} className={styles[state]} data-testid={`step-${step.key}`} data-state={state}>
            <span className={styles.mark} aria-hidden>
              {state === "done" ? "✓" : state === "error" ? "!" : index + 1}
            </span>
            <span className={styles.label}>{step.label}</span>
            {/* The state is in the text too, never in the colour alone. */}
            <span className={styles.sr}>
              {state === "done" ? " (เสร็จแล้ว)" : state === "current" ? " (กำลังทำ)"
                : state === "error" ? " (มีปัญหา)" : " (ยังไม่ถึง)"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
