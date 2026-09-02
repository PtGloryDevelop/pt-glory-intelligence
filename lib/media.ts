/**
 * Media URLs out of an observation's stored JSON.
 *
 * The uploaded export is untrusted input that reaches an `src`, so the scheme is
 * checked rather than assumed: a `javascript:` or `data:` value here would be a
 * URL the page executes instead of an image it loads.
 *
 * One definition, shared by the drawer and the explorer grid, because two copies
 * of a URL filter is how one of them ends up missing a scheme.
 */

export type Media = { images?: unknown[]; videos?: unknown[]; cards?: unknown[] } | null;

export function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Every loadable URL in the observation, images first. */
export function mediaUrls(media: Media): string[] {
  return [...(media?.images ?? []), ...(media?.videos ?? []), ...(media?.cards ?? [])]
    .flatMap((item) => {
      const record = item as Record<string, unknown>;
      const url = record?.url ?? record?.previewUrl ?? record?.thumbnailUrl;
      return typeof url === "string" && isHttpUrl(url) ? [url] : [];
    });
}
