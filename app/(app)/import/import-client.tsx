"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImportStepper, type ImportPhase } from "@/components/ImportStepper";
import { KPIRow, KPIStat } from "@/components/KPIStat";
import { PartialBanner } from "@/components/PartialBanner";
import { QualityStrip, type QualityItem } from "@/components/QualityStrip";
import { ErrorState } from "@/components/states/ErrorState";
import styles from "./import.module.css";

type Coverage = { field: string; presentCount: number; totalCount: number; coverage: number; tier: string };
type Counts = {
  ads: number; pages: number; quarantine: number;
  quarantineReasons: Record<string, number>; existingAds: number; newAds: number;
};
type Preview = {
  fileName: string;
  scope: { query: string | null; country: string | null; collectionMethod: string; collectedAt: string; sourceProduct: string };
  reported: Record<string, number>;
  computed: Record<string, number>;
  counts: Counts;
  coverage: Coverage[];
  willBePartial: boolean;
};

const FIELD = { display: "grid", gap: 6, marginBottom: 12 } as const;

export function ImportClient({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [datasetName, setDatasetName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<{ reason: string; detail: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function take(next: File | null) {
    setFile(next);
    setPhase("idle");
    setPreview(null);
    setProblem(null);
  }

  async function runPreview() {
    if (!file) return;
    setPhase("validating");
    setProblem(null);
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/imports/preview", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) {
      setProblem({ reason: payload.reason ?? "error", detail: payload.detail ?? payload.error ?? "" });
      setPhase("rejected");
      return;
    }
    setPreview(payload);
    setDatasetName((current) => current || payload.fileName.replace(/\.json$/i, ""));
    setPhase("preview");
  }

  async function commit() {
    if (!file) return;
    setPhase("committing");
    const body = new FormData();
    body.append("file", file);
    body.append("categoryId", categoryId);
    body.append("datasetName", datasetName);
    const response = await fetch("/api/imports/commit", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) {
      setProblem({
        reason: payload.reason ?? String(response.status),
        detail: payload.detail ?? payload.error ?? "",
      });
      setPhase(response.status === 422 ? "rejected" : "failed");
      return;
    }
    // The run's own status decides this, not the preview's guess.
    setPhase(payload.status === "partial" ? "partial" : "success");
    router.push(`/datasets/${payload.datasetId}`);
  }

  const showPreview = preview
    && (phase === "preview" || phase === "committing" || phase === "success" || phase === "partial");

  return (
    <div data-testid="import-surface">
      <ImportStepper phase={phase} />

      <div style={FIELD}>
        <label htmlFor="category">หมวดหมู่</label>
        <select
          id="category" data-testid="category-select" value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          style={{ minHeight: 44 }}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>

      {/*
        Drop zone presentation over the same native input. The input is still a
        real <input type="file"> in the DOM, so the file dialog, keyboard access
        and the existing upload path are all unchanged.
      */}
      <div
        className={`${styles.drop} ${dragging ? styles.dropActive : ""}`}
        data-testid="file-dropzone"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className={styles.dropTitle}>ลากไฟล์ JSON มาวางที่นี่</div>
        <div className={styles.dropHint}>หรือกดเพื่อเลือกไฟล์จากเครื่อง · ไฟล์จาก PT Glory Extension เท่านั้น</div>
        <label htmlFor="file" className={styles.dropLabel}>ไฟล์ JSON จาก Extension</label>
        <input
          id="file" ref={inputRef} data-testid="file-input" type="file" accept="application/json"
          className={styles.dropInput}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => take(event.target.files?.[0] ?? null)}
        />
        {file ? <div className={styles.dropFile} data-testid="chosen-file">{file.name}</div> : null}
      </div>

      <button
        type="button" data-testid="preview-button" disabled={!file || phase === "validating"}
        onClick={runPreview} style={{ minHeight: 44 }}
      >
        {phase === "validating" ? "กำลังตรวจไฟล์…" : "ตรวจไฟล์ก่อนบันทึก"}
      </button>

      {phase === "rejected" || phase === "failed" ? (
        <ErrorState
          testId="import-error"
          title={`ไฟล์ถูกปฏิเสธ: ${problem?.reason}`}
          detail={problem?.detail}
        />
      ) : null}

      {showPreview && preview ? (
        <section data-testid="preview-panel" style={{ marginTop: 20 }}>
          <h2>ผลการตรวจ (ยังไม่บันทึกลงฐานข้อมูล)</h2>

          {/* Server-computed counts only. The component does no arithmetic. */}
          <KPIRow testId="preview-stats">
            <KPIStat label="Ads" value={<span data-testid="preview-ads">{preview.counts.ads}</span>} />
            <KPIStat label="Pages" value={<span data-testid="preview-pages">{preview.counts.pages}</span>} />
            <KPIStat label="ใหม่ / เคยมีอยู่แล้ว"
              value={<span data-testid="preview-new">{preview.counts.newAds}</span>}
              helper={<>เคยมีอยู่แล้ว <span data-testid="preview-existing">{preview.counts.existingAds}</span></>} />
            <KPIStat label="กันไว้ตรวจ"
              value={<span data-testid="preview-quarantine">{preview.counts.quarantine}</span>}
              helper="แถวที่นำเข้าไม่ได้" />
          </KPIRow>

          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
            <dt>ไฟล์</dt><dd data-testid="preview-filename">{preview.fileName}</dd>
            <dt>คำค้น</dt><dd>{preview.scope.query ?? "—"}</dd>
            <dt>ประเทศ</dt><dd>{preview.scope.country ?? "—"}</dd>
            <dt>วิธีเก็บ</dt><dd data-testid="preview-method">{preview.scope.collectionMethod}</dd>
            <dt>เก็บเมื่อ</dt><dd>{preview.scope.collectedAt}</dd>
          </dl>

          <h3>ตัวเลขที่ collector รายงาน เทียบกับที่เซิร์ฟเวอร์นับเอง</h3>
          <div style={{ overflowX: "auto" }}>
            <table data-testid="counts-table">
              <thead><tr><th>ฟิลด์</th><th>collector รายงาน</th><th>เซิร์ฟเวอร์นับได้</th></tr></thead>
              <tbody>
                {Object.keys(preview.computed).map((key) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{preview.reported[key]}</td>
                    <td><strong>{preview.computed[key]}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            ตัวเลขของระบบคือคอลัมน์ขวา · ถ้าสองฝั่งไม่ตรงกัน เซิร์ฟเวอร์จะปฏิเสธไฟล์ตั้งแต่ขั้นตรวจ
          </p>

          {preview.willBePartial ? (
            <PartialBanner
              testId="partial-warning"
              importedAds={preview.counts.ads}
              quarantined={preview.counts.quarantine}
              reasons={preview.counts.quarantineReasons}
            />
          ) : null}

          <h3>ความครอบคลุมของข้อมูล</h3>
          <QualityStrip
            testId="coverage-table"
            rowPrefix="coverage"
            warningPrefix="warning"
            rows={preview.coverage as QualityItem[]}
          />

          <div style={FIELD}>
            <label htmlFor="dataset-name">ชื่อชุดข้อมูล</label>
            <input
              id="dataset-name" data-testid="dataset-name" value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)} style={{ minHeight: 44 }}
            />
          </div>

          <button
            type="button" data-testid="commit-button" data-variant="primary"
            disabled={phase === "committing" || !datasetName || !categoryId}
            onClick={commit} style={{ minHeight: 48 }}
          >
            {phase === "committing" ? "กำลังบันทึก…" : "ยืนยันและบันทึก"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
