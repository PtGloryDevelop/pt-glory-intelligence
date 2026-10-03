"use client";

import { useEffect, useState } from "react";
import type { CompanyAd } from "@/lib/owned-ads/source-rows";
import { Creative } from "./owned-client";
import styles from "./owned-ads.module.css";

/** Resolve only the selected ad; grids never download video files or previews. */
export function OwnedVideoPlayer({ ad, url, mediaLoading = false, autoLoad = false }: { ad: CompanyAd; url: string | null; mediaLoading?: boolean; autoLoad?: boolean }) {
  const [requested, setRequested] = useState(autoLoad);
  const [video, setVideo] = useState<{ key: string; url: string | null; preview: string | null; error: boolean } | null>(null);
  const key = `${ad.account_id}:${ad.ad_id}`;
  const current = video?.key === key ? video : null;
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    fetch('/api/owned-ads/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ account_id: ad.account_id, ad_id: ad.ad_id }], video: true }), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Media unavailable');
        const result = await response.json();
        if (!controller.signal.aborted) setVideo({ key: `${ad.account_id}:${ad.ad_id}`, url: result.items?.[0]?.video_url ?? null, preview: result.items?.[0]?.video_preview_url ?? null, error: false });
      }).catch(() => {
        if (!controller.signal.aborted) setVideo({ key: `${ad.account_id}:${ad.ad_id}`, url: null, preview: null, error: true });
      });
    return () => controller.abort();
  }, [ad.account_id, ad.ad_id, requested]);
  return <div className={styles.videoPlayer}>
    {current?.preview && !current.url ? <div className={styles.videoPreview}>
      <p>พรีวิววิดีโอจาก Meta · กด ▶ เพื่อเล่น</p>
      <iframe src={current.preview} title={`วิดีโอ ${ad.ad_name}`} data-testid="owned-video-preview" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" />
    </div> : <Creative url={url} videoUrl={current?.url} name={ad.ad_name} mediaLoading={mediaLoading} detail />}
    {!requested && ad.video_id ? <button type="button" className={styles.watchVideo} onClick={() => setRequested(true)}>▶ ดูวิดีโอ</button> : null}
    {requested && ad.video_id && !current ? <p className={styles.videoMessage} role="status">กำลังโหลดวิดีโอ…</p> : null}
    {requested && (ad.video_id || current?.error) && current && !current.url && !current.preview ? <p className={styles.videoMessage} role="status">ยังเปิดวิดีโอจากต้นทางไม่ได้ แสดงภาพตัวอย่างไว้ก่อน ลองเปิดรายละเอียดอีกครั้ง</p> : null}
  </div>;
}
