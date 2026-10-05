import "server-only";
import type { OwnedMedia } from "./media-cache.ts";

/**
 * Sharp pictures and playable video for our ads, straight from Meta with a read token.
 *
 * The hosted site has no access to the Ads Management machine, so it uses its own token
 * (META_READ_TOKEN). Nothing is stored: Meta returns short-lived links and the browser plays the
 * video from Meta. When the video file itself is not readable, Meta's official ad preview iframe
 * is returned instead (validated URL only, never raw HTML).
 */

const VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
export const metaReadConfigured = () => Boolean(process.env.META_READ_TOKEN);

type Item = { account_id: string; ad_id: string; creative_id?: string | null; video_id?: string | null };

async function graph(id: string | null | undefined, fields: string, params: Record<string, string> = {}, edge = ""): Promise<Record<string, unknown> | null> {
  if (!id || !/^[\d_]+$/.test(id) || (edge && edge !== "previews")) return null;
  const url = new URL(`https://graph.facebook.com/${VERSION}/${id}${edge ? `/${edge}` : ""}`);
  url.searchParams.set("fields", fields);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.META_READ_TOKEN}` }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

/** https only, and never a link that carries a token. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.searchParams.has("access_token") && !url.username && !url.password ? value : null;
  } catch { return null; }
}

/** The iframe src from Meta's preview HTML, accepted only for Facebook's own preview endpoint. */
export function previewSource(html: unknown): string | null {
  const src = typeof html === "string" ? html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]?.replaceAll("&amp;", "&") : null;
  const url = safeUrl(src);
  if (!url) return null;
  const parsed = new URL(url);
  return ["www.facebook.com", "business.facebook.com"].includes(parsed.hostname) && parsed.pathname === "/ads/api/preview_iframe.php" && !parsed.port ? url : null;
}

async function one(item: Item, includeVideo: boolean): Promise<OwnedMedia> {
  const creativeId = item.creative_id ?? ((await graph(item.ad_id, "creative"))?.creative as { id?: string } | undefined)?.id ?? null;
  const large = await graph(creativeId, "thumbnail_url", { thumbnail_width: "1080", thumbnail_height: "1080" });
  let image = safeUrl(large?.thumbnail_url);
  let videoId = item.video_id ?? null;
  if (!image || (includeVideo && !videoId)) {
    const creative = await graph(creativeId, "image_url,video_id,object_story_spec");
    const spec = creative?.object_story_spec as { photo_data?: { url?: string }; link_data?: { picture?: string }; video_data?: { video_id?: string } } | undefined;
    image ??= safeUrl(creative?.image_url) ?? safeUrl(spec?.photo_data?.url) ?? safeUrl(spec?.link_data?.picture);
    videoId ??= (creative?.video_id as string | undefined) ?? spec?.video_data?.video_id ?? null;
  }
  const media: OwnedMedia = { account_id: item.account_id, ad_id: item.ad_id, url: image, video_id: videoId };
  if (includeVideo && videoId) {
    media.video_url = safeUrl((await graph(videoId, "source"))?.source);
    if (!media.video_url) {
      const preview = await graph(item.ad_id, "body", { ad_format: "MOBILE_FEED_STANDARD" }, "previews");
      media.video_preview_url = previewSource((preview?.data as { body?: string }[] | undefined)?.[0]?.body);
    }
  }
  return media;
}

/** Four at a time, like the local bridge: only the ads on screen, never a sweep. */
export async function resolveWithToken(items: Item[], includeVideo: boolean): Promise<OwnedMedia[]> {
  const out: OwnedMedia[] = [];
  for (let offset = 0; offset < items.length; offset += 4) out.push(...await Promise.all(items.slice(offset, offset + 4).map((item) => one(item, includeVideo))));
  return out;
}
