"use client";

import { useEffect, useRef, useState } from "react";

/** One quiet retry: a read that timed out on a cold database cache usually succeeds once the cache is warm. */
const RETRY_AFTER = 1500;

/** GET JSON for a URL (null = nothing to load). Keeps the last good data while a new URL loads; errors belong to the URL that failed.
 * `initial` is the same URL already read by the server with the page: its first fetch is skipped, later ones are not. */
export function useJson<T>(url: string | null, retry = 0, initial?: { url: string; data: T }): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null } | null>(initial ? { ...initial, error: null } : null);
  const skipFetch = useRef(initial?.url ?? null);
  useEffect(() => {
    if (!url) return;
    if (skipFetch.current === url && retry === 0) { skipFetch.current = null; return; }
    skipFetch.current = null;
    const controller = new AbortController();
    const load = async (attempt: number): Promise<void> => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error(body.error ?? "เปิดข้อมูลไม่สำเร็จ"), { status: response.status });
        if (!controller.signal.aborted) setState({ url, data: body as T, error: null });
      } catch (failure) {
        const error = failure as Error & { status?: number };
        if (controller.signal.aborted || error.name === "AbortError") return;
        // Only a server-side failure is worth a second try; a 4xx answer will not change.
        if (attempt === 0 && (error.status == null || error.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, RETRY_AFTER));
          if (!controller.signal.aborted) return load(1);
          return;
        }
        setState(previous => ({ url, data: previous?.data ?? null, error: error.message }));
      }
    };
    void load(0);
    return () => controller.abort();
  }, [url, retry]);
  if (!url) return { data: null, error: null, loading: false };
  return { data: state?.data ?? null, error: state?.url === url ? state.error : null, loading: state?.url !== url };
}
