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
 * the runtime behaviour is identical, and the two call sites are both in this
 * directory.
 *
 * Returns `[image, status]`, status one of "loading" | "loaded" | "failed".
 */
export function useImage(src, crossOrigin = "anonymous") {
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!src) {
      setImage(null);
      setStatus("loading");
      return undefined;
    }
    let cancelled = false;
    const img = new window.Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setStatus("loaded");
    };
    img.onerror = () => {
      if (cancelled) return;
      setImage(null);
      setStatus("failed");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, crossOrigin]);

  return [image, status];
}
