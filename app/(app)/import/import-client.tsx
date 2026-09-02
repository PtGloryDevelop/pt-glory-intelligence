"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QualityBadge } from "@/components/QualityBadge";
import { ErrorState } from "@/components/states/ErrorState";

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
type Phase = "idle" | "validating" | "preview" | "committing" | "success" | "rejected" | "failed";

const FIELD = { display: "grid", gap: 6, marginBottom: 12 } as const;

export function ImportClient({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [datasetName, setDatasetName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<{ reason: string; detail: string } | null>(null);

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
    setPhase("success");
    router.push(`/datasets/${payload.datasetId}`);
  }

  return (
    <div data-testid="import-surface">
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

      <div style={FIELD}>
        <label htmlFor="file">ไฟล์ JSON จาก Extension</label>
        <input
          id="file" data-testid="file-input" type="file" accept="application/json"
          onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPhase("idle"); setPreview(null); }}
        />
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

      {preview && (phase === "preview" || phase === "committing" || phase === "success") ? (
        <section data-testid="preview-panel" style={{ marginTop: 20 }}>
          <h2>ผลการตรวจ (ยังไม่บันทึกลงฐานข้อมูล)</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
            <dt>ไฟล์</dt><dd data-testid="preview-filename">{preview.fileName}</dd>
            <dt>คำค้น</dt><dd>{preview.scope.query ?? "—"}</dd>
            <dt>ประเทศ</dt><dd>{preview.scope.country ?? "—"}</dd>
            <dt>วิธีเก็บ</dt><dd data-testid="preview-method">{preview.scope.collectionMethod}</dd>
            <dt>เก็บเมื่อ</dt><dd>{preview.scope.collectedAt}</dd>
            <dt>Ads</dt><dd data-testid="preview-ads">{preview.counts.ads}</dd>
            <dt>Pages</dt><dd data-testid="preview-pages">{preview.counts.pages}</dd>
            <dt>เคยมีอยู่แล้ว</dt><dd data-testid="preview-existing">{preview.counts.existingAds}</dd>
            <dt>ใหม่</dt><dd data-testid="preview-new">{preview.counts.newAds}</dd>
            <dt>กันไว้ตรวจ (quarantine)</dt><dd data-testid="preview-quarantine">{preview.counts.quarantine}</dd>
          </dl>

          <h3>ตัวเลขที่ collector รายงาน เทียบกับที่เซิร์ฟเวอร์นับเอง</h3>
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
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            ตัวเลขของระบบคือคอลัมน์ขวา · ถ้าสองฝั่งไม่ตรงกัน เซิร์ฟเวอร์จะปฏิเสธไฟล์ตั้งแต่ขั้นตรวจ
          </p>

          {preview.willBePartial ? (
            <p role="status" data-testid="partial-warning">
              มีแถวที่นำเข้าไม่ได้ {preview.counts.quarantine} แถว
              ({Object.entries(preview.counts.quarantineReasons).map(([reason, n]) => `${reason} ${n}`).join(" · ")})
              — แถวที่เหลือยังนำเข้าได้ และรอบนี้จะถูกบันทึกเป็นสถานะ <strong>partial</strong>
            </p>
          ) : null}

          <h3>ความครอบคลุมของข้อมูล</h3>
          <CoverageTable rows={preview.coverage} />

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

export function CoverageTable({ rows }: { rows: Coverage[] }) {
  return (
    <table data-testid="coverage-table">
      <thead>
        <tr><th>ฟิลด์</th><th>พบ / ทั้งหมด</th><th>สัดส่วน</th><th>ระดับ</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field} data-testid={`coverage-${row.field}`}>
            <td>{row.field}</td>
            {/* A percentage without its denominator is not a fact anyone can check. */}
            <td>{row.presentCount} / {row.totalCount}</td>
            <td>{(row.coverage * 100).toFixed(1)}%</td>
            <td>
              <QualityBadge tier={row.tier} />
              {row.tier === "low" ? (
                <span
                  data-testid={`warning-${row.field}`}
                  title="ต่ำกว่า 50% — อ้างผลรวมทั้งชุดไม่ได้"
                  style={{ color: "var(--muted)", fontSize: "var(--fs-meta)" }}
                > ใช้ได้เฉพาะส่วนที่อ่านได้</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
