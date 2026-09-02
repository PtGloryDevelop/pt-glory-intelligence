"use client";

import { useEffect, useState } from "react";
import { dash } from "./explorer";

type Detail = {
  context: "dataset" | "master";
  ad_archive_id: string; page_id: string; page_name: string | null;
  page_profile_uri: string | null; page_like_count: number | null;
  page_categories: string[] | null; start_date: string; end_date: string | null;
  first_seen_at: string; last_seen_at: string; ad_age_days: number;
  is_active: boolean | null; display_format: string | null;
  publisher_platform: string[] | null; cta_type: string | null; cta_text: string | null;
  title: string | null; body_text: string | null; caption: string | null;
  link_url: string | null; link_description: string | null; collation_count: number | null;
  media: { images?: unknown[]; videos?: unknown[]; cards?: unknown[] } | null;
  observed_at: string | null;
};
type History = {
  observed_at: string; collection_run_id: string; collection_method: string;
  is_active: boolean | null; display_format: string | null;
  publisher_platform: string[] | null; cta_type: string | null; collation_count: number | null;
};

export function AdDrawer({ adArchiveId, datasetId, onClose }: {
  adArchiveId: string; datasetId: string | null; onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "missing" } | { status: "ready"; detail: Detail; history: History[] }
  >({ status: "loading" });

  useEffect(() => {
    let live = true;
    const query = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : "";
    fetch(`/api/ads/${encodeURIComponent(adArchiveId)}${query}`)
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) { setState({ status: "missing" }); return; }
        const payload = await response.json();
        setState({ status: "ready", detail: payload.detail, history: payload.history ?? [] });
      })
      .catch(() => { if (live) setState({ status: "missing" }); });
    return () => { live = false; };
  }, [adArchiveId, datasetId]);

  return (
    <aside
      role="dialog" aria-label="รายละเอียดโฆษณา" data-testid="ad-drawer"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)",
        overflowY: "auto", background: "var(--cream, #fdfaf3)",
        borderLeft: "1px solid rgba(0,0,0,.12)", padding: 20, zIndex: 20,
      }}
    >
      <button type="button" data-testid="drawer-close" onClick={onClose} style={{ minHeight: 44 }}>
        ปิด
      </button>

      {state.status === "loading" ? <p role="status">กำลังโหลด…</p> : null}
      {state.status === "missing" ? (
        <p role="status" data-testid="drawer-not-found">
          ไม่พบโฆษณานี้ในชุดข้อมูลนี้ — ระบบไม่แสดงค่าล่าสุดแทน เพราะจะทำให้อ่านผิดว่าเป็นข้อมูลของรอบนั้น
        </p>
      ) : null}

      {state.status === "ready" ? (
        <Body detail={state.detail} history={state.history} />
      ) : null}
    </aside>
  );
}

function Body({ detail, history }: { detail: Detail; history: History[] }) {
  return (
    <div>
      <h2>{detail.ad_archive_id}</h2>
      <p data-testid="drawer-context">
        {detail.context === "dataset"
          ? "สถานะตามรอบเก็บของชุดข้อมูลนี้"
          : "สถานะล่าสุดจากทุกรอบ"}
      </p>

      <Media media={detail.media} />

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
        <Row label="เพจ" value={detail.page_name} testId="drawer-page-name" />
        <Row label="page_id" value={detail.page_id} />
        <Row label="ลิงก์เพจ" value={detail.page_profile_uri} />
        <Row label="ผู้ติดตามเพจ" value={detail.page_like_count} />
        <Row label="หมวดเพจ" value={detail.page_categories} />
        <Row label="สถานะ" value={detail.is_active === null ? null : detail.is_active ? "Active" : "Inactive"}
          testId="drawer-active" />
        <Row label="รูปแบบ" value={detail.display_format} testId="drawer-format" />
        <Row label="แพลตฟอร์ม" value={detail.publisher_platform} testId="drawer-platform" />
        <Row label="CTA" value={detail.cta_type} />
        <Row label="ข้อความปุ่ม" value={detail.cta_text} />
        <Row label="หัวเรื่อง" value={detail.title} />
        <Row label="ข้อความ" value={detail.body_text} />
        <Row label="แคปชัน" value={detail.caption} />
        <Row label="ลิงก์ปลายทาง" value={detail.link_url} />
        <Row label="คำอธิบายลิงก์" value={detail.link_description} />
        <Row label="เริ่มแสดง" value={detail.start_date} />
        <Row label="สิ้นสุด" value={detail.end_date} />
        <Row label="พบครั้งแรก" value={detail.first_seen_at} />
        <Row label="พบครั้งล่าสุด" value={detail.last_seen_at} />
        <Row label="อายุโฆษณา (วัน)" value={detail.ad_age_days} />
        <Row label="ชุดครีเอทีฟ" value={detail.collation_count} />
        <Row label="สังเกตเมื่อ" value={detail.observed_at} />
      </dl>

      <h3>ประวัติการสังเกต</h3>
      {history.length === 0 ? (
        <p>—</p>
      ) : (
        <table data-testid="observation-history">
          <thead>
            <tr><th>สังเกตเมื่อ</th><th>รอบเก็บ</th><th>สถานะ</th><th>รูปแบบ</th><th>CTA</th><th>ชุดครีเอทีฟ</th></tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={`${row.collection_run_id}-${row.observed_at}`}>
                <td>{row.observed_at}</td>
                <td title={row.collection_run_id}>{row.collection_method}</td>
                <td>{row.is_active === null ? "ไม่ทราบ" : row.is_active ? "Active" : "Inactive"}</td>
                <td>{dash(row.display_format)}</td>
                <td>{dash(row.cta_type)}</td>
                <td>{dash(row.collation_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: unknown; testId?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{dash(value)}</dd>
    </>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Media lives on Meta's CDN and its URLs expire, so a broken image is normal, not an error state. */
function Media({ media }: { media: Detail["media"] }) {
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const urls = [...(media?.images ?? []), ...(media?.videos ?? []), ...(media?.cards ?? [])]
    .flatMap((item) => {
      const record = item as Record<string, unknown>;
      const url = record?.url ?? record?.previewUrl ?? record?.thumbnailUrl;
      // The uploaded JSON is untrusted: a `javascript:` or `data:` value here
      // would be a URL the page executes rather than an image it loads.
      return typeof url === "string" && isHttpUrl(url) ? [url] : [];
    });

  if (urls.length === 0) {
    return <p data-testid="media-placeholder">ไม่มีสื่อที่บันทึกไว้สำหรับโฆษณานี้</p>;
  }

  return (
    <div data-testid="media-strip" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {urls.map((url, index) =>
        broken[index] ? (
          <span key={url} data-testid="media-unavailable"
            style={{ padding: 12, border: "1px dashed rgba(0,0,0,.3)" }}>
            สื่อโหลดไม่ได้ (ลิงก์จากต้นทางหมดอายุ)
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader
          <img
            key={url} src={url} alt="" width={160} loading="lazy"
            onError={() => setBroken((current) => ({ ...current, [index]: true }))}
          />
        ),
      )}
    </div>
  );
}
