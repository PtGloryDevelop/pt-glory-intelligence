/**
 * What the ad IS, for display.
 *
 * Read from `display_format` and never from the archived file's type: a VIDEO
 * ad whose durable preview is a JPEG poster is still a video ad. The card, the
 * table thumbnail and the drawer each had their own copy of this rule before
 * V5 — three places to disagree about the same fact.
 */
export type FormatIdentity = { label: string; isVideo: boolean };

const LABELS: Record<string, string> = {
  VIDEO: "Video",
  IMAGE: "Image",
  MULTI_IMAGES: "Images",
  CAROUSEL: "Carousel",
  DCO: "DCO",
};

/** null when the observation carried no format at all — unknown, not "Image". */
export function formatIdentity(displayFormat: string | null): FormatIdentity | null {
  const format = (displayFormat ?? "").toUpperCase();
  if (!format) return null;
  return { label: LABELS[format] ?? format, isVideo: format === "VIDEO" };
}
