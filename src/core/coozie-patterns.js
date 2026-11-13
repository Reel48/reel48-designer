// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/coozie-patterns.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// Background patterns for the can cooler (Brayden, 2026-11-10).
//
// The list is generated: scripts/patterns/generate.py draws the tiles (the
// duck camo is traced from Brayden's reference), and scripts/patterns/
// publish.mjs writes public/patterns/ and coozie-patterns.json. Change the
// generator and republish; never hand-edit the JSON.
//
// A pattern's id is forever. Orders store it (designJson.patternId) and the
// production spec reads it back, so an id is never renamed or removed; a
// redrawn tile is a new file version under the same id.
//
// Each entry: { id, label, colorway, family, ground, file | files, printFile?,
// repeatIn, pixelRatio, thumb }.
// - `file` is the tile the designer draws, under /patterns/. A flag fills one
//   panel exactly, so it has `files` per can size ({ standard, slim }) and a
//   `repeatIn` per size.
// - `printFile` (`printFiles` per size for a flag) is production's file: an
//   SVG's copy sized in inches, or a raster tile's lossless PNG with its
//   density set (the designer draws a WebP copy).
// - `ground` is the pattern's background colour. Choosing a pattern sets the
//   design's colour to it, so the 3D seam thread, the die's edge and the text
//   colour suggestions all follow the pattern.
// - `pixelRatio` is the tile's px per native stage px (@reel48/designer
//   v1.14.0 `patternPixelRatio`), so it draws at its true repeat.

import PATTERNS from "./coozie-patterns-data.js";

export const PATTERN_BASE = "/patterns/";

/** The picker's groups, in order. */
export const PATTERN_FAMILIES = [
  { id: "camo", label: "Camo" },
  { id: "classic", label: "Classic prints" },
  { id: "retro", label: "Party & retro" },
  { id: "americana", label: "Americana & Texas" },
];

export const COOZIE_PATTERNS = PATTERNS;

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

/** The registry entry for an id, or null for anything that isn't one. */
export function patternById(id) {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}

export function isPatternId(id) {
  return patternById(id) !== null;
}

/** "Duck camo, Slate": how the customer, the team and the factory name it. */
export function patternName(p) {
  return p ? `${p.label}, ${p.colorway}` : "";
}

const sizeKey = (size) => (size === "slim" ? "slim" : "standard");

/** The tile the designer draws for a can size: { src, pixelRatio }. */
export function patternTile(p, size) {
  if (!p) return null;
  const file = p.files ? p.files[sizeKey(size)] : p.file;
  return { src: PATTERN_BASE + file, pixelRatio: p.pixelRatio };
}

/**
 * The file production prints from, as a site path: a copy sized in real
 * inches (an SVG's drawing copy declares pixels), or a raster tile's lossless
 * PNG with its density set.
 */
export function patternPrintPath(p, size) {
  if (!p) return null;
  const file = p.printFiles ? p.printFiles[sizeKey(size)] : p.printFile || p.file;
  return PATTERN_BASE + file;
}

/** The tile's repeat for a can size, [width, height] in inches. */
export function patternRepeatIn(p, size) {
  if (!p) return null;
  return Array.isArray(p.repeatIn) ? p.repeatIn : p.repeatIn[sizeKey(size)];
}

/**
 * @typedef {typeof PATTERNS[number]} PatternEntry
 * @typedef {{ label: string, colorways: PatternEntry[] }} PatternGroup
 */

/**
 * The picker's layout: each family, its patterns in order, each pattern with
 * its colourways.
 * @returns {{ family: string, label: string, patterns: PatternGroup[] }[]}
 */
export function patternGroups() {
  return PATTERN_FAMILIES.map((f) => {
    /** @type {PatternGroup[]} */
    const patterns = [];
    for (const p of PATTERNS) {
      if (p.family !== f.id) continue;
      let group = patterns.find((g) => g.label === p.label);
      if (!group) patterns.push((group = { label: p.label, colorways: [] }));
      group.colorways.push(p);
    }
    return { family: f.id, label: f.label, patterns };
  }).filter((f) => f.patterns.length > 0);
}
