// Editing on the 3D can cooler (v1.16.0): the can's side of the on-model
// editor the hats have had since v1.12.0. The same session drives both
// (hat-edit.js createEditSession, with hat-place.js's placer and
// hat-surface.js's map); this file is what is the can's own:
//
// - createCanLook: the can's texture, as a `look` the session takes: the
//   committed paint (paintCanCooler's pixels), the camera on a side, how much
//   of the editor a side fills, the window the camera turns in, and the live
//   repaint of a piece being dragged (buildSprite / beginLive / liveFrame /
//   endLive, hat-look.js's contract).
// - canEditDie: a koozie die as the hat helpers (hat-edit-host.js pieceOf,
//   piecesOf, commitPatch, createPieceArtCache) take a die: its stage, its
//   px/in, and its three sides as zones with an AREA (where art may sit) and a
//   CAP. A side's area is its region on the die (core/confine.js
//   faceRegions): the panels their rects, the base its disc.
// - canSpotLimits: a side as the placer takes it (hat-edit-host spotLimits'
//   shape), and canRestArt: the whole die's art without the piece being moved.
//
// The surface the session maps the screen with is
// models/can-cooler-<size>-surface.json (scripts/extract-can-surface.mjs),
// fetched by the host with hat-edit.js loadSurfaceJson, same-origin.
//
// The can's UVs ARE the die's stage frame, so unlike the hat (a canvas pair
// per spot), the can has one texture the size of the die: a live frame
// repaints and uploads all of it. textureScale (hat-edit PHONE_TEXTURE_SCALE
// on a phone) is what makes that cheap.
//
// It touches the DOM only through the <model-viewer> it is given, injects no
// style and fetches nothing.

import { diesOfKind, dieGeometry, resolveDie } from "../core/dies.js";
import { faceRegions } from "../core/confine.js";
import { areaHome } from "../core/region.js";
import { HOLD_MAX_MS } from "./hat-look.js";
import { CAN_COOLER_VIEW, REDUCED_MOTION, attachCanCoolerTexture, paintCanCooler } from "./can-cooler.js";
import { parseOrbit } from "./hat-edit.js";

const RAD = Math.PI / 180;
const IN_M = 0.0254;

/** The can cooler's sides, as zones, in the order the die lists them. */
export const CAN_EDIT_ZONES = Object.freeze(["front", "back", "base"]);

/** Each side's name in a sentence (the placer's notes: "The front panel's logo area ends here."). */
export const CAN_SPOT_NAMES = Object.freeze({ front: "front panel", back: "back panel", base: "base" });

/**
 * Each side's LEVEL, degrees as `rotation` is stored: the turn at which art
 * reads upright on the can, which the designer calls 0°. The back panel prints
 * upside down in the die (its zone is `flipped`), so it is 180. The base reads
 * upright from the front, below: its front fold is the die's upper chord.
 */
export const CAN_SPOT_LEVELS = Object.freeze({ front: 0, back: 180, base: 0 });

/** The base's area is its disc as a polygon of this many sides, on the circle: within 0.15 px of it on both dies. */
export const CAN_BASE_SIDES = 96;

/**
 * Each side's camera: the orbit's angles (degrees) and where it aims, as a
 * share of the sleeve's height up its axis (`at`; null is model-viewer's own
 * target, the approved view's). The panels from a little above eye level,
 * as the approved view (CAN_COOLER_ORBITS); the base from below at the
 * viewer's own limit (CAN_COOLER_VIEW max-camera-orbit, 150°).
 */
export const CAN_EDIT_VIEWS = Object.freeze({
  front: Object.freeze({ theta: 0, phi: 80, at: 0.5 }),
  back: Object.freeze({ theta: 180, phi: 80, at: 0.5 }),
  base: Object.freeze({ theta: 0, phi: 150, at: 0 }),
  whole: Object.freeze({ theta: 0, phi: 80, at: null }),
});

/**
 * How much of the editor a side fills once fitted (hat-edit.js SPOT_FILL's
 * shape). More than a hat's spot: the can is small on the page, and a panel
 * filling 80% of a laptop editor's height still leaves the can round it in
 * view.
 */
export const CAN_EDIT_FILL = Object.freeze({
  narrow: Object.freeze({ w: 0.85, h: 0.7 }),
  wide: Object.freeze({ w: 0.6, h: 0.8 }),
});

/**
 * How far a drag on bare sleeve turns the can from a side's view, degrees
 * either way. Wider than a hat's (30 by 15): a panel goes half way round the
 * can, so it takes a wider turn to see its edge. The base turns freely round
 * the axis and tilts up toward the panels.
 */
export const CAN_ORBIT_WINDOW = Object.freeze({
  panel: Object.freeze({ theta: 45, phi: 20 }),
  base: Object.freeze({ theta: 60, phi: 20 }),
});

// The viewer's own polar limits (CAN_COOLER_VIEW), which a window never passes.
const PHI_MIN = parseOrbit(CAN_COOLER_VIEW["min-camera-orbit"]).phi;
const PHI_MAX = parseOrbit(CAN_COOLER_VIEW["max-camera-orbit"]).phi;
const FOV_DEG = parseFloat(CAN_COOLER_VIEW["field-of-view"]);

/** The orbit window (radians, [min, max] each) round a side's view at theta, phi degrees, kept within the viewer's polar limits. */
export function canOrbitWindow(spot, theta, phi) {
  const w = spot === "base" ? CAN_ORBIT_WINDOW.base : CAN_ORBIT_WINDOW.panel;
  const lo = Math.max(PHI_MIN, phi - w.phi);
  const hi = Math.min(PHI_MAX, phi + w.phi);
  return { theta: [(theta - w.theta) * RAD, (theta + w.theta) * RAD], phi: [lo * RAD, hi * RAD] };
}

// ---- The die, as the hat helpers take it ------------------------------------------------

const editDies = new Map();
const inches = (px, ppi) => Math.round((px / ppi) * 1e4) / 1e4;

/**
 * A koozie die (an id, a legacy size or a die) as the hat helpers take a die:
 * `{ id, kind: "koozie", stage, pxPerInch, zones }`, each zone `{ id, rect,
 * area, maxImprint }`. `rect` is the side's bounding box (die px), `area`
 * region.js's: the panels their rects, the base its disc as a CAN_BASE_SIDES
 * polygon on the circle. `maxImprint` is the bounding box in inches (to 1e-4,
 * as the die's measurements are given): a koozie side has no cap smaller
 * than itself. Frozen, and the same object every time for a die. Throws for
 * a die that is not a koozie (resolveDie with its kind).
 *
 * @param {string | { id: string }} dieOrId
 */
export function canEditDie(dieOrId) {
  const die = resolveDie(dieOrId, { kind: "koozie" });
  const hit = editDies.get(die.id);
  if (hit) return hit;
  const geom = dieGeometry(die);
  const ppi = geom.pxPerInch;
  const regions = faceRegions(geom);
  const zone = (id, rect, area) =>
    Object.freeze({ id, rect, area, maxImprint: Object.freeze({ w: inches(rect.w, ppi), h: inches(rect.h, ppi) }) });
  const panel = (id) => {
    const { x0, y0, x1, y1 } = regions[id];
    const rect = Object.freeze({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    return zone(id, rect, rect);
  };
  const { cx, cy, r } = regions.base;
  const outline = [];
  for (let k = 0; k < CAN_BASE_SIDES; k++) {
    const a = (2 * Math.PI * k) / CAN_BASE_SIDES;
    outline.push(Object.freeze([cx + r * Math.cos(a), cy + r * Math.sin(a)]));
  }
  const base = zone(
    "base",
    Object.freeze({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }),
    Object.freeze({ outline: Object.freeze(outline), holes: Object.freeze([]) }),
  );
  const out = Object.freeze({
    id: die.id,
    kind: "koozie",
    stage: Object.freeze({ width: die.stage.width, height: die.stage.height }),
    pxPerInch: ppi,
    zones: Object.freeze([panel("front"), panel("back"), base]),
  });
  editDies.set(die.id, out);
  return out;
}

const limitsByDie = new WeakMap();

/**
 * A side of a koozie die as the placer takes it, hat-edit-host spotLimits'
 * shape: `{ zone, area, cap, maxImprint, pxPerInch, level, labels: { spot },
 * snapX? }`, `cap` die px (the side's bounding box: nothing smaller limits a
 * koozie side), `snapX` the base's centre line (a polygon area's home, as a
 * hat's; a panel's rect snaps to its own centre lines in the placer). The
 * same object each time for a die and side; null for a side not on it, or a
 * die that is not a koozie.
 *
 * @param {any} die canEditDie's, or anything canEditDie takes
 * @param {string} zoneId
 */
export function canSpotLimits(die, zoneId) {
  if (!die) return null;
  let d;
  try {
    d = canEditDie(die);
  } catch {
    return null;
  }
  let byZone = limitsByDie.get(d);
  if (!byZone) limitsByDie.set(d, (byZone = new Map()));
  if (byZone.has(zoneId)) return byZone.get(zoneId);
  const zone = d.zones.find((z) => z.id === zoneId) ?? null;
  let limits = null;
  if (zone) {
    const home = Array.isArray(zone.area.outline) ? areaHome(zone.area) : null;
    limits = Object.freeze({
      zone: zone.id,
      area: zone.area,
      cap: Object.freeze({ w: zone.rect.w, h: zone.rect.h }),
      maxImprint: zone.maxImprint,
      pxPerInch: d.pxPerInch,
      ...(home ? { snapX: home[0] } : {}),
      level: CAN_SPOT_LEVELS[zone.id],
      labels: Object.freeze({ spot: CAN_SPOT_NAMES[zone.id] }),
    });
  }
  byZone.set(zoneId, limits);
  return limits;
}

/**
 * The whole die's art without one piece (the session's `restArt`): the
 * stage's art layer, pattern and every side included, without that element
 * and without the ground colour, at `scale` output px per die px (1, the
 * die's size, by default; the look draws it to its texture's size, so pass
 * its textureScale). Null without a stage.
 *
 * @param {{ exportArtCanvas: Function } | null | undefined} stage
 * @param {string} exceptId
 * @param {{ scale?: number }} [options]
 */
export function canRestArt(stage, exceptId, { scale } = {}) {
  if (!stage?.exportArtCanvas) return null;
  return stage.exportArtCanvas({ color: false, exclude: [exceptId], ...(scale ? { scale } : {}) }) ?? null;
}

// ---- The look --------------------------------------------------------------------------

/** The koozie die a stage frame is (the frames are pinned, so the frame names it), or null. */
function koozieOfStage(stage) {
  return diesOfKind("koozie").find((d) => d.stage.width === stage?.width && d.stage.height === stage?.height) ?? null;
}

/**
 * The can's look for an edit session, bound to a <model-viewer> whose src is
 * that can cooler's model (CAN_COOLER_VIEW). On every model load (one already
 * loaded included) it binds a canvas texture of `stage` times `textureScale`
 * to the sleeve's `print` and `print_seam` materials (attachCanCoolerTexture),
 * then calls `onReady`; the host paints then.
 *
 * - paint({ color, art, magnet }) -> boolean: the committed paint, exactly
 *   paintCanCooler's: the colour, `art` (the stage's art layer without its
 *   ground, at any scale: DesignStage exportArtCanvas({ color: false })) drawn
 *   upside down to the texture's size, the thread in the colour, the magnet
 *   shown or not. False before the model and texture, or without art. It is
 *   the handover that ends a held live frame. The look keeps this design (by
 *   reference: the art canvas is the host's, so keep it whole until the next
 *   paint) to show again when a live edit is cancelled. A paint that comes
 *   while a piece is being dragged is shown when the drag ends.
 * - view(spot): the camera on "front" | "back" | "base" | "whole"
 *   (CAN_EDIT_VIEWS) at a numeric radius, never "auto": the radius the camera
 *   had on the approved view's auto goal, kept from when it last had one,
 *   else one that frames the can. A jump under reduced motion.
 * - fill, orbitWindow: CAN_EDIT_FILL and canOrbitWindow, which fitSpot and
 *   createEditSession use in place of the hat's.
 * - buildSprite(zoneId, art, { scale = 1 }) -> { color, w, h, pad: 0 } | null:
 *   the piece's art itself (no method layers), sprite px die px at `scale`.
 * - beginLive(zoneId, { rest }) -> boolean: `rest` is the whole die's art
 *   without the piece (canRestArt), at any resolution, or null. False before
 *   the first paint or for a side not on the can.
 * - liveFrame(zoneId, sprite, m) -> boolean: one frame. The colour, the rest,
 *   then the sprite under `m` (die px from sprite px, hat-look pieceMatrix's)
 *   clipped to the side's region (a panel's rect, the base's disc), all upside
 *   down, and the texture uploads. Canvas calls on numbers only.
 * - endLive(zoneId, { now, changed, sprite, m }): hat-look's. With `sprite`
 *   and `m` the pose the piece came to rest at is drawn and HELD until the
 *   next paint or HOLD_MAX_MS; `now` shows the committed paint at once, and
 *   so does `changed: false` unless an earlier drag's result is still to
 *   come. A press that never drew leaves the texture as it was.
 * - dispose(), and `texture` (attachCanCoolerTexture's, for canCoolerPicture
 *   or a host's own paint).
 *
 * What a frame costs: one fill and one blit of the texture's size, one
 * clipped, transformed draw of the piece, and an upload of the whole texture
 * (1000 x 2000 RGBA, 8 MB, for the standard can at textureScale 1; 2.9 MB at
 * a phone's 0.6). Pass `rest` at the texture's scale so its blit is 1:1.
 *
 * @param {any} mv the <model-viewer>
 * @param {{ stage: { width: number, height: number }, textureScale?: number, onReady?: () => void }} options
 */
export function createCanLook(mv, { stage, textureScale = 1, onReady } = /** @type {any} */ ({})) {
  const W = stage.width;
  const H = stage.height;
  const T = textureScale > 0 && Number.isFinite(textureScale) ? textureScale : 1;
  const cw = Math.max(1, Math.round(W * T));
  const ch = Math.max(1, Math.round(H * T));
  const kx = cw / W;
  const ky = ch / H;
  const die = koozieOfStage(stage);
  // The sleeve is the panel's height, standing on the model's origin (the
  // storefront's scripts/blender/can-cooler/model.py).
  const sleeveM = die ? die.measurements.panelH * IN_M : null;
  // Each side's clip, die px: a panel's rect, the base's disc.
  const clips = {};
  if (die) {
    const regions = faceRegions(dieGeometry(die));
    for (const id of CAN_EDIT_ZONES) {
      const r = regions[id];
      clips[id] = r.kind === "circle"
        ? { circle: true, x: r.cx, y: r.cy, w: 0, h: 0, r: r.r }
        : { circle: false, x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, r: 0 };
    }
  }
  const reduced = () => !!globalThis.matchMedia?.(REDUCED_MOTION)?.matches;

  let texture = null;
  let g = null;
  /** The committed design, as last painted: { color, art, magnet }. */
  let last = null;
  /** A paint that came mid-drag, to show when the drag ends. */
  let pending = false;
  /** The drag being painted: { zoneId, clip, rest, drawn }. */
  let live = null;
  let held = false;
  let holdTimer = 0;
  let autoRadius = null;

  function onLoad() {
    if (!mv.model) return;
    release();
    live = null;
    texture = attachCanCoolerTexture(mv, { width: cw, height: ch });
    g = texture.source.element.getContext("2d");
    onReady?.();
  }

  function release() {
    clearTimeout(holdTimer);
    holdTimer = 0;
    held = false;
  }

  /** The committed design again (a cancel, a hold run out). Nothing when its art is gone. */
  function showCommitted() {
    pending = false;
    if (!last?.art?.width || !last.art.height || !texture) return false;
    return paintCanCooler(mv, texture, last);
  }

  function hold() {
    clearTimeout(holdTimer);
    held = true;
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      held = false;
      // a drag under way is its endLive's to repaint
      if (!live) showCommitted();
    }, HOLD_MAX_MS);
  }

  function paint({ color, art, magnet = false } = /** @type {any} */ ({})) {
    if (!mv?.model || !texture || !art) return false;
    last = { color, art, magnet };
    release();
    if (live) {
      pending = true;
      return true;
    }
    pending = false;
    return paintCanCooler(mv, texture, last);
  }

  /** The radius view() sets: the approved view's auto radius, as the camera last had it on an auto goal. */
  function viewRadius() {
    const goal = parseOrbit(mv.cameraOrbit).radius;
    if (!(goal > 0)) {
      // The goal is "auto" (the host's approved view, a turn, a picture's shots): the camera is on it.
      const r = mv.getCameraOrbit?.()?.radius;
      if (Number.isFinite(r) && r > 0) autoRadius = r;
    }
    if (autoRadius) return autoRadius;
    // Never measured: the whole can, its top included, in the field of view's height.
    const tall = (sleeveM ?? 0.1) * 1.25;
    return (1.1 * tall) / 2 / Math.tan((FOV_DEG * RAD) / 2);
  }

  function view(spot) {
    const v = CAN_EDIT_VIEWS[spot] ?? CAN_EDIT_VIEWS.whole;
    const r = viewRadius();
    mv.cameraTarget = v.at == null || sleeveM == null ? "auto auto auto" : `0m ${+(v.at * sleeveM).toFixed(6)}m 0m`;
    mv.cameraOrbit = `${v.theta}deg ${v.phi}deg ${+r.toFixed(6)}m`;
    if (reduced()) mv.jumpCameraToGoal();
  }

  function buildSprite(zoneId, art, { scale = 1 } = {}) {
    if (!clips[zoneId] || !art?.width || !art.height || !(scale > 0) || !Number.isFinite(scale)) return null;
    return { color: art, w: art.width * scale, h: art.height * scale, pad: 0 };
  }

  function beginLive(zoneId, { rest = null } = {}) {
    const clip = clips[zoneId];
    if (!clip || !texture || !g || !mv.model || !last) return false;
    // A hold from the drag before stays: if this press never draws, that
    // frame is still what the can shows, and its result may be on its way.
    live = { zoneId, clip, rest: rest?.width && rest.height ? rest : null, drawn: false };
    return true;
  }

  /**
   * The per-frame path: canvas calls on numbers only, no allocation.
   * @param {string} zoneId
   * @param {{ color: any, w: number, h: number } | null | undefined} sprite
   * @param {ArrayLike<number>} m
   */
  function liveFrame(zoneId, sprite, m) {
    const L = live;
    if (!L || L.zoneId !== zoneId || !g || !last || !sprite?.color?.width || !sprite.color.height) return false;
    const c = L.clip;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = last.color;
    g.fillRect(0, 0, cw, ch);
    // die px to the texture, upside down (three.js uploads a canvas flipped)
    g.setTransform(kx, 0, 0, -ky, 0, ch);
    if (L.rest) g.drawImage(L.rest, 0, 0, W, H);
    g.beginPath();
    if (c.circle) {
      g.moveTo(c.x + c.r, c.y);
      g.arc(c.x, c.y, c.r, 0, 2 * Math.PI, false);
      g.closePath();
    } else {
      g.rect(c.x, c.y, c.w, c.h);
    }
    g.clip();
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "low";
    // over the sprite's w x h die px, whatever the art's own resolution
    g.drawImage(sprite.color, 0, 0, sprite.w, sprite.h);
    g.restore();
    texture.source.update();
    L.drawn = true;
    return true;
  }

  function endLive(zoneId, { now = false, changed = true, sprite = null, m = null } = {}) {
    if (!live || live.zoneId !== zoneId) return;
    // where the piece came to rest, so a hold never shows it pushed past the edge
    if (sprite && m) liveFrame(zoneId, sprite, m);
    const drawn = live.drawn;
    live = null;
    if (!drawn) {
      // the texture shows what it did before the press, a hold included; a
      // paint that came meanwhile shows now
      if (pending) showCommitted();
      return;
    }
    // unchanged, the committed paint is the result, unless an earlier drag's
    // is still to come (it would show that drag's piece where it was before)
    if (now || (!changed && !held)) {
      release();
      showCommitted();
      return;
    }
    hold();
  }

  // Bound last: a model already loaded gets its texture at once.
  mv.addEventListener("load", onLoad);
  if (mv.loaded && mv.model) onLoad();

  return {
    paint,
    view,
    fill: CAN_EDIT_FILL,
    orbitWindow: canOrbitWindow,
    buildSprite,
    beginLive,
    liveFrame,
    endLive,
    /** The texture the design is painted into (attachCanCoolerTexture's), or null before the model. */
    get texture() {
      return texture;
    },
    dispose() {
      mv.removeEventListener("load", onLoad);
      release();
      live = null;
      last = null;
      pending = false;
      texture = null;
      g = null;
    },
  };
}
