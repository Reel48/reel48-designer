// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/coozie-spec.ts (origin/main d78d90ee), TypeScript as JSDoc, SITE_URL inlined. Comments are the storefront's; imports point into this package.
//
/**
 * Turns a stored coozie design document into something a human can produce from.
 *
 * The designer writes its state through toDesignDescription() (lib/coozie-design.js)
 * and handleCoozieSubmit() stores that under OrderItem.designJson alongside the
 * Blob asset URLs. Both the order-notification email and /admin/orders render
 * from THIS module so the spec production reads is the same in the inbox and on
 * screen — two formatters would drift, and the drift would show up as a
 * mis-made order.
 *
 * Coordinates in the document are stage fractions, not pixels: x/y are 0..1
 * across the die-line, `scale` is a logo's width as a fraction of stage width,
 * and `fontScale` is cap height as a fraction of stage width. We report the
 * native-pixel equivalent too — the resolution the proof is exported at — so
 * artwork can be placed without redoing the math.
 *
 * Which native frame that is depends on the design's `size`. Documents written
 * before slim cans existed carry no size and resolve to standard (1000×2000),
 * which is what they were authored against — so their spec output here is
 * unchanged by the addition.
 */

import {
  FONT_OPTIONS,
  resolveSize,
} from "./coozie-config.js";
import { patternById, patternName, patternPrintPath, patternRepeatIn } from "./coozie-patterns.js";
import { designKindOf } from "./design-lines.js";
import { describeHatDesign } from "./hat-spec.js";

/**
 * The storefront's origin (its seo.ts SITE_URL), inlined: a pattern's print
 * master is served from the storefront, and the hub's artwork zip fetches it
 * only from there (data.reel48.com order-assets.ts isPatternUrl).
 */
const SITE_URL = "https://www.reel48.com";

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   size?: string,
 *   color?: string,
 *   patternId?: number | string | null,
 *   patternPrint?: string | null,
 *   patternRepeatIn?: unknown,
 *   elements?: unknown[],
 *   jsonUrl?: string | null,
 *   fontUrls?: string[],
 *   artworkFiles?: unknown[],
 * }} CoozieDesignDoc
 *   `size`: "standard" | "slim", absent on documents written before slim
 *   existed. `patternPrint` / `patternRepeatIn`: the pattern's print file and
 *   repeat as they were when the order was placed (written by the server's
 *   parseDesignDoc, 2026-11-10). `jsonUrl`: Blob URL of the full design.json.
 *   `fontUrls`: Blob URLs of any custom fonts the customer uploaded.
 *   `artworkFiles`: AI, EPS and PDF originals behind stand-in boxes.
 *
 * @typedef {{
 *   kind: "text" | "logo",
 *   title: string,
 *   rows: { label: string, value: string }[],
 * }} CoozieElementSpec
 *   `title`: a short heading, e.g. "Text 1" / "Logo 2". `rows`: ordered
 *   label/value rows, safe to render as a table or as text lines.
 *
 * @typedef {{
 *   size: { id: string, label: string },
 *   color: string | null,
 *   pattern: string | null,
 *   patternFile?: string | null,
 *   patternRepeatIn?: [number, number] | null,
 *   elements: CoozieElementSpec[],
 *   jsonUrl: string | null,
 *   fontUrls: string[],
 *   artworkFiles: { url: string, fileName: string }[],
 * }} CoozieSpec
 *   `size`: which die to cut, e.g. { id: "slim", label: "Slim can" }.
 *   `color`: the can body colour as a hex string, e.g. "#1C2E4A". `pattern`:
 *   "Duck camo, Slate", or null for a plain colour. `patternFile` /
 *   `patternRepeatIn`: the pattern's print master (absolute URL) for this size,
 *   and its repeat in inches. The tile starts at the front panel's top-left;
 *   the back panel prints it turned 180 degrees, so it reads upright when sewn.
 *   `artworkFiles`: AI, EPS and PDF originals placed as stand-in boxes
 *   (vector-artwork.js): the logo goes where the box is, after an emailed proof
 *   is approved. One per file, however many boxes draw it.
 *
 * @typedef {import("./hat-spec.js").HatSpec} HatSpec
 * @typedef {{ width: number, height: number }} Stage Native pixel frame a design's fractions are relative to.
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {number | null} */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Prisma hands back `JsonValue`; narrow it before reading fields off it.
 *
 * @param {unknown} raw
 * @returns {CoozieDesignDoc | null}
 */
export function parseDesignDoc(raw) {
  return isRecord(raw) ? /** @type {CoozieDesignDoc} */ (raw) : null;
}

/** "0.500 (500px)" — the fraction production can verify against the proof, plus pixels. */
/** @param {number | null} fraction @param {number} axisPx @returns {string} */
function coord(fraction, axisPx) {
  if (fraction === null) return "—";
  return `${fraction.toFixed(3)} (${Math.round(fraction * axisPx)}px)`;
}

/** Map a CSS font stack back to the label the customer picked in the designer. */
/** @param {string | null} stack @returns {string} */
function fontLabel(stack) {
  if (!stack) return "—";
  const preset = FONT_OPTIONS.find(
    (f) => f.value === stack,
  );
  // A non-preset stack means an uploaded font — the family name is the file's.
  return preset ? preset.label : `${stack} (custom upload)`;
}

/** @param {unknown} id @returns {string | null} */
function patternLabel(id) {
  if (id === null || id === undefined || id === "") return null;
  const hit = patternById(id);
  return hit ? patternName(hit) : `#${String(id)}`;
}

const PRINT_PATH_RE = /^\/patterns\/[A-Za-z0-9._-]+$/;

/**
 * @param {unknown} r
 * @returns {r is [number, number]}
 */
function isRepeat(r) {
  return Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
}

/**
 * The pattern's print master for this can size, as an absolute URL production
 * can download (the hub puts it in the artwork zip), and its repeat. An order
 * carries the file it was placed with (`patternPrint`, written by the
 * server), so a later redraw of the tile never changes what an old order
 * prints; a document without one (a saved design, an older line) reads the
 * registry. Null without a known pattern.
 *
 * @param {CoozieDesignDoc} doc
 * @param {string} size
 * @returns {{ file: string, repeatIn: [number, number] } | null}
 */
function patternPrint(doc, size) {
  const hit = patternById(doc.patternId);
  if (!hit) return null;
  const stored = typeof doc.patternPrint === "string" && PRINT_PATH_RE.test(doc.patternPrint) ? doc.patternPrint : null;
  const path = stored ?? patternPrintPath(hit, size);
  const repeat = stored && isRepeat(doc.patternRepeatIn) ? doc.patternRepeatIn : patternRepeatIn(hit, size);
  return path && repeat ? { file: `${SITE_URL}${path}`, repeatIn: [repeat[0], repeat[1]] } : null;
}

/** @type {Record<string, string>} */
const TRIM_SIDES = { front: "Front panel", back: "Back panel", base: "Base" };

/**
 * A row for artwork trimmed to its side (designer v1.10.0 `clip`): placed
 * running past the side's edge, and cut off there. The proof shows the cut.
 *
 * @param {Record<string, unknown>} el
 * @returns {{ label: string, value: string }[]}
 */
function trimRows(el) {
  const side =
    typeof el.clip === "string" && Object.prototype.hasOwnProperty.call(TRIM_SIDES, el.clip)
      ? TRIM_SIDES[el.clip]
      : undefined;
  return side ? [{ label: "Trimmed to", value: `${side} (nothing past its edge prints)` }] : [];
}

/**
 * @param {Record<string, unknown>} el
 * @param {number} n
 * @param {Stage} stage
 * @returns {CoozieElementSpec}
 */
function textElement(
  el,
  n,
  stage,
) {
  const fontScale = num(el.fontScale);
  return {
    kind: "text",
    title: `Text ${n}`,
    rows: [
      { label: "Copy", value: str(el.text) ?? "(empty)" },
      { label: "Font", value: fontLabel(str(el.fontFamily)) },
      { label: "Style", value: str(el.fontStyle) ?? "normal" },
      { label: "Colour", value: str(el.fill) ?? "—" },
      { label: "Align", value: str(el.align) ?? "—" },
      {
        label: "Cap height",
        value:
          fontScale === null
            ? "—"
            : `${fontScale.toFixed(3)} of width (${Math.round(fontScale * stage.width)}px)`,
      },
      { label: "Centre X", value: coord(num(el.x), stage.width) },
      { label: "Centre Y", value: coord(num(el.y), stage.height) },
      { label: "Rotation", value: `${num(el.rotation) ?? 0}°` },
      { label: "Opacity", value: String(num(el.opacity) ?? 1) },
      ...trimRows(el),
    ],
  };
}

/**
 * @param {Record<string, unknown>} el
 * @param {number} n
 * @param {Stage} stage
 * @returns {CoozieElementSpec}
 */
function logoElement(
  el,
  n,
  stage,
) {
  const scale = num(el.scale);
  const w = num(el.naturalWidth);
  const h = num(el.naturalHeight);
  return {
    kind: "logo",
    title: `Logo ${n}`,
    rows: [
      { label: "File", value: str(el.fileName) ?? "(unnamed)" },
      { label: "Type", value: str(el.mimeType) ?? "—" },
      {
        label: "Source size",
        value: w !== null && h !== null ? `${w}×${h}px` : "—",
      },
      {
        label: "Placed width",
        value:
          scale === null
            ? "—"
            : `${scale.toFixed(3)} of width (${Math.round(scale * stage.width)}px)`,
      },
      { label: "Centre X", value: coord(num(el.x), stage.width) },
      { label: "Centre Y", value: coord(num(el.y), stage.height) },
      { label: "Rotation", value: `${num(el.rotation) ?? 0}°` },
      { label: "Opacity", value: String(num(el.opacity) ?? 1) },
      ...trimRows(el),
    ],
  };
}

/**
 * Build the production spec. Returns null only when there is no design document
 * at all (a plain catalog line); a malformed or partial document still yields a
 * spec, because "we have the proof but the JSON is odd" must not blank the page.
 *
 * A hat's document (design-lines.ts designKindOf) is described by
 * describeHatDesign, checked first: read here, it would come out as a standard
 * can cooler, its spots laid out on the can's die (2026-10-20).
 *
 * @param {unknown} raw
 * @returns {CoozieSpec | HatSpec | null}
 */
export function describeDesign(raw) {
  const doc = parseDesignDoc(raw);
  if (!doc) return null;
  if (designKindOf(doc) === "hat") return describeHatDesign(/** @type {Record<string, unknown>} */ (doc));

  const size = resolveSize(doc.size);
  const stage = size.stage;
  const print = patternPrint(doc, size.id);

  /** @type {CoozieElementSpec[]} */
  const elements = [];
  let textN = 0;
  let logoN = 0;
  for (const el of Array.isArray(doc.elements) ? doc.elements : []) {
    if (!isRecord(el)) continue;
    if (el.type === "logo") elements.push(logoElement(el, ++logoN, stage));
    else elements.push(textElement(el, ++textN, stage));
  }

  return {
    size: { id: size.id, label: size.label },
    color: str(doc.color),
    pattern: patternLabel(doc.patternId),
    patternFile: print?.file ?? null,
    patternRepeatIn: print?.repeatIn ?? null,
    elements,
    jsonUrl: str(doc.jsonUrl),
    fontUrls: Array.isArray(doc.fontUrls)
      ? doc.fontUrls.filter((u) => typeof u === "string")
      : [],
    artworkFiles: (Array.isArray(doc.artworkFiles) ? doc.artworkFiles : [])
      .filter(
        /** @type {(f: unknown) => f is { url: string, fileName: string }} */
        (f) => isRecord(f) && typeof f.url === "string" && typeof f.fileName === "string",
      )
      .filter((f, i, all) => all.findIndex((g) => g.url === f.url) === i)
      .map(({ url, fileName }) => ({ url, fileName })),
  };
}

/**
 * Flatten a spec into plain-text lines for the notification email. Kept here
 * rather than in the webhook so the email and the admin table can never
 * disagree about what a design says.
 */
/**
 * @param {CoozieSpec} spec
 * @param {string} [indent]
 * @returns {string[]}
 */
export function specToTextLines(spec, indent = "    ") {
  /** @type {string[]} */
  const out = [];
  out.push(`${indent}Size: ${spec.size.label}`);
  if (spec.color) out.push(`${indent}Can colour: ${spec.color}`);
  if (spec.pattern) out.push(`${indent}Pattern: ${spec.pattern}`);
  if (spec.patternFile) {
    out.push(`${indent}  Print file: ${spec.patternFile}`);
    if (spec.patternRepeatIn) {
      out.push(`${indent}  Repeat: ${spec.patternRepeatIn[0]} x ${spec.patternRepeatIn[1]} in`);
      out.push(
        `${indent}  Laying it: start the tile at the front panel's top-left corner. The back panel prints it turned 180°, starting from its bottom-right corner on the flat die (its top-left once sewn). The base follows the front. The proof shows it.`,
      );
    }
  }
  for (const el of spec.elements) {
    out.push(`${indent}${el.title}:`);
    for (const r of el.rows) out.push(`${indent}  ${r.label}: ${r.value}`);
  }
  return out;
}
