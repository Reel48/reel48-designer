// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/coozie-config.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// Configuration for the custom coozie designer.
// Colors are free-pick (any hex). Patterns are data-driven and start empty —
// add entries here when the artwork is ready; no component changes required.
//
// ---------------------------------------------------------------------------
// THE DIE GEOMETRY MOVED. It lives in @reel48/designer/core.
//
// Reason, from docs/REMOTE_ADMIN.md: re-deriving that geometry in a consumer
// means two copies, and the one that drifts is the one that gets an order made
// wrong. account.reel48.com is about to render the same designs, and hat, polo
// and cooler dies are coming — so there is now exactly one definition, with a
// golden-file test in that package pinning every derived number and the full
// traced outline against values captured from THIS file before the move.
//
// What stays here: the storefront's own UI vocabulary — colours, fonts, upload
// limits, snap threshold. None of it ends up in a stored designJson, so none of
// it can drift into a mis-made order.
//
// The exports below keep their original names and shapes so every consumer in
// this repo is unchanged. `size` and `dieId` are the same thing under two
// names; the package accepts both.
// ---------------------------------------------------------------------------

import {
  DIES,
  DIE_LINE_COLOR as PKG_DIE_LINE_COLOR,
  DIE_LINE_OPACITY as PKG_DIE_LINE_OPACITY,
  DIE_LINE_WIDTH as PKG_DIE_LINE_WIDTH,
  dieGeometry as pkgDieGeometry,
  resolveDie,
  traceDie as pkgTraceDie,
} from "./dies.js";

/** Legacy id -> package id. Stored designs carry the legacy form. */
const LEGACY_ID = { standard: "koozie-standard", slim: "koozie-slim" };

/**
 * The package writes the slim blurb with an em dash ("12 oz slim (sleek) can
 * — seltzers, energy drinks") and the storefront's copy carries none
 * (tests/no-em-dashes.test.ts), so the examples become a "like" clause:
 * "12 oz slim (sleek) can, like seltzers and energy drinks". It reads after
 * "Fits a", "for a" and in a table cell alike. A blurb without one passes
 * through untouched.
 */
function storefrontBlurb(blurb) {
  const [fit, examples] = blurb.split(/\s*—\s*/);
  if (!examples) return fit;
  const list = examples.split(/,\s*/);
  const joined =
    list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  return `${fit}, like ${joined}`;
}

/** Present a package die under this repo's existing shape. */
function asSize(die) {
  return {
    id: die.id === "koozie-slim" ? "slim" : "standard",
    label: die.label,
    blurb: storefrontBlurb(die.blurb),
    die: die.measurements,
    stage: die.stage,
  };
}

export const COOZIE_SIZES = {
  standard: asSize(DIES["koozie-standard"]),
  slim: asSize(DIES["koozie-slim"]),
};

export const DEFAULT_SIZE_ID = "standard";
export const COOZIE_SIZE_LIST = [COOZIE_SIZES.standard, COOZIE_SIZES.slim];

/**
 * Narrow anything to a real size.
 *
 * Deliberately still falls back rather than throwing: designs stored before
 * slim existed carry no size at all, and this repo only sells koozies, so
 * `standard` is the right answer for an unrecognised value HERE. The package's
 * `resolveDie(id, { kind })` is the strict form, and it is what a multi-product
 * caller must use — once hats exist, a silent fallback renders a hat design on
 * a can.
 */
export function resolveSize(sizeOrId) {
  const raw = typeof sizeOrId === "string" ? sizeOrId : sizeOrId?.id;
  // Own keys only. COOZIE_SIZES is a plain object, so a posted
  // size="constructor" used to resolve to Object's constructor and `.id` to
  // undefined — and that reached stored design documents.
  return Object.prototype.hasOwnProperty.call(COOZIE_SIZES, raw)
    ? COOZIE_SIZES[raw]
    : COOZIE_SIZES[DEFAULT_SIZE_ID];
}

/**
 * The catalog product a koozie of this die is sold as.
 *
 * Each die is its own product — a different blank at a different price — so the
 * size reaches the cart line, the Stripe description and the order emails as
 * the product title. The magnet remains the decoration.
 */
export const KOOZIE_PRODUCT_HANDLES = {
  standard: DIES["koozie-standard"].productHandle,
  slim: DIES["koozie-slim"].productHandle,
};

export function koozieProductHandle(sizeOrId) {
  return KOOZIE_PRODUCT_HANDLES[resolveSize(sizeOrId).id];
}

/** Die-line geometry in native stage pixels. Delegates; shape is unchanged. */
export function dieGeometry(sizeOrId) {
  const raw = typeof sizeOrId === "string" ? sizeOrId : sizeOrId?.id;
  return pkgDieGeometry(LEGACY_ID[raw] ?? raw ?? "koozie-standard", { kind: "koozie" });
}

/**
 * Die measurements in inches — print panel width/height and base-disc
 * diameter — derived from the same geometry the canvas traces, so the spec
 * table, the markdown mirror and the PDP copy can never disagree with the
 * die-line by a rounding step. One place for the px → inch arithmetic.
 */
export function dieInches(sizeOrId) {
  const g = dieGeometry(sizeOrId);
  return {
    panelW: (g.x1 - g.x0) / g.pxPerInch,
    panelH: (g.y1 - g.y0) / g.pxPerInch,
    discD: (g.r * 2) / g.pxPerInch,
  };
}

/** Trace the die outline onto a canvas 2D context. Delegates. */
export function traceDie(ctx, geom, scale = 1) {
  return pkgTraceDie(ctx, geom, scale);
}

export { resolveDie };

// Re-exported from the package so the canvas and the exported proof cannot
// disagree about the die-line.
export const DIE_LINE_COLOR = PKG_DIE_LINE_COLOR;
export const DIE_LINE_OPACITY = PKG_DIE_LINE_OPACITY;
export const DIE_LINE_WIDTH = PKG_DIE_LINE_WIDTH;

export const DEFAULT_COLOR = "#1C2E4A"; // navy, matches storefront palette

// A few convenience swatches shown above the free color picker.
export const COLOR_PRESETS = [
  "#111111", // Black
  "#FAFAFA", // White
  "#1C2E4A", // Navy
  "#C13232", // Red
  "#0a6b6b", // Teal
  "#BFBFBF", // Grey
];

// Background patterns (2026-11-10) live in coozie-patterns.js, generated from
// scripts/patterns/. Not re-exported here: this file is imported by plain-Node
// scripts (render-die.mjs), which can't import the registry's JSON.

// Upload constraints (enforced client- and server-side).
export const MAX_LOGOS = 5;
export const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB per file
// Ceiling for the same-origin relay (/api/design/upload) the designer falls
// back to when the browser cannot reach Vercel Blob directly. Vercel caps a
// function's request body at 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE); 4 MB
// leaves room for the multipart envelope. Proofs and logos are a few hundred
// KB, so in practice only an oversized custom font falls outside it.
export const DESIGN_RELAY_MAX_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/svg+xml"];
// What the logo picker offers: the files the designer draws, and the AI, EPS
// and PDF files it places as a stand-in box (vector-artwork.js). The
// extensions are listed as well as the types because browsers report no type
// for most .ai and .eps files.
export const LOGO_ACCEPT_ATTR = [
  ...ACCEPTED_MIME,
  "application/pdf",
  "application/postscript",
  "application/illustrator",
  ".ai",
  ".eps",
  ".pdf",
].join(",");

// Text tool — preset (system) fonts plus user-uploaded custom fonts.
export const FONT_OPTIONS = [
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Impact", value: "Impact, Charcoal, sans-serif" },
];

export const DEFAULT_TEXT = {
  text: "Your text",
  fontFamily: FONT_OPTIONS[0].value,
  fontStyle: "normal", // "normal" | "bold" | "italic" | "bold italic"
  fill: "#FFFFFF",
  align: "center",
  fontScale: 0.07, // fraction of stage width
};

export const ACCEPTED_FONT_MIME = [
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/x-font-ttf",
  "application/x-font-otf",
  "application/vnd.ms-opentype",
  "", // some browsers report empty type for .ttf/.otf
];
export const ACCEPTED_FONT_ACCEPT_ATTR = ".ttf,.otf,.woff,.woff2";
export const MAX_FONTS = 3;

// Snap distance (in native stage px) for the center alignment guides.
export const SNAP_THRESHOLD = 8;
