"use client";

import { useEffect, useState } from "react";

/** GET JSON for a URL (null = nothing to load). Keeps the last good data while a new URL loads; errors belong to the URL that failed. */
export function useJson<T>(url: string | null, retry = 0): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "เปิดข้อมูลไม่สำเร็จ");
      if (!controller.signal.aborted) setState({ url, data: body as T, error: null });
    }).catch((failure: Error) => {
      if (!controller.signal.aborted && failure.name !== "AbortError") setState(previous => ({ url, data: previous?.data ?? null, error: failure.message }));
    });
    return () => controller.abort();
  }, [url, retry]);
  if (!url) return { data: null, error: null, loading: false };
  return { data: state?.data ?? null, error: state?.url === url ? state.error : null, loading: state?.url !== url };
}
