// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-migrate.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// A No. 7 design moved from the first die (hat-no-7: one rect per spot, each
// its max imprint) to the round E1 die (hat-no-7-v2, 2026-10-21: whole-panel
// areas round the same caps), so a draft, a design link or a saved design made
// before E1 opens on the new die WITH EVERY PIECE'S CENTRE AT THE SAME POINT ON
// THE HAT: where the first model's 3D view showed it, E1's shows it.
//
// The two dies lay the same hat out differently: E1's front is one chart over
// both front panels, its sides whole panels, its back grown and raised, and
// the stage is 3720 x 1808 instead of 1560 x 1296. Each zone's chart is true
// size at one point of the hat, its ANCHOR, at 200 px/in on both dies, so
// round it a piece keeps its offset in inches:
//
//     new die px = newAnchor + (old die px - oldAnchor) + correction
//
// with its size in inches (same px/in) and its rotation kept (both charts
// share the zone's axes: front and back with their centre seam on u = 0).
//
// THE ANCHORS, die px, and where they come from (each zone's `chartToDie`
// origin in the model build's zones files, which is the die point of the
// zone's `centre`):
//   - the shipped scripts/blender/hat-no7/zones_no7.json: every chart is
//     about its rect's centre, so the old anchor is the rect centre: front
//     (490, 265), left (1220, 190), right (1220, 570), back (1270, 887.5),
//     label_tall (1195, 1155), label_square (820, 1100);
//   - scripts/blender/hat-no7/e1/zones_no7.json: front, left and right are
//     charted true size at TODAY's zone centre (12p_panels `centre: zone`; the
//     README's round E1 "Charts"), so the new anchor is their chartToDie
//     origin: front (874.853, 957.004), left (2227.128, 940.336), right
//     (3226.101, 925.402). The 3-D centres agree with the shipped ones within
//     0.03 mm on the sides and 0.22 mm on the front (both front charts put
//     seam_C on u = 0 through the centre; E1 re-derives the point on the seam).
//   - The back's E1 chart is about its NEW centre, raised `grownFrom.raisedMm`
//     (2.4 mm) up the back seam from today's (`grownFrom.centre`, the shipped
//     centre), along the chart's v (die y up). Today's centre is therefore
//     2.4 mm below the E1 origin: (359, 1549.5 + 2.4 x 7.874016) =
//     (359, 1568.3976). A back logo keeps its place on the hat; one that now
//     overhangs the raised area's bottom edge is confined up into it.
//   - label_tall is the same card on both dies (the same chart, moved on the
//     sheet): (933, 1512).
//   - label_square leaves the die in E1. Its art moves to label_tall as the
//     designer's `moveToZone` moves a label between shapes: about the two
//     shapes' shared centre on the hat (05z `sharedCentreWith`; the 3-D
//     centres are 0.43 mm apart), shrunk only if it would not fit (a 1 in
//     square fits the 1.75 x 1 in rectangle, so it is not).
// zoneAnchors() reads those numbers from the files themselves;
// tests/hat-migrate.test.ts holds HAT_NO_7_ANCHORS to them.
//
// THE CORRECTION (the front only). Away from its anchor a chart is no longer
// true size, and two charts of one panel differ there. Measured through both
// models (each old die point to 3D by the first model's UVs, against
// newAnchor + offset to 3D by E1's), the offset alone keeps a piece within
// 0.25 mm of its point on the sides and the back and 0.61 mm on the label
// (square or tall), but not on the front: E1's chart over both panels curves
// its rows down toward the sides, so there the offset alone lands up to
// 4.7 mm lower on the crown (3.3 to 3.6 mm at the old rect's side edges at
// mid-height, 4.7 mm at its top corners). So the front's offset carries a
// correction, read bilinearly off a grid (HAT_NO_7_ANCHORS.grids.front; held
// at its edge outside it): 13 x 7 nodes 75 px apart over the old front rect
// (40, 40, 900 x 450), each E1 die px of the hat point the old die point is
// printed at, less the offset alone, less the anchor's own (0.40, 0.73) px so
// today's centre lands on E1's centre point exactly. How each node was found:
// the first model (public/3d/hats/hat-no7.ab4afb7d.glb at d7d96bf, before E1
// replaced it) and E1's (hat-no7.dd00635f.glb) run through
// scripts/blender/hat-no7/lab/extract_surface.mjs (the first on its 1560 x
// 1296 frame, E1 with --die e1/die_no7.json: hat-no7-surface.14936a94.json);
// the old die point to 3D through the first surface's front, then the
// nearest point of E1's front print faces (every node's point lies on E1's
// front within 0.008 mm: the two models share the front's shape, only the
// chart differs) and its die px. With it the front is within 0.25 mm too.
// tests/hat-migrate.test.ts checks every spot against E1's shipped surface
// from 3-D points read off the first model.
//
// What the front's correction does not change: the offset in inches off the
// anchor (up to 0.19 in, 37 px, at the old rect's corners), which is E1's
// chart's to give, and the shape a logo is drawn in, which is the chart's: a
// piece keeps its rotation, so a small one near the old front's side edges
// sits turned up to about 7 degrees from how the first model showed it, and a
// full-width wordmark's ends follow E1's rows (about 3 mm lower than the first
// model drew them), as everything placed on E1 does.
//
// Then every piece is confined to its spot's area and cap (hat-placements.ts
// confineElement), so the result is a valid design on the new die. Pure and
// deterministic: the dies, anchors and grids are passed in.

import { areaBounds } from "./region.js";
import { confineElement, zoneArea, zoneOfElement } from "./hat-placements.js";

const PX_PER_MM = 200 / 25.4;

const freezeAnchors = (map) =>
  Object.freeze(Object.fromEntries(Object.entries(map).map(([id, p]) => [id, Object.freeze([...p])])));

/**
 * The front's correction, die px of hat-no-7-v2 (see the header): node (i, j)
 * is first-die point (40 + 75 i, 40 + 75 j), two numbers a node, row by row.
 */
const FRONT_GRID = Object.freeze({
  x0: 40,
  y0: 40,
  step: 75,
  cols: 13,
  rows: 7,
  d: Object.freeze([
    11.81, -36.98, 10.87, -27.69, 9.37, -18.48, 7.13, -10.2, 4.57, -3.67, 2.37, 0.69, 0.19, 2.15, -1.89, 1.25, -4.28, -2.9, -6.4, -9.05, -8.22, -16.63, -9.45, -25.47, -10.17, -34.14,
    4.92, -33.94, 4.11, -25.81, 3.5, -17.44, 2.55, -9.93, 1.59, -4.48, 0.59, -0.39, 0.52, 1.12, -0.35, 0.31, -1.17, -3.27, -2.4, -9, -2.51, -15.5, -3.65, -23.54, -3.73, -31.32,
    -0.77, -31.48, -0.92, -23.71, -0.98, -16.29, -0.92, -9.64, -0.64, -4.66, -0.39, -1.12, -0.34, 0.36, 0.31, -0.41, 0.58, -3.33, 0.66, -8.53, 0.86, -14.63, 1.42, -21.8, 1.24, -28.95,
    -5.15, -29.32, -4.64, -21.84, -4.65, -14.89, -3.57, -8.84, -2.44, -4.2, -1.56, -0.96, 0, 0, 0.96, -0.85, 2.3, -3.21, 3.52, -7.46, 3.98, -13.32, 4.72, -19.43, 5.58, -26.79,
    -9.73, -27.63, -9.28, -19.86, -7.99, -13.37, -6.39, -7.64, -4.9, -3.31, -2.97, -0.64, -0.69, 0.52, 1.79, -0.19, 3.84, -2.86, 5.34, -6.58, 7.49, -11.66, 8.21, -17.87, 9.44, -24.59,
    -14.99, -25.72, -13.27, -18.08, -11.53, -11.56, -9.05, -6.37, -6.65, -2.36, -3.55, 0.01, -1.18, 1.13, 2.31, 0.43, 4.7, -1.45, 7.86, -5.38, 10.16, -10.16, 12.07, -15.9, 13.71, -22.81,
    -20.55, -23.69, -17.61, -16.16, -14.71, -9.94, -11.27, -4.94, -7.92, -1.01, -4.63, 1.25, -0.56, 2.25, 2.81, 1.31, 5.96, -0.63, 9.58, -3.94, 12.83, -8.45, 15.89, -13.97, 18.19, -20.75,
  ]),
});

/**
 * Everything migrateHatDoc needs to move a design from the first No. 7 die
 * (hat-no-7) to round E1 (hat-no-7-v2), but the dies: each die's anchors, die
 * px, and the front's correction grid.
 */
export const HAT_NO_7_ANCHORS = Object.freeze({
  zonesFrom: freezeAnchors({
    front: [490, 265],
    left: [1220, 190],
    right: [1220, 570],
    back: [1270, 887.5],
    label_tall: [1195, 1155],
    label_square: [820, 1100],
  }),
  zonesTo: freezeAnchors({
    front: [874.853, 957.004],
    left: [2227.128, 940.336],
    right: [3226.101, 925.402],
    back: [359, 1549.5 + 2.4 * 7.874016],
    label_tall: [933, 1512],
  }),
  grids: Object.freeze({ front: FRONT_GRID }),
});

/** A spot the new die no longer has, and the spot its art moves to. */
export const ZONE_SUCCESSORS = Object.freeze({ label_square: "label_tall" });

/** The inside label's shapes, by zone, as a design's `zones` entry names them. */
const LABEL_SHAPES = Object.freeze({ label_tall: "tall", label_square: "square" });

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOwn = (o, k) => isObject(o) && Object.prototype.hasOwnProperty.call(o, k);

/** "874.853 + u * pxPerMm" or "957.004 - v * pxPerMm": the constant, or NaN. */
function chartOrigin(expr, axis) {
  const m = typeof expr === "string" ? expr.match(new RegExp(`^\\s*(-?\\d+(?:\\.\\d+)?)\\s*[-+]\\s*${axis}\\s*\\*\\s*pxPerMm\\s*$`)) : null;
  return m ? Number(m[1]) : Number.NaN;
}

/**
 * Each zone's anchor, die px `[x, y]`: the die point of the hat point the
 * zone is anchored on (today's zone centre), from a model build's zones file
 * (each zone's `chartToDie` origin, moved back down the chart's v by
 * `grownFrom.raisedMm` where the chart was raised off today's centre), or an
 * anchors map as HAT_NO_7_ANCHORS holds, copied. Throws on a zone it cannot
 * read.
 *
 * @param {object} zones a zones file (`{ zones: [...] }`) or `{ [zoneId]: [x, y] }`
 * @returns {Record<string, [number, number]>}
 */
export function zoneAnchors(zones) {
  if (isObject(zones) && Array.isArray(zones.zones)) {
    const out = {};
    for (const z of zones.zones) {
      const c = z?.chartToDie;
      const ppm = Number.isFinite(c?.pxPerMm) ? c.pxPerMm : PX_PER_MM;
      const x = chartOrigin(c?.x, "u");
      let y = chartOrigin(c?.y, "v");
      const raised = z?.grownFrom?.raisedMm;
      if (Number.isFinite(raised)) y += raised * ppm;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Zone ${JSON.stringify(z?.id)} has no chartToDie origin.`);
      out[z.id] = [x, y];
    }
    return out;
  }
  if (!isObject(zones)) throw new Error("No zone anchors given.");
  const out = {};
  for (const [id, p] of Object.entries(zones)) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`Zone ${JSON.stringify(id)} has no anchor.`);
    out[id] = [p[0], p[1]];
  }
  return out;
}

/**
 * A correction grid, checked: `x0`, `y0` the first node (die px of the die
 * moved from), `step` px between nodes each way, `cols` x `rows` nodes, `d`
 * two numbers a node (die px of the die moved to), row by row. Throws on
 * anything else.
 */
function readGrid(id, g) {
  const ok =
    isObject(g) &&
    Number.isFinite(g.x0) &&
    Number.isFinite(g.y0) &&
    g.step > 0 &&
    Number.isInteger(g.cols) &&
    Number.isInteger(g.rows) &&
    g.cols >= 2 &&
    g.rows >= 2 &&
    Array.isArray(g.d) &&
    g.d.length === 2 * g.cols * g.rows &&
    g.d.every(Number.isFinite);
  if (!ok) throw new Error(`The correction for the ${id} spot is not a grid.`);
  return g;
}

/** A grid's correction at die point (x, y): bilinear between its nodes, held at its edge outside them. */
function gridAt(g, x, y) {
  const fx = Math.min(g.cols - 1, Math.max(0, (x - g.x0) / g.step));
  const fy = Math.min(g.rows - 1, Math.max(0, (y - g.y0) / g.step));
  const i = Math.min(g.cols - 2, Math.floor(fx));
  const j = Math.min(g.rows - 2, Math.floor(fy));
  const u = fx - i;
  const v = fy - j;
  const at = (ii, jj, k) => g.d[2 * (jj * g.cols + ii) + k];
  const lerp = (k) =>
    (1 - u) * (1 - v) * at(i, j, k) + u * (1 - v) * at(i + 1, j, k) + (1 - u) * v * at(i, j + 1, k) + u * v * at(i + 1, j + 1, k);
  return [lerp(0), lerp(1)];
}

/** A zone's area's size in inches on its die. */
function areaInches(zone, die) {
  const b = areaBounds(zoneArea(zone));
  return { w: b.w / die.pxPerInch, h: b.h / die.pxPerInch };
}

/**
 * `doc`, a hat design on die `from`, as the same design on die `to`: every
 * piece's centre at the same point on the hat (see the header), the same size in
 * inches, art on a spot `to` lacks moved to its successor (label_square to
 * label_tall, fitted), then confined to its spot's area and cap; `zones`
 * entries carried to the same spots (a label's shape renamed with it); and
 * `dieId` set to `to.id`. Everything else on the document is kept.
 *
 * `doc` itself when it is already on `to`; null when it is not a hat design
 * on `from`. A piece with no finite centre, or on a spot with no successor,
 * is left as it was (the server refuses it as off every spot).
 *
 * @param {any} doc
 * @param {{ from: object, to: object, zonesFrom: object, zonesTo: object,
 *   grids?: Record<string, object>, successors?: Record<string, string>,
 *   measure?: (el: any) => { w: number, h: number } | null }} opts
 *   `from` / `to`: hat-config dies (`id`, `pxPerInch`, `stage`, `zones[]`
 *   with `rect`, `maxImprint` and, on an area die, `area`). `zonesFrom` /
 *   `zonesTo`: each die's anchors (zoneAnchors). `grids`: a correction
 *   grid per spot of `from` that needs one (readGrid). HAT_NO_7_ANCHORS holds
 *   all three for the No. 7. `measure`: text's box in die px, to confine
 *   text whole.
 * @returns {any} the new document, `doc` itself, or null
 */
export function migrateHatDoc(doc, { from, to, zonesFrom, zonesTo, grids = {}, successors = ZONE_SUCCESSORS, measure } = {}) {
  if (!isObject(doc) || !from || !to) return null;
  if (doc.dieId === to.id) return doc;
  if (doc.dieId !== from.id) return null;

  const before = zoneAnchors(zonesFrom);
  const after = zoneAnchors(zonesTo);
  const corrections = new Map(Object.entries(isObject(grids) ? grids : {}).map(([id, g]) => [id, readGrid(id, g)]));
  const toZone = (id) => to.zones.find((z) => z.id === id) ?? null;
  const targetOf = (id) => (toZone(id) ? id : hasOwn(successors, id) && toZone(successors[id]) ? successors[id] : null);
  const anchor = (map, id, die) => {
    if (!hasOwn(map, id)) throw new Error(`No anchor for the ${id} spot on ${die.id}.`);
    return map[id];
  };
  // Same inches on both dies: px/in, and stage widths for the fractions.
  const s = to.pxPerInch / from.pxPerInch;
  const sizeK = (from.stage.width / to.stage.width) * s;

  const elements = (Array.isArray(doc.elements) ? doc.elements : []).map((el) => {
    const z0 = zoneOfElement(el, from);
    const target = z0 && targetOf(z0.id);
    if (!target) return el;
    const z1 = toZone(target);
    const a0 = anchor(before, z0.id, from);
    const a1 = anchor(after, target, to);
    // moveToZone's fit: shrunk (never grown) so the old spot fits the new one.
    let k = 1;
    if (target !== z0.id) {
      const ia = areaInches(z0, from);
      const ib = areaInches(z1, to);
      k = Math.min(1, ib.w / ia.w, ib.h / ia.h);
    }
    const px = el.x * from.stage.width;
    const py = el.y * from.stage.height;
    const grid = corrections.get(z0.id);
    const [gx, gy] = grid ? gridAt(grid, px, py) : [0, 0];
    const next = {
      ...el,
      x: (a1[0] + (px - a0[0]) * s * k + gx) / to.stage.width,
      y: (a1[1] + (py - a0[1]) * s * k + gy) / to.stage.height,
    };
    if (el.type === "logo" && Number.isFinite(el.scale)) next.scale = el.scale * sizeK * k;
    if (el.type === "text" && Number.isFinite(el.fontScale)) next.fontScale = el.fontScale * sizeK * k;
    if (el.clip === z0.id) next.clip = target;
    else if (el.clip && !toZone(el.clip)) delete next.clip;
    return confineElement(next, z1, to, { measure });
  });

  // Each spot's choices, on the spot its art went to. Where two old spots
  // meet on one new one (the label's two shapes, only one of which a design
  // decorates), the one that holds art wins (the spot's own first), else the
  // spot's own.
  const used = new Set(
    (Array.isArray(doc.elements) ? doc.elements : []).map((el) => zoneOfElement(el, from)?.id).filter(Boolean),
  );
  const zones = {};
  const chosen = isObject(doc.zones) ? doc.zones : {};
  const byTarget = new Map();
  for (const id of Object.keys(chosen)) {
    const target = targetOf(id);
    if (!target) continue;
    const list = byTarget.get(target) ?? [];
    list.push(id);
    byTarget.set(target, list);
  }
  for (const [target, ids] of byTarget) {
    const own = ids.filter((id) => id === target);
    const others = ids.filter((id) => id !== target);
    const pick = [...own, ...others].find((id) => used.has(id)) ?? own[0] ?? others[0];
    const entry = isObject(chosen[pick]) ? { ...chosen[pick] } : chosen[pick];
    if (isObject(entry) && entry.shape !== undefined) {
      const shape = toZone(target)?.shape ?? LABEL_SHAPES[target];
      if (shape) entry.shape = shape;
      else delete entry.shape;
    }
    zones[target] = entry;
  }

  return { ...doc, dieId: to.id, zones, elements };
}
