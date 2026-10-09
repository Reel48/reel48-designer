"use client";

import { useEffect, useState } from "react";

/**
 * Load an HTMLImageElement for use as a Konva image source.
 *
 * `crossOrigin="anonymous"` keeps the canvas UN-TAINTED so `stage.toBlob()`
 * works — a tainted canvas throws on export, and the export is the proof the
 * buyer approves and the factory prints from. For same-origin `blob:` object
 * URLs (a freshly uploaded logo) it is a no-op, which is what we want during
 * the editing session; pass `null` for those.
 *
 * Ported from Reel48-Storefront/src/hooks/useImage.ts. It lost its TypeScript
 * types in the move because this package ships plain ESM with no build step —
 * image state is now keyed to its source, so replacements cannot flash stale
 * artwork. A stalled load becomes a failure after 15 seconds.
 *
 * Returns `[image, status]`, status one of "loading" | "loaded" | "failed".
 */
export function useImage(src, crossOrigin = "anonymous") {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!src) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    const img = new window.Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setResult({ src, crossOrigin, image: null, status: "failed" });
    }, 15000);
    img.onload = () => {
      if (cancelled) return;
      clearTimeout(timer);
      cancelled = true;
      setResult({ src, crossOrigin, image: img, status: "loaded" });
    };
    img.onerror = () => {
      if (cancelled) return;
      clearTimeout(timer);
      cancelled = true;
      setResult({ src, crossOrigin, image: null, status: "failed" });
    };
    img.src = src;
    return () => {
      cancelled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [src, crossOrigin]);

  // Never expose the previous source for even one render after a replacement.
  return result && result.src === src && result.crossOrigin === crossOrigin
    ? [result.image, result.status]
    : [null, "loading"];
}
