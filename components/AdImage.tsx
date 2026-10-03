"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { canOptimizeAdImage } from "@/lib/media";

type Props = Omit<ImageProps, "src" | "width" | "height" | "fill" | "quality" | "loader" | "unoptimized"> & {
  src: string;
  original?: boolean;
};

/** Fixed creative slots use Next's existing Sharp resize/cache, without cropping. */
export function AdImage({ src, alt, original = false, sizes = "(max-width: 700px) calc(100vw - 40px), 384px", onError, ...props }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  // Private signed archives stay direct: a public optimizer cache must not extend their access.
  // ponytail: originals on detail/unsupported hosts; add archive-time variants if measured archive traffic warrants it.
  if (original || failed === src || !canOptimizeAdImage(src)) {
    // eslint-disable-next-line @next/next/no-img-element -- preserve originals, private delivery and optimizer-error fallback
    return <img {...props} src={src} alt={alt} loading={props.loading ?? "lazy"} decoding="async" onError={onError} />;
  }
  return <Image {...props} src={src} alt={alt} fill sizes={sizes} quality={85} onError={() => setFailed(src)} />;
}
