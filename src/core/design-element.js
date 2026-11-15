// One design element, rebuilt field by field: the storefront's server-side
// check of a posted or shared element (Reel48-Storefront src/lib/design-import.js
// `element` and MAX_SHARED_ELEMENTS, origin/main d78d90ee), moved here so the
// hub prices a hat from exactly the elements the storefront's hat-submit.ts
// would have kept. Logic unchanged; only its imports moved.

import { ACCEPTED_MIME } from "./coozie-config.js";

/** The most elements a design may hold (a shared design, a posted hat design). */
export const MAX_SHARED_ELEMENTS = 40;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} n @returns {n is number} */
function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** @type {(n: unknown, lo: number, hi: number, fallback: number) => number} */
const clamp = (n, lo, hi, fallback) => (finite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);
const HEX = /^#[0-9a-f]{6}$/i;
const FONT_STYLES = ["normal", "bold", "italic", "bold italic", "italic bold"];
const ALIGNS = ["left", "center", "right"];
const CLIP_FACES = ["front", "back", "base"];

/**
 * One element, rebuilt field by field from what the designer itself writes
 * (toDesignDescription), never copied: anything else in the file is dropped,
 * and every field is the type the designer draws with. Null when it is not
 * an element the designer would have made.
 *
 * @param {unknown} el
 * @returns {Record<string, unknown> | null}
 */
export function element(el) {
  if (!isObject(el) || typeof el.id !== "string" || !/^[\w-]{1,100}$/.test(el.id)) return null;
  if (!finite(el.x) || !finite(el.y)) return null;
  const base = {
    id: el.id,
    type: el.type,
    x: clamp(el.x, 0, 1, 0.5),
    y: clamp(el.y, 0, 1, 0.5),
    rotation: clamp(el.rotation, -3600, 3600, 0),
    opacity: clamp(el.opacity, 0, 1, 1),
    // Trimmed to a side (designer v1.10.0), and only when it is one.
    ...(CLIP_FACES.includes(el.clip) ? { clip: el.clip } : {}),
  };
  if (el.type === "logo") {
    if (!ACCEPTED_MIME.includes(el.mimeType) || !finite(el.scale) || !finite(el.naturalWidth) || !finite(el.naturalHeight)) return null;
    return {
      ...base,
      fileName: typeof el.fileName === "string" && el.fileName ? el.fileName.slice(0, 120) : "logo",
      mimeType: el.mimeType,
      naturalWidth: clamp(el.naturalWidth, 1, 20000, 300),
      naturalHeight: clamp(el.naturalHeight, 1, 20000, 300),
      scale: clamp(el.scale, 0.01, 2, 0.4),
    };
  }
  if (el.type === "text") {
    if (typeof el.text !== "string" || el.text.length > 500 || !finite(el.fontScale)) return null;
    return {
      ...base,
      text: el.text,
      fontFamily: typeof el.fontFamily === "string" && el.fontFamily.length <= 100 ? el.fontFamily : "Arial, sans-serif",
      fontStyle: FONT_STYLES.includes(el.fontStyle) ? el.fontStyle : "normal",
      fill: typeof el.fill === "string" && HEX.test(el.fill) ? el.fill : "#FFFFFF",
      align: ALIGNS.includes(el.align) ? el.align : "center",
      fontScale: clamp(el.fontScale, 0.005, 1, 0.06),
    };
  }
  return null;
}
