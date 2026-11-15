// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/pms-palette.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The hat's fabric colours: PANTONE Solid Coated (PMS C) (Brayden,
// 2026-10-21: "The available colors are Pantone colors, and they should be
// able to pick from the full Pantone palette"; Solid Coated, hat fabric only;
// embroidery threads stay matched on the mockup).
//
// ---------------------------------------------------------------------------
// HOW A DESIGN STORES ONE. A part's colour in a design stays a hex
// (`parts: { crown_FL: "#1F2433" }`), the hex this palette gives its code:
// every renderer (the 3D, the stage's spot fill, the hub's swatch) paints a
// hex and needs nothing new, and the document stays the designer package's.
// The palette is the key back to the code: each hex here is ONE code, so a
// part's hex names its Pantone colour exactly (pmsByHex). The loader drops a
// second code on a hex already taken, and tests/pms-palette.test.ts fails
// when the file has one, so a duplicate never reaches the site quietly;
// scripts/pms-import.mjs nudges a duplicate's hex by one step before writing.
// The server checks every fabric part is a palette hex and stamps the codes
// on the order (hat-submit.ts), so an order keeps its codes whatever this
// file later says. A hex a code USED to have (`was`, which the converter
// writes when a new palette file gives a code a new hex) still names that
// code (pmsByFormerHex), so a draft, a design link or an open page from
// before the update keeps the code the customer chose. Any other hex that is
// not here (the lab's placeholder colours) moves to its nearest palette
// colour when the design is opened again (hat-draft.js).
//
// THE DATA is pms-solid-coated.json, `{ code, hex }` per colour: the 3,219
// colours of the list Brayden chose (2026-10-22), aj90909's unofficial
// PANTONE Solid Coated 2024 v5, converted from its CIELAB values by
// scripts/pms-import.mjs. The file's header records the source (URL, commit,
// sha256), the conversion, the codes outside sRGB (clipped, all within
// CIEDE2000 1 of their Lab) and the codes nudged off a shared hex. The list
// itself is not checked in.
// ---------------------------------------------------------------------------

import LIBRARY from "./pms-solid-coated.js";
import { deltaE2000, hexToLab, labToLch } from "./cielab.js";

const HEX = /^#[0-9A-F]{6}$/;
// "PMS 2945 C", "PMS Cool Gray 10 C", "PMS Reflex Blue C".
const CODE = /^PMS [A-Za-z0-9][A-Za-z0-9 .'/-]* C$/;

/** A code's id: "PMS Reflex Blue C" is "pms-reflex-blue-c". */
export function pmsIdOf(code) {
  return String(code)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The hue families the picker browses by, in its order. Worked out from each
 * colour's CIELAB hue angle and chroma (familyOf), not its name.
 */
export const PMS_FAMILIES = Object.freeze([
  { id: "red", label: "Reds" },
  { id: "pink", label: "Pinks" },
  { id: "orange", label: "Oranges" },
  { id: "yellow", label: "Yellows" },
  { id: "green", label: "Greens" },
  { id: "blue", label: "Blues" },
  { id: "purple", label: "Purples" },
  { id: "brown", label: "Browns" },
  { id: "neutral", label: "Greys" },
]);
const FAMILY_ORDER = new Map(PMS_FAMILIES.map((f, i) => [f.id, i]));

/**
 * A colour's family from its lightness, chroma and hue: under 10 chroma it is
 * a grey (black and white too); a warm hue that is dark or dull is a brown;
 * otherwise the hue angle decides. The bounds are where named colours fall in
 * CIELAB (pure red sits near 40°, yellow near 100°, blue near 300°).
 */
export function familyOf({ L, C, h }) {
  if (C < 10) return "neutral";
  if (h >= 45 && h < 110 && (C < 22 || (L < 45 && C < 50))) return "brown";
  if (h >= 340 || h < 22) return "pink";
  if (h < 48) return "red";
  if (h < 78) return "orange";
  if (h < 110) return "yellow";
  if (h < 180) return "green";
  if (h < 308) return "blue";
  return "purple";
}

/**
 * What a typed query is compared with: "2945 c", "cool gray 10 c". "PMS",
 * "Pantone" and the space before the C are optional, so "PMS2945C" and
 * "2945c" read as "2945 C".
 */
function searchKey(text) {
  return String(text)
    .toLowerCase()
    .replace(/^\s*(pantone|pms)\.?/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/(\d)\s*c$/, "$1 c");
}

/**
 * A palette file's colours, checked and indexed: `colors` in browsing order,
 * and maps by id, by hex and by former hex (`was`). Exported for its test;
 * the module's own palette is this over pms-solid-coated.json.
 */
export function buildPmsPalette(raw) {
  const colors = build(raw);
  const byId = new Map(colors.map((c) => [c.id, c]));
  const byHex = new Map(colors.map((c) => [c.hex, c]));
  const byFormer = new Map();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c.code !== "string" || !Array.isArray(c.was)) continue;
    const entry = byId.get(pmsIdOf(c.code.trim().replace(/\s+/g, " ")));
    // Only the entry the file kept for this code (not a repeat the loader dropped).
    if (!entry || entry.hex !== String(c.hex).trim().toUpperCase()) continue;
    for (const old of c.was) {
      const hex = typeof old === "string" ? old.trim().toUpperCase() : "";
      if (HEX.test(hex) && !byHex.has(hex) && !byFormer.has(hex)) byFormer.set(hex, entry);
    }
  }
  return { colors, byId, byHex, byFormer };
}

function build(raw) {
  const ids = new Set();
  const hexes = new Set();
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c.code !== "string" || typeof c.hex !== "string") continue;
    const code = c.code.trim().replace(/\s+/g, " ");
    const hex = c.hex.trim().toUpperCase();
    if (!CODE.test(code) || !HEX.test(hex)) continue;
    const id = pmsIdOf(code);
    if (ids.has(id) || hexes.has(hex)) continue;
    ids.add(id);
    hexes.add(hex);
    const lab = hexToLab(hex);
    const lch = labToLch(lab);
    const entry = { id, code, name: code.slice(4), hex, lab: Object.freeze(lab), family: familyOf(lch), key: searchKey(code) };
    out.push({ entry, lch });
  }
  // Browsing order: by family, then by hue in 10° bands, light to dark. Greys
  // go light to dark alone.
  out.sort(
    (a, b) =>
      FAMILY_ORDER.get(a.entry.family) - FAMILY_ORDER.get(b.entry.family) ||
      (a.entry.family === "neutral" ? 0 : Math.floor(a.lch.h / 10) - Math.floor(b.lch.h / 10)) ||
      b.lch.L - a.lch.L,
  );
  return out.map(({ entry }) => Object.freeze(entry));
}

/**
 * Every colour: `{ id, code, name, hex, lab, family, key }`, in browsing
 * order. `code` is "PMS 2945 C", `name` "2945 C", `hex` "#RRGGBB".
 */
const PALETTE = buildPmsPalette(LIBRARY.colors);
export const PMS_COLORS = Object.freeze(PALETTE.colors);
/** How many entries the file carries, valid or not (the guard compares). */
export const PMS_FILE_COUNT = Array.isArray(LIBRARY.colors) ? LIBRARY.colors.length : 0;

const BY_ID = PALETTE.byId;
const BY_HEX = PALETTE.byHex;
const BY_FORMER = PALETTE.byFormer;

/** A colour by id ("pms-2945-c"), or null. */
export function pmsById(id) {
  return (typeof id === "string" && BY_ID.get(id)) || null;
}

/** The colour a hex is, or null when the hex is not one of the palette's. */
export function pmsByHex(hex) {
  return (typeof hex === "string" && BY_HEX.get(hex.trim().toUpperCase())) || null;
}

/**
 * The colour whose code a hex USED to be, before a palette update gave that
 * code a new hex (`was`), or null.
 */
export function pmsByFormerHex(hex) {
  return (typeof hex === "string" && BY_FORMER.get(hex.trim().toUpperCase())) || null;
}

/** The `n` colours nearest a hex by CIEDE2000, nearest first. */
export function nearestPmsColors(hex, n = 1) {
  const lab = hexToLab(hex);
  if (!lab) return [];
  return PMS_COLORS.map((c) => ({ c, d: deltaE2000(lab, c.lab) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ c }) => c);
}

/**
 * The palette's colour for a hex: itself when it is one, the code it used to
 * be, or else the nearest.
 */
export function nearestPms(hex) {
  return pmsByHex(hex) ?? pmsByFormerHex(hex) ?? nearestPmsColors(hex, 1)[0] ?? null;
}

const HEX_QUERY = /^#?[0-9a-f]{6}$/i;

/**
 * The colours a picker shows for a typed query and a family ("all" for
 * every one). A query matches the code: "2945", "2945 C", "PMS 2945 C" and
 * "cool gray" all work, an exact code first, then codes starting with it,
 * then a word starting with it, then any match. A hex ("#1F2A44") shows the
 * nearest colours to it instead, nearest first.
 */
export function searchPms(query = "", family = "all", { nearest = 24 } = {}) {
  const raw = String(query).trim();
  if (HEX_QUERY.test(raw)) return nearestPmsColors(raw.startsWith("#") ? raw : `#${raw}`, nearest);
  const inFamily = family === "all" ? PMS_COLORS : PMS_COLORS.filter((c) => c.family === family);
  const q = searchKey(raw);
  if (!q) return inFamily;
  const bare = (key) => key.replace(/ c$/, "");
  const rank = (key) =>
    key === q || bare(key) === q ? 0 : key.startsWith(q) ? 1 : ` ${key}`.includes(` ${q}`) ? 2 : key.includes(q) ? 3 : -1;
  return inFamily
    .map((c) => ({ c, r: rank(c.key) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r)
    .map(({ c }) => c);
}
