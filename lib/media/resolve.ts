import { mediaPresentation, type Media, type MediaPresentation } from "../media.ts";

/**
 * What the UI should render for one observation, archive first.
 *
 * The resolution order, and why:
 *
 *   archived preview  → our own bytes, which do not expire
 *   safe source URL   → the collector's URL, good for about four days
 *   truthful state    → none / unusable, said plainly
 *
 * Components never learn that `media_assets` exists. They receive a rendered
 * decision, which is what lets the archive land behind them without a single
 * component changing shape.
 */

export type ResolvedMedia =
  | { state: "archived"; src: string; kind: "image" | "video" }
  | { state: "source"; src: string; kind: "image" | "video" }
  | { state: "unusable"; entries: number }
  | { state: "none" };

/**
 * What each state means, in the words a reader gets.
 *
 * Written once because it was written three times — the card, the row and the
 * drawer each carried their own copy, which is how three surfaces come to
 * describe the same row differently.
 *
 * `unusable` used to read "ไม่สามารถแสดงตัวอย่างสื่อ", which says we failed.
 * We did not: these are CAROUSEL, DPA and DCO ads whose cards carry video
 * links and no still, so there was never an image to keep. Measured at 3–4% of
 * a real collection. The fact belongs to the ad, and the sentence should say so.
 */
export const MEDIA_STATE_MESSAGE = {
  /** The collector recorded no media at all for this observation. */
  none: "ไม่มีสื่อที่บันทึกไว้",
  /** Media exists, but none of it is a still we could archive. */
  unusable: "โฆษณาแบบนี้ไม่มีภาพนิ่งให้เก็บ",
  /** An archived object cannot expire; only a source URL can. */
  expired: "สื่อต้นทางหมดอายุ",
} as const;

export type ArchiveReference = {
  archivePath: string | null;
  archiveStatus: string | null;
  /** Turns a storage path into a short-lived delivery URL. */
  presentationUrl?: string | null;
};

/**
 * `displayFormat` decides what the AD is; the archived file decides what to put
 * in the `src`. A VIDEO ad whose durable preview is a JPEG poster is still a
 * video ad — keeping those two facts apart is the semantic fix C1 identified and
 * this is where it lands.
 */
export function resolveMedia(
  displayFormat: string | null,
  media: Media,
  archive: ArchiveReference | null,
): ResolvedMedia {
  const adKind = (displayFormat ?? "").toUpperCase() === "VIDEO" ? "video" : "image";

  if (archive?.archiveStatus === "archived" && archive.presentationUrl) {
    return { state: "archived", src: archive.presentationUrl, kind: adKind };
  }

  // No archive yet, or the delivery URL could not be minted. The source is still
  // worth trying — it may simply be a dataset imported minutes ago whose drain
  // has not run.
  const presentation: MediaPresentation = mediaPresentation(media);
  if (presentation.state === "ready") {
    const primary = presentation.primary;
    const src = primary.kind === "video" ? primary.poster ?? primary.src : primary.src;
    return { state: "source", src, kind: adKind };
  }
  if (presentation.state === "unusable") {
    return { state: "unusable", entries: presentation.entries };
  }
  return { state: "none" };
}
