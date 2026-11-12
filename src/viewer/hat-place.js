// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/components/storefront/hat/hat-place.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
/**
 * Placing art straight on the 3D hat: the gestures that move, scale and turn a
 * logo or a line of text on its spot, and the outline drawn over the hat while
 * they do. On the placing steps the hat IS the editor, on a phone and on a
 * desktop alike; there is no flat sheet beside it.
 *
 * The decided interaction (the judged design, 2026-10-21):
 * - A piece moves anywhere within its own spot's AREA, never to another spot,
 *   and its turned box stays inside the area and no bigger than the spot's
 *   CAP. hat-confine.js is that rule; this file only feeds it gestures, each
 *   with the gesture's last valid pose (`from`), so on a polygon area (both
 *   front panels, a whole side panel, with keep-outs round the eyelets) a drag
 *   stops at the edge and slides along it, as it does on a rect, and never
 *   jumps an eyelet; a key's nudge follows a gently sloping edge but stops
 *   when pushed into it.
 * - Screen to die is the injected `surface` (a 3x4 camera matrix solved by DLT
 *   from model-viewer hotspots, and the print overlay's own triangles). No
 *   raycasts here, and nothing per frame but a few matrix products: where the
 *   finger leaves the overlay, the die point carries on along the last good
 *   point's local linear map (its jacobian) rather than stopping dead. Only a
 *   true hit counts as good: the surface's own extrapolation off the zone
 *   runs along the nearest boundary triangle, which by the silhouette is
 *   nearly edge-on, so 2 px of finger there can be thousands of die px.
 * - Only fabric that faces the camera is drawn on or pressed: the surface's
 *   dieToScreen projects faces turned away too, so a point counts as seen
 *   when the screen point it projects to maps back to it. Presses are tested
 *   in the die, against the point the finger is actually on.
 * - A live frame calls `onLive` with a pose the host repaints that zone's own
 *   texture from (the rest of the zone plus a transformed sprite of the moving
 *   piece); release calls `onCommit` exactly once, and the full rebuild
 *   happens then.
 *
 * The feel is the can cooler stage's (@reel48/designer DesignStage): pinch,
 * twist and pan as ONE gesture and ONE undo step, and a rubber band of 24
 * screen px past an edge. Turning is the hat's own (Brayden, 2026-10-22: "I
 * want the user to be able to move it one degree at a time"): the knob and a
 * twist turn by whole degrees from the spot's LEVEL (`level`, the turn at
 * which art runs parallel to the bottom of the hat, which the designer calls
 * 0°) and never stick to an angle; Shift on the knob turns 15 at a time. A
 * twist starts turning only once the fingers have turned 4 degrees, so a
 * pinch meant to resize leaves the angle alone. Reaching the level or a right
 * angle from it ticks (`onSnap`) without holding there.
 *
 * It imports only the confine rule; the surface, the camera and every effect
 * come in through `opts`, so the lab page and the storefront drive the same
 * file and the tests drive it with fake surfaces and the real one.
 */

import { areaBounds, areaRect, areaRings, bandPose, confinePose } from "../core/region.js";

/** @typedef {import("../core/region.js").Pose} Pose */

// ---- Settings (CSS px unless said) ----------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
const DEG = Math.PI / 180;
const MM_PER_IN = 25.4;
// Travel before a press becomes a drag: a finger rests less still than a mouse.
const SLOP = { touch: 4, mouse: 2 };
// A press on bare fabric that travels less than this is a tap (deselect).
const TAP_PX = 6;
// A piece takes presses this far outside its drawn outline, and at least a
// 44 px square round its centre (Apple's minimum target), however small it is.
const HIT_SLOP_PX = 12;
const MIN_TARGET_PX = 44;
// Handles: drawn 16 px; a finger needs 44 to hit one, a mouse 24.
const HANDLE_DRAWN_PX = 16;
const HANDLE_HIT_PX = { touch: 44, mouse: 24 };
const KNOB_STALK_PX = 24;
// A knob this near the top of the hat's frame goes below the piece instead.
const KNOB_FLIP_PX = 22;
// How far past a limit a piece may be pulled on screen before it stops giving.
const OVERSHOOT_PX = 24;
// A dragged centre sticks to the area's centre lines within this (a rect's
// two; a polygon's centre seam, x, only).
const CENTRE_SNAP_PX = 8;
// Turning: the knob and a twist by whole degrees from the level, the knob by
// 15 with Shift; a twist begins once the fingers have turned this far.
const TURN_STEP = 1;
const TURN_STEP_SHIFT = 15;
const TWIST_START_DEG = 4;
// The outlines are sampled along the die every 2 mm, so they bend with the crown.
const OUTLINE_STEP_MM = 2;
// Caps on samples an edge, so a piece pinched huge mid-gesture stays cheap to
// draw; the area's are higher, enough for 2 mm along the rebuilt model's front.
const MAX_EDGE_SAMPLES = 48;
const MAX_AREA_EDGE_SAMPLES = 160;
// Keyboard: a nudge is 0.05 in (Shift ten), a turn 1 degree (Shift 15), a
// scale step 5%, an orbit step 15 degrees (Shift 45).
const NUDGE_IN = 0.05;
const KEY_TURN = 1;
const KEY_TURN_BIG = 15;
const KEY_SCALE = 1.05;
const KEY_ORBIT = 15 * DEG;
const KEY_ORBIT_BIG = 45 * DEG;
// The smallest a gesture may take a piece's shorter side, unless it started smaller.
const MIN_SIDE_IN = 0.25;
// A die point is seen when its screen point maps back within this (die px):
// exact on a face toward the camera, and far off on one turned away.
const SEEN_DIE_PX = 2;
// A piece still matches what was last committed for it within these, so a
// host that rounds what it stores does not lose the size a turn shrank.
const SAME_PX = 0.5;
const SAME_DEG = 0.01;
// A key step that moves a piece less than this (die px) changes nothing: on a
// polygon, a nudge into the edge a piece already sits against leaves it a
// hair (2e-6 px) off that edge, which is not a step.
const KEY_SAME_PX = 1e-4;
// The overlay's own stacking order inside the host, which is isolated, so a
// <model-viewer> mounted after it (or remounted) never paints over it.
const OVERLAY_Z = 1;
// The area outline: faint while a piece on the spot is selected, full while a
// gesture holds one.
const AREA_IDLE_OPACITY = 0.35;
const FADE = "opacity 150ms var(--ease-out-strong, ease-out)";
// Colours: the host's own custom properties first, then the storefront theme.
const LINE = "var(--hat-place-line, var(--color-sf-primary, #235fbc))";
const EDGE = "var(--hat-place-edge, var(--color-sf-danger, #a33e3c))";
const HALO = "var(--hat-place-halo, rgba(255, 255, 255, 0.85))";
const HANDLE_FILL = "var(--hat-place-handle, var(--color-sf-surface, #ffffff))";

const MANIP = new Set(["move", "scale", "rotate", "pinch"]);
const CALLBACKS = ["onSelect", "onLive", "onCommit", "onCancel", "onNote", "onSnap", "onDelete"];
// Outline points of a box, in order round it: corners at even indices
// (top-left, top-right, bottom-right, bottom-left), edge midpoints between.
const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

// ---- Pure helpers ------------------------------------------------------------------

/** Degrees wrapped to (-180, 180], as the design document stores rotation. */
export function wrap180(deg) {
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r || 0;
}

/**
 * `deg` turned to the nearest `step` degrees from `level` (the spot's 0°,
 * parallel to the bottom of the hat). Nothing sticks: every step is reached.
 * `at` is that turn from the level, wrapped, when it is the level or a right
 * angle from it (0, 90, 180, -90), else null, so a caller can tick as a turn
 * ARRIVES at one.
 */
export function turnFromLevel(deg, level = 0, step = TURN_STEP) {
  const from = Math.round((deg - level) / step) * step;
  const w = wrap180(from);
  return { rotation: level + from, at: w % 90 === 0 ? w : null };
}

/**
 * The orbit a one-finger drag of (dx, dy) px on bare fabric gives, from where
 * it began: model-viewer's own rate (2 pi radians per frame height) and
 * direction (a drag right turns the hat to follow it), held in `window`.
 *
 * @param {{ theta: number, phi: number }} start radians
 * @param {number} dx
 * @param {number} dy
 * @param {number} height the frame's height, CSS px
 * @param {{ theta?: number[], phi?: number[] } | null} [window] [min, max] radians each
 * @returns {{ theta: number, phi: number }}
 */
export function orbitFrom(start, dx, dy, height, window = null) {
  const k = (2 * Math.PI) / (height > 0 ? height : 1);
  const within = (v, range) => (range ? Math.min(range[1], Math.max(range[0], v)) : v);
  return { theta: within(start.theta - dx * k, window?.theta), phi: within(start.phi - dy * k, window?.phi) };
}

/**
 * An SVG path through projected points, broken where a point did not project
 * (null), closed when `closed` and nothing broke it.
 */
export function pathOf(points, closed = true) {
  const n = points.length;
  if (!n) return "";
  const at = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  if (points.every(Boolean)) return `M${points.map(at).join("L")}${closed ? "Z" : ""}`;
  // Start the walk at a gap, so a run that wraps round the end stays one run.
  const gap = closed ? points.findIndex((p) => !p) : 0;
  const ring = closed ? [...points.slice(gap), ...points.slice(0, gap)] : points;
  let d = "";
  let pen = false;
  for (const p of ring) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${at(p)}`;
    pen = true;
  }
  return d;
}

/** Die points round a `w` x `h` box centred on (cx, cy) and turned `deg`, every `step` along its edges (at most `max` an edge). */
export function boxRing(cx, cy, w, h, deg, step, max = MAX_EDGE_SAMPLES) {
  const a = (deg || 0) * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corner = ([u, v]) => {
    const x = (u * w) / 2;
    const y = (v * h) / 2;
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  };
  const corners = [RING[0], RING[2], RING[4], RING[6]].map(corner);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[(i + 1) % 4];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.min(max, Math.max(1, Math.ceil(len / step)));
    for (let j = 0; j < n; j++) out.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n]);
  }
  return out;
}

/** Die points round a closed ring, every `step` along its edges (at most `max` an edge), vertices included. */
function ringSamples(ring, step, max) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const n = Math.min(max, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)));
    for (let j = 0; j < n; j++) out.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n]);
  }
  return out;
}

/**
 * Die points round an area, every `step` along its edges, one ring each: a
 * rect's box (boxRing), or a polygon's outline and then each hole.
 *
 * @param {{ x: number, y: number, w: number, h: number } | { outline: number[][], holes?: number[][][] }} area
 * @param {number} step die px
 * @param {number} [max] samples at most an edge
 * @returns {number[][][]}
 */
export function areaSamples(area, step, max = MAX_AREA_EDGE_SAMPLES) {
  const r = areaRect(area);
  if (r) return [boxRing(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 0, step, max)];
  return areaRings(area).map((ring) => ringSamples(ring, step, max));
}

/** Where the vertical line at `x` crosses a closed ring: [top, bottom] die y, or null when it misses. */
function verticalSpan(ring, x) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    if (x0 === x1) {
      if (x0 === x) {
        lo = Math.min(lo, y0, y1);
        hi = Math.max(hi, y0, y1);
      }
      continue;
    }
    if ((x - x0) * (x - x1) > 0) continue;
    const y = y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return lo < hi ? [lo, hi] : null;
}

/** The eight outline points of a pose's turned box (RING order), in die px. */
function outlineDie(pose) {
  const a = (pose.rotation || 0) * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return RING.map(([u, v]) => {
    const x = (u * pose.w) / 2;
    const y = (v * pose.h) / 2;
    return [pose.cx + x * cos - y * sin, pose.cy + x * sin + y * cos];
  });
}

/** Screen distance from `p` to a closed ring's drawn runs: segments whose two ends both showed (null is a gap). */
function distanceToRuns(p, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (!ring[i] || !ring[j]) continue;
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/**
 * A jacobian as [a, b, c, d] = [dsx/ddx, dsx/ddy, dsy/ddx, dsy/ddy] (screen px
 * per die px), from the shapes a surface may return it in: [[a, b], [c, d]],
 * [a, b, c, d] or { a, b, c, d }. Null for anything else or a singular one.
 */
export function readJacobian(j) {
  let m = null;
  if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0]) && Array.isArray(j[1])) m = [j[0][0], j[0][1], j[1][0], j[1][1]];
  else if (Array.isArray(j) && j.length === 4) m = [...j];
  else if (j && typeof j === "object" && "a" in j) m = [j.a, j.b, j.c, j.d];
  if (!m || !m.every(Number.isFinite)) return null;
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.abs(det) > 1e-12 ? m : null;
}

const hypot = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrapPi = (r) => (r > Math.PI ? r - 2 * Math.PI : r < -Math.PI ? r + 2 * Math.PI : r);
const kindOf = (e) => (e.pointerType === "touch" ? "touch" : "mouse");
const inches = (px, ppi) => String(Number((px / ppi).toFixed(2)));

// ---- The placer -------------------------------------------------------------------

/**
 * Put the placing gestures and their outline on `host`, the element the 3D
 * hat is drawn in (it should be positioned; a static one is made relative).
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {{ screenToDie: (zone: string, sx: number, sy: number, options?: { extrapolate?: boolean }) => ({ x: number, y: number, inside?: boolean } | null),
 *   dieToScreen: (zone: string, dx: number, dy: number) => ([number, number] | null),
 *   jacobian?: (zone: string, dx: number, dy: number) => any }} opts.surface
 *   hat-surface.js's createSurface, or anything shaped like it. Screen coords
 *   are CSS px from the host's top-left. A result with `inside: false` is an
 *   extrapolation off the zone and is never used as a hit (the placer asks
 *   for none with `extrapolate: false`, and ignores one given anyway).
 *   `jacobian` is screen px per die px at a die point,
 *   [[dsx/ddx, dsx/ddy], [dsy/ddx, dsy/ddy]]; when it is absent or returns
 *   nothing usable, it is found from dieToScreen.
 * @param {string} opts.zone the spot being placed on (a die zone id)
 * @param {{ x: number, y: number, w: number, h: number } | { outline: number[][], holes?: number[][][] }} opts.area
 *   where a piece may sit, die px: a rect, or the die zone's `area` polygon
 *   (outline and keep-out holes, the printable region after margins). Pass
 *   the same object while the zone is the same: hat-confine.js reads a
 *   polygon once per outline array.
 * @param {{ w: number, h: number }} opts.cap die px
 * @param {{ id: string, cx: number, cy: number, w: number, h: number, rotation?: number, label?: string }[]} opts.pieces
 *   the zone's pieces in die px, topmost last
 * @param {string | null} [opts.selectedId]
 * @param {{ getOrbit: () => { theta: number, phi: number }, setOrbit: (o: { theta: number, phi: number }) => void,
 *   window?: { theta?: number[], phi?: number[] }, onMove?: (cb: () => void) => (() => void) | void } | null} [opts.camera]
 * @param {{ spot?: string, size?: (cap: { w: number, h: number }) => string }} [opts.labels]
 *   the spot's name in a sentence ("left side") and the cap as the customer
 *   reads it; the size defaults to inches at `pxPerInch` ("4.5 × 2.25 in").
 * @param {number} [opts.pxPerInch=200]
 * @param {number} [opts.minPx] a gesture's floor on the shorter side, die px (0.25 in)
 * @param {boolean} [opts.snapCentre=true] stick a dragged centre to the area's centre lines: a
 *   rect's two; on a polygon, the vertical line at `snapX` only
 * @param {number | false} [opts.snapX] on a polygon area, the die x a dragged centre sticks to
 *   (the front's centre seam); by default the polygon's horizontal centre; false for none
 * @param {number} [opts.level=0] the spot's level, degrees: the turn at which art runs parallel
 *   to the bottom of the hat (hat-config SPOT_LEVELS), which turns count from
 * @param {boolean} [opts.reducedMotion=false]
 * @param {number | string} [opts.zIndex=1] the overlay's z-index inside the host (the host is isolated, so it stays local)
 * @param {(cb: FrameRequestCallback) => any} [opts.requestFrame] for tests; requestAnimationFrame
 * @param {(id: any) => void} [opts.cancelFrame]
 * @param {(id: string | null) => void} [opts.onSelect]
 * @param {(id: string, pose: Pose, info: { pushed: boolean, kind: string }) => void} [opts.onLive] every frame of a gesture
 * @param {(id: string, pose: Pose) => void} [opts.onCommit] once per gesture, and per key step
 * @param {(id: string) => void} [opts.onCancel] Escape: the host puts the piece back
 * @param {(text: string) => void} [opts.onNote] a limit was met
 * @param {() => void} [opts.onSnap] a snap engaged, or a turn reached the level or a right angle from it (a haptic tick, say)
 * @param {(id: string) => void} [opts.onDelete] Delete or Backspace
 * @returns {{ update: (next: object) => void, cancel: () => boolean, destroy: () => void }}
 */
export function createPlacer(host, opts = {}) {
  const doc = host.ownerDocument ?? globalThis.document;
  const view = doc?.defaultView ?? globalThis;
  const requestFrame = opts.requestFrame ?? ((cb) => view.requestAnimationFrame(cb));
  const cancelFrame = opts.cancelFrame ?? ((id) => view.cancelAnimationFrame(id));
  const surface = opts.surface;
  const ppi = opts.pxPerInch > 0 ? opts.pxPerInch : 200;
  const minPx = opts.minPx ?? MIN_SIDE_IN * ppi;
  const snapCentre = opts.snapCentre !== false;
  const step = (OUTLINE_STEP_MM / MM_PER_IN) * ppi;

  let zone = opts.zone;
  let area = opts.area ? { ...opts.area } : null;
  let cap = opts.cap ? { ...opts.cap } : null;
  let pieces = (opts.pieces ?? []).map((p) => ({ ...p }));
  let selectedId = opts.selectedId ?? null;
  let snapXOpt = opts.snapX;
  let level = Number.isFinite(opts.level) ? opts.level : 0;
  let labels = opts.labels ?? {};
  let reducedMotion = !!opts.reducedMotion;
  let camera = opts.camera ?? null;
  const cb = {};
  for (const name of CALLBACKS) cb[name] = typeof opts[name] === "function" ? opts[name] : null;

  /** The gesture in progress, or null; `spent` holds fingers still down after one ended. */
  let g = null;
  const pointers = new Map();
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  let frame = null;
  let dirty = true;
  let hoverAt = null;
  let areaSampled = null;
  let lastPxPerDie = 1;
  let unsubscribeCamera = null;
  let destroyed = false;
  /**
   * The size the customer last asked a piece to be when a turn shrank it to
   * fit, so turning it back gives that size again instead of ratcheting it
   * down a step at a time: { id, w, h, at }, `at` the size and rotation then
   * committed. It holds while the piece still matches `at` (a move keeps it);
   * a resize, or the host giving the piece another size, ends it.
   */
  let intent = null;

  // ---- The surface, made safe to call ---------------------------------------------
  /** Where a die point projects, whether or not its face is turned to the camera. */
  const toScreen = (x, y) => {
    const s = surface?.dieToScreen?.(zone, x, y);
    return s && Number.isFinite(s[0]) && Number.isFinite(s[1]) ? [s[0], s[1]] : null;
  };
  /** The die point a screen point is ON: the zone's fabric facing the camera, or null (never an extrapolation). */
  const toDie = (sx, sy) => {
    const d = surface?.screenToDie?.(zone, sx, sy, { extrapolate: false });
    return d && d.inside !== false && Number.isFinite(d.x) && Number.isFinite(d.y) ? [d.x, d.y] : null;
  };
  /**
   * A die point's screen point when the camera sees it there, else null: its
   * screen point maps back to it. The round trip lets the surface extrapolate,
   * which only ever agrees on a hair past the mesh (a label card's UVs stop
   * 0.2 px inside its rect); a face turned away lands on other fabric, or
   * none, and disagrees.
   */
  function seen(x, y) {
    const s = toScreen(x, y);
    if (!s) return null;
    const back = surface?.screenToDie?.(zone, s[0], s[1]);
    return back && Number.isFinite(back.x) && Number.isFinite(back.y) && Math.hypot(back.x - x, back.y - y) <= SEEN_DIE_PX ? s : null;
  }
  /** Screen px per die px at a die point, as [a, b, c, d]: the surface's, else found by differences. */
  function jacobianAt(x, y) {
    const given = surface?.jacobian ? readJacobian(surface.jacobian(zone, x, y)) : null;
    if (given) return given;
    const h = 2;
    const s0 = toScreen(x, y);
    const sx = toScreen(x + h, y);
    const sy = toScreen(x, y + h);
    if (!s0 || !sx || !sy) return null;
    return readJacobian([(sx[0] - s0[0]) / h, (sy[0] - s0[0]) / h, (sx[1] - s0[1]) / h, (sy[1] - s0[1]) / h]);
  }
  /** Die px per screen px at a die point (the jacobian's inverse), or null; `orient` (+1/-1) refuses one mirrored the other way. */
  function inverseAt(x, y, orient = 0) {
    const m = jacobianAt(x, y);
    if (!m) return null;
    const det = m[0] * m[3] - m[1] * m[2];
    if (orient && Math.sign(det) !== orient) return null;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  }
  /** Screen px per die px, as one number, where a pose sits: what turns screen limits into die px. */
  function pxPerDieAt(pose) {
    const m = jacobianAt(pose.cx, pose.cy);
    if (m) lastPxPerDie = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || lastPxPerDie;
    return lastPxPerDie;
  }
  /** +1 when the die reads the right way round on screen, -1 when mirrored: a screen twist's sign in the die. */
  function orientAt(pose) {
    const m = jacobianAt(pose.cx, pose.cy);
    return m && m[0] * m[3] - m[1] * m[2] < 0 ? -1 : 1;
  }
  /**
   * The die point under a pointer for one gesture: the zone's own where the
   * pointer is on it, else carried on from the last true hit along its local
   * linear map, so a drag past the overlay's edge (or the silhouette) keeps
   * going, steadily, into the rubber band instead of freezing or jumping.
   * Starts anchored on the piece's centre.
   */
  function tracker(pose) {
    const c = toScreen(pose.cx, pose.cy);
    let anchor = c ? { d: [pose.cx, pose.cy], s: c, inv: undefined } : null;
    let last = null;
    return (p) => {
      const hit = toDie(p[0], p[1]);
      if (hit) {
        anchor = { d: hit, s: [p[0], p[1]], inv: undefined };
        return (last = hit);
      }
      if (!anchor) return last;
      if (anchor.inv === undefined) anchor.inv = inverseAt(anchor.d[0], anchor.d[1]);
      if (!anchor.inv) return last;
      const [a, b, c2, d] = anchor.inv;
      const dx = p[0] - anchor.s[0];
      const dy = p[1] - anchor.s[1];
      return (last = [anchor.d[0] + a * dx + b * dy, anchor.d[1] + c2 * dx + d * dy]);
    };
  }

  // ---- Pieces --------------------------------------------------------------------
  const pieceById = (id) => (id == null ? null : pieces.find((p) => p.id === id) ?? null);
  const selectedPiece = () => pieceById(selectedId);
  const poseOf = (p) => ({ cx: p.cx, cy: p.cy, w: p.w, h: p.h, rotation: p.rotation || 0 });
  const poseOut = (p) => ({ cx: p.cx, cy: p.cy, w: p.w, h: p.h, rotation: wrap180(p.rotation) });
  /** A gesture's floor: MIN_SIDE_IN, or the piece's own shorter side when it started smaller (never a jump). */
  const floorFor = (pose) => Math.min(minPx, Math.min(pose.w, pose.h));
  /**
   * The confine rule's limits. On a polygon area `from`, the last valid pose,
   * is where every move travels from (never hopping a hole): a gesture slides
   * along the edge it meets; a key's step (`slide: "step"`) slides only while
   * it still goes mostly the key's way, so Left follows the sloping crease and
   * Down onto it stops.
   */
  const limits = (from = null, slide = true) => ({ area, cap, from, slide });
  /** The lines a dragged centre sticks to: a rect's centre lines, a polygon's `snapX` (x only), or null. */
  function snapLines() {
    if (!snapCentre || !area) return null;
    const r = areaRect(area);
    if (r) return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    if (snapXOpt === false) return null;
    const b = areaBounds(area);
    const x = Number.isFinite(snapXOpt) ? snapXOpt : b ? b.x + b.w / 2 : null;
    return x == null ? null : { x, y: null };
  }
  function setLocalPose(id, pose) {
    pieces = pieces.map((p) => (p.id === id ? { ...p, ...pose } : p));
  }
  /** The size to turn a piece at: what was asked for before a turn shrank it, while that still holds. */
  function askedSize(piece) {
    const i = intent;
    const holds =
      i && i.id === piece.id && Math.abs(piece.w - i.at.w) <= SAME_PX && Math.abs(piece.h - i.at.h) <= SAME_PX &&
      Math.abs(wrap180((piece.rotation || 0) - i.at.rotation)) <= SAME_DEG;
    return holds ? { w: i.w, h: i.h } : { w: piece.w, h: piece.h };
  }
  /** After a commit: a turn remembers what it was asked at; a move leaves the memory to `askedSize`; a resize ends it. */
  function remember(id, kind, asked, pose) {
    if (kind === "rotate") intent = { id, w: asked.w, h: asked.h, at: { w: pose.w, h: pose.h, rotation: pose.rotation } };
    else if (kind !== "move" && intent?.id === id) intent = null;
  }

  /** A pose's outline (RING order) and centre on screen, null wherever the camera does not see that point. */
  function projectPose(pose) {
    return { ring: outlineDie(pose).map(([x, y]) => seen(x, y)), centre: seen(pose.cx, pose.cy) };
  }
  /** Where the selected piece's handles are drawn, and so where they are hit. */
  function handlesOf(pose) {
    const { ring, centre } = projectPose(pose);
    const corners = [ring[0], ring[2], ring[4], ring[6]];
    let knob = null;
    let stalk = null;
    const off = (mid) => {
      if (!mid || !centre) return null;
      const len = hypot(mid, centre);
      const dir = len > 1e-6 ? [(mid[0] - centre[0]) / len, (mid[1] - centre[1]) / len] : [0, -1];
      return { at: [mid[0] + dir[0] * KNOB_STALK_PX, mid[1] + dir[1] * KNOB_STALK_PX], from: mid };
    };
    let k = off(ring[1]);
    if (!k || k.at[1] < KNOB_FLIP_PX) k = off(ring[5]) ?? k;
    if (k) {
      knob = k.at;
      stalk = k.from;
    }
    return { ring, centre, corners, knob, stalk };
  }
  /**
   * Whether a press takes a piece. On the zone's fabric (`at`: the die point
   * pressed, and the jacobian there) it is decided in the die, so a piece on a
   * face turned away, whose projection lands on fabric that is some other die
   * point, is never taken: the press is inside the piece's turned box, within
   * HIT_SLOP_PX of it, or within the 44 px target round its centre, the
   * screen px measured through the jacobian. Off the fabric (just past a
   * label card's edge, say) only the outline as it shows counts.
   */
  function bodyHit(pose, p, at) {
    if (at) {
      const [J, d] = at;
      const r = (pose.rotation || 0) * DEG;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const ox = d[0] - pose.cx;
      const oy = d[1] - pose.cy;
      // Into the piece's unturned frame, out to its box's nearest point, and back.
      const lx = ox * cos + oy * sin;
      const ly = -ox * sin + oy * cos;
      const ex = lx - Math.max(-pose.w / 2, Math.min(pose.w / 2, lx));
      const ey = ly - Math.max(-pose.h / 2, Math.min(pose.h / 2, ly));
      const vx = ex * cos - ey * sin;
      const vy = ex * sin + ey * cos;
      if (Math.hypot(J[0] * vx + J[1] * vy, J[2] * vx + J[3] * vy) <= HIT_SLOP_PX) return true;
      return Math.abs(J[0] * ox + J[1] * oy) <= MIN_TARGET_PX / 2 && Math.abs(J[2] * ox + J[3] * oy) <= MIN_TARGET_PX / 2;
    }
    const { ring, centre } = projectPose(pose);
    if (distanceToRuns(p, ring) <= HIT_SLOP_PX) return true;
    return !!centre && Math.abs(p[0] - centre[0]) <= MIN_TARGET_PX / 2 && Math.abs(p[1] - centre[1]) <= MIN_TARGET_PX / 2;
  }
  /**
   * What a press at `p` takes: the selected piece's handles first (a handle
   * only when the press is nearer it than the piece's centre, so a small
   * piece can still be dragged), then the selected piece, then the topmost.
   * Handles count only where they show.
   */
  function hitTest(p, kind) {
    const d = toDie(p[0], p[1]);
    const J = d ? jacobianAt(d[0], d[1]) : null;
    const at = d && J ? [J, d] : null;
    const sel = selectedPiece();
    if (sel) {
      const h = handlesOf(sel);
      const r = HANDLE_HIT_PX[kind] / 2;
      let best = null;
      const consider = (at, what, corner) => {
        if (!at) return;
        const d = hypot(p, at);
        if (d <= r && (!h.centre || d < hypot(p, h.centre)) && (!best || d < best.d)) best = { d, what, corner };
      };
      h.corners.forEach((at, i) => consider(at, "corner", i));
      consider(h.knob, "knob", -1);
      if (best) return { kind: best.what, id: sel.id, corner: best.corner };
      if (bodyHit(sel, p, at)) return { kind: "body", id: sel.id };
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieces[i].id !== selectedId && bodyHit(pieces[i], p, at)) return { kind: "body", id: pieces[i].id };
    }
    return null;
  }

  // ---- Overlay ---------------------------------------------------------------------
  const el = (tag, attrs = {}, style = {}) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    Object.assign(node.style, style);
    return node;
  };
  const halo = { fill: "none", stroke: HALO, strokeWidth: "3.5", strokeLinejoin: "round" };
  const line = { fill: "none", stroke: LINE, strokeWidth: "1.5", strokeLinejoin: "round" };
  // A z-index of its own, not DOM order: the host's <model-viewer> mounts
  // late (and remounts per model) after this, and a later positioned sibling
  // at z-index auto would paint over the outline.
  const svg = el("svg", { "aria-hidden": "true", focusable: "false", "data-hat-place": "" }, {
    position: "absolute", left: "0", top: "0", width: "100%", height: "100%", overflow: "visible", pointerEvents: "none",
    zIndex: String(opts.zIndex ?? OVERLAY_Z),
  });
  const areaGroup = el("g", { "data-part": "area" }, { display: "none" });
  const areaHalo = el("path", {}, halo);
  const areaLine = el("path", { "stroke-dasharray": "6 4" }, line);
  const guideGroup = el("g", { "data-part": "guides" }, { display: "none" });
  const guideX = el("path", {}, { ...line, strokeWidth: "1" });
  const guideY = el("path", {}, { ...line, strokeWidth: "1" });
  const pieceGroup = el("g", { "data-part": "piece" }, { display: "none" });
  const pieceHalo = el("path", {}, halo);
  const pieceLine = el("path", {}, line);
  const stalk = el("line", {}, { stroke: LINE, strokeWidth: "1.5" });
  const handle = (part) =>
    el("circle", { r: HANDLE_DRAWN_PX / 2, "data-part": part }, {
      fill: HANDLE_FILL, stroke: LINE, strokeWidth: "1.5", pointerEvents: "auto",
    });
  const knob = handle("knob");
  knob.style.cursor = "grab";
  const corners = [0, 1, 2, 3].map(() => handle("corner"));
  for (const n of [areaHalo, areaLine]) areaGroup.appendChild(n);
  for (const n of [guideX, guideY]) guideGroup.appendChild(n);
  for (const n of [pieceHalo, pieceLine, stalk, knob, ...corners]) pieceGroup.appendChild(n);
  for (const n of [areaGroup, guideGroup, pieceGroup]) svg.appendChild(n);

  const restore = {
    touchAction: host.style.touchAction,
    position: host.style.position,
    cursor: host.style.cursor,
    isolation: host.style.isolation,
    tabIndex: host.hasAttribute?.("tabindex") ? null : true,
  };
  host.style.touchAction = "none";
  // The overlay's z-index then orders it among the host's children only, never
  // over the page round the host (the knob may stand past the host's edge).
  host.style.isolation = "isolate";
  if (view.getComputedStyle?.(host)?.position === "static") host.style.position = "relative";
  if (restore.tabIndex) host.tabIndex = 0;
  host.appendChild(svg);

  function applyMotion() {
    areaGroup.style.transition = reducedMotion ? "" : FADE;
  }
  applyMotion();

  const show = (node, on) => {
    node.style.display = on ? "" : "none";
  };
  function render() {
    dirty = false;
    if (destroyed) return;
    const sel = selectedPiece();
    const manip = g && MANIP.has(g.kind) && g.live ? g : null;
    const pose = manip ? manip.live : sel;
    show(areaGroup, !!pose && !!area);
    show(pieceGroup, !!pose);
    show(guideGroup, !!manip && (manip.snapX || manip.snapY));
    if (!pose) return;
    // Every outline is broken where the zone turns away from the camera.
    if (area) {
      areaSampled ??= areaSamples(area, step);
      const d = areaSampled.map((ring) => pathOf(ring.map(([x, y]) => seen(x, y)))).join("");
      areaHalo.setAttribute("d", d);
      areaLine.setAttribute("d", d);
      areaGroup.style.opacity = manip ? "1" : String(AREA_IDLE_OPACITY);
      areaLine.style.stroke = manip?.pushed ? EDGE : LINE;
    }
    if (manip && area) {
      const along = (from, to) => {
        const n = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
        return Array.from({ length: n + 1 }, (_, i) => seen(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n));
      };
      show(guideX, !!manip.snapX);
      show(guideY, !!manip.snapY);
      const r = areaRect(area);
      if (r) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        if (manip.snapX) guideX.setAttribute("d", pathOf(along([cx, r.y], [cx, r.y + r.h]), false));
        if (manip.snapY) guideY.setAttribute("d", pathOf(along([r.x, cy], [r.x + r.w, cy]), false));
      } else if (manip.snapX) {
        // the seam, from the outline's bottom edge to its top
        const x = snapLines()?.x;
        const ys = x == null ? null : verticalSpan(areaRings(area)[0] ?? [], x);
        guideX.setAttribute("d", ys ? pathOf(along([x, ys[0]], [x, ys[1]]), false) : "");
      }
    }
    const d = pathOf(boxRing(pose.cx, pose.cy, pose.w, pose.h, pose.rotation, step).map(([x, y]) => seen(x, y)));
    pieceHalo.setAttribute("d", d);
    pieceLine.setAttribute("d", d);
    const hide = !!manip && (manip.kind === "move" || manip.kind === "pinch");
    const h = hide ? null : handlesOf(pose);
    corners.forEach((c, i) => {
      const at = h?.corners[i];
      show(c, !!at);
      if (!at) return;
      c.setAttribute("cx", at[0].toFixed(1));
      c.setAttribute("cy", at[1].toFixed(1));
      // The resize cursor along the corner's own diagonal on screen.
      const diag = h.centre ? (at[0] - h.centre[0]) * (at[1] - h.centre[1]) : 1;
      c.style.cursor = diag >= 0 ? "nwse-resize" : "nesw-resize";
    });
    show(knob, !!h?.knob);
    show(stalk, !!h?.knob);
    if (h?.knob) {
      knob.setAttribute("cx", h.knob[0].toFixed(1));
      knob.setAttribute("cy", h.knob[1].toFixed(1));
      stalk.setAttribute("x1", h.stalk[0].toFixed(1));
      stalk.setAttribute("y1", h.stalk[1].toFixed(1));
      stalk.setAttribute("x2", h.knob[0].toFixed(1));
      stalk.setAttribute("y2", h.knob[1].toFixed(1));
    }
  }

  // ---- Frames --------------------------------------------------------------------
  function schedule() {
    if (frame == null && !destroyed) frame = requestFrame(tick);
  }
  /** Re-project now unless a frame is about to: a camera move draws in the frame the hat does. */
  function renderSoon() {
    if (frame == null) render();
    else dirty = true;
  }
  function tick() {
    frame = null;
    if (destroyed) return;
    if (g && MANIP.has(g.kind)) {
      computeRaw(g);
      g.live = liveOf(g);
      g.pushed = g.live.pushed;
      cb.onLive?.(g.id, poseOut(g.live), { pushed: g.pushed, kind: g.kind });
      dirty = true;
    } else if (g?.kind === "orbit") {
      orbitStep(g);
    } else if (!g && hoverAt) {
      const hit = hitTest(hoverAt, "mouse");
      host.style.cursor = !hit ? (camera ? "grab" : restore.cursor) : hit.kind === "knob" ? "grab" : hit.kind === "body" ? "move" : corners[hit.corner]?.style.cursor || "move";
      hoverAt = null;
    }
    if (dirty) render();
  }

  // ---- Gestures ------------------------------------------------------------------
  function pointerAt(id) {
    const p = pointers.get(id);
    return p ? [p.x, p.y] : null;
  }
  function snapCentreOf(g, raw) {
    const lines = snapLines();
    if (!lines) return raw;
    const thr = CENTRE_SNAP_PX / g.pxPerDie;
    const snapX = lines.x != null && Math.abs(raw.cx - lines.x) <= thr;
    const snapY = lines.y != null && Math.abs(raw.cy - lines.y) <= thr;
    if ((snapX && !g.snapX) || (snapY && !g.snapY)) cb.onSnap?.();
    g.snapX = snapX;
    g.snapY = snapY;
    return { ...raw, cx: snapX ? lines.x : raw.cx, cy: snapY ? lines.y : raw.cy };
  }
  /** A rotation in `step`s from the level, with onSnap when it arrives at the level or a right angle from it. */
  function turnTo(g, rotation, step) {
    const t = turnFromLevel(rotation, level, step);
    if (t.at != null && t.at !== g.snapAt) cb.onSnap?.();
    g.snapAt = t.at;
    return t.rotation;
  }
  /** The angle of a pointer round the piece's centre, in the die (its local linear map at the centre). */
  function angleRound(g, p) {
    if (g.aff?.inv && g.aff.s) {
      const [a, b, c, d] = g.aff.inv;
      const dx = p[0] - g.aff.s[0];
      const dy = p[1] - g.aff.s[1];
      return Math.atan2(c * dx + d * dy, a * dx + b * dy);
    }
    return g.aff?.s ? Math.atan2(p[1] - g.aff.s[1], p[0] - g.aff.s[0]) : null;
  }

  /** The pose the fingers ask for this frame, before confinement: `g.raw`. */
  function computeRaw(g) {
    const p0 = g.pose0;
    const floorScale = Math.min(p0.w, p0.h) > 0 ? Math.min(1, g.floor / Math.min(p0.w, p0.h)) : 1;
    if (g.kind === "move") {
      const d = g.track(pointerAt(g.pointerId) ?? g.p0);
      if (!d || !g.d0) return (g.raw ??= { ...p0 });
      g.raw = snapCentreOf(g, { ...p0, cx: p0.cx + d[0] - g.d0[0], cy: p0.cy + d[1] - g.d0[1] });
    } else if (g.kind === "scale") {
      const d = g.track(pointerAt(g.pointerId) ?? g.p0);
      if (!d || !(g.r0 > 0)) return (g.raw ??= { ...p0 });
      const s = Math.max(Math.hypot(d[0] - p0.cx, d[1] - p0.cy) / g.r0, floorScale);
      g.raw = { ...p0, w: p0.w * s, h: p0.h * s };
    } else if (g.kind === "rotate") {
      const a = angleRound(g, pointerAt(g.pointerId) ?? g.p0);
      if (a == null || g.angle == null) return (g.raw ??= { ...p0 });
      g.turn += wrapPi(a - g.angle);
      g.angle = a;
      g.raw = { ...p0, rotation: turnTo(g, p0.rotation + g.turn / DEG, g.shift ? TURN_STEP_SHIFT : TURN_STEP) };
    } else if (g.kind === "pinch") {
      const a = pointerAt(g.a);
      const b = pointerAt(g.b);
      if (!a || !b) return (g.raw ??= { ...p0 });
      const s = Math.max(hypot(a, b) / g.dist0, floorScale);
      // Twist: per-frame deltas summed, so crossing +-180 degrees does not flip it.
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      g.turn += wrapPi(angle - g.angle);
      g.angle = angle;
      // The fingers turn the piece 1:1 once they have turned TWIST_START_DEG.
      if (!g.twisting && Math.abs(g.turn) >= TWIST_START_DEG * DEG) g.twisting = true;
      const rotation = g.twisting ? turnTo(g, p0.rotation + (g.orient * g.turn) / DEG, TURN_STEP) : p0.rotation;
      // Pan: the midpoint's screen travel, carried into the die by the local
      // map where the piece shows, and summed, so the piece follows the
      // fingers 1:1 on screen. Never the die point under the midpoint: two
      // fingers land anywhere, often off the zone or off the hat, where there
      // is no die point to hold.
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dx = mid[0] - g.mid[0];
      const dy = mid[1] - g.mid[1];
      g.mid = mid;
      if (dx || dy) {
        const at = g.live ?? p0;
        const inv = inverseAt(at.cx, at.cy, g.orient) ?? g.panInv;
        if (inv) {
          g.panInv = inv;
          g.pan[0] += inv[0] * dx + inv[1] * dy;
          g.pan[1] += inv[2] * dx + inv[3] * dy;
        }
      }
      g.raw = { cx: p0.cx + g.pan[0], cy: p0.cy + g.pan[1], w: p0.w * s, h: p0.h * s, rotation };
    }
    return g.raw;
  }

  /**
   * What a gesture shows this frame (`g.raw` banded past its limits) and what
   * it would commit (`fit`, the confined pose) and say (`said`, the fit a note
   * is for). A turn with a remembered size (`g.asked`, see `intent`) commits
   * that size confined at the new angle, so turning back restores it, and
   * shows that with only the strain the shown size itself is under: no jump
   * when the turn begins, and the outline turns to its edge colour only when
   * the turn shrinks the piece below what it showed. Each confines from
   * `g.from`, the last pose it would have committed, and becomes the next.
   */
  function liveOf(g) {
    const lim = limits(g.from);
    const band = bandPose(g.raw, lim, OVERSHOOT_PX / g.pxPerDie);
    if (!g.asked) {
      g.from = band.fit;
      return { ...band, said: band.fit };
    }
    const fit = confinePose({ ...g.raw, w: g.asked.w, h: g.asked.h }, lim);
    g.from = fit;
    const k = band.fit.w > 0 ? band.w / band.fit.w : 1;
    return {
      cx: fit.cx + band.cx - band.fit.cx,
      cy: fit.cy + band.cy - band.fit.cy,
      w: fit.w * k,
      h: fit.h * k,
      rotation: band.rotation,
      pushed: band.pushed,
      fit,
      said: band.fit,
    };
  }

  function orbitStep(g) {
    if (!camera || !g.orbit0) return;
    const p = pointerAt(g.pointerId);
    if (!p) return;
    camera.setOrbit(orbitFrom(g.orbit0, p[0] - g.p0[0], p[1] - g.p0[1], rect.height || host.clientHeight || 1, camera.window));
  }

  /** A press on a piece becomes a move, a scale or a turn once it travels. */
  function startManip(g) {
    const p0 = g.pose0;
    g.kind = g.target === "corner" ? "scale" : g.target === "knob" ? "rotate" : "move";
    g.pxPerDie = pxPerDieAt(p0);
    g.floor = floorFor(p0);
    g.from = p0;
    const lines = g.kind === "move" ? snapLines() : null;
    if (lines) {
      // A drag that begins ON a centre line is already snapped there: onSnap
      // is for a snap arriving, not for the first move of a centred logo.
      const thr = CENTRE_SNAP_PX / g.pxPerDie;
      g.snapX = lines.x != null && Math.abs(p0.cx - lines.x) <= thr;
      g.snapY = lines.y != null && Math.abs(p0.cy - lines.y) <= thr;
    }
    if (g.kind === "scale") g.r0 = g.d0 ? Math.hypot(g.d0[0] - p0.cx, g.d0[1] - p0.cy) : 0;
    if (g.kind === "rotate") {
      g.aff = { s: toScreen(p0.cx, p0.cy), inv: inverseAt(p0.cx, p0.cy) };
      g.angle = angleRound(g, g.p0);
      g.turn = 0;
      // A piece an earlier turn shrank is turned at the size asked for then.
      const asked = askedSize({ id: g.id, ...p0 });
      g.asked = asked.w !== p0.w || asked.h !== p0.h ? asked : null;
      // Likewise a piece at its level is already there: the tick is for a turn arriving.
      g.snapAt = turnFromLevel(p0.rotation, level).at;
    }
    host.style.cursor = g.kind === "rotate" ? "grabbing" : g.kind === "move" ? "move" : host.style.cursor;
  }

  function noteFor(fit) {
    if (!cb.onNote || !(fit.moved || fit.shrunk)) return;
    const spot = labels.spot ?? zone;
    if (fit.capped && cap) {
      const size = labels.size ? labels.size(cap) : `${inches(cap.w, ppi)} × ${inches(cap.h, ppi)} in`;
      cb.onNote(`That's the largest the ${spot} takes: ${size}.`);
    } else {
      cb.onNote(`The ${spot}'s logo area ends here.`);
    }
  }

  /** Release: the fully confined pose, committed once (a two-finger tap that changed nothing commits nothing). */
  function finishManip(g, note) {
    computeRaw(g);
    if (g.kind === "pinch" && !g.changed) return;
    const { fit, said } = liveOf(g);
    const pose = poseOut(fit);
    setLocalPose(g.id, pose);
    remember(g.id, g.kind, g.asked ?? g.pose0, pose);
    cb.onCommit?.(g.id, pose);
    if (note) noteFor(said);
  }

  /** End the gesture without a commit (Escape, cancel()). True when there was one to end. */
  function abort() {
    if (!g || g.kind === "spent") return false;
    if (MANIP.has(g.kind)) cb.onCancel?.(g.id);
    else if (g.kind === "orbit" && camera && g.orbit0) camera.setOrbit(g.orbit0);
    g = pointers.size ? { kind: "spent", owned: g.owned } : null;
    host.style.cursor = restore.cursor;
    dirty = true;
    renderSoon();
    return true;
  }

  const consume = (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
  };
  const local = (e) => [e.clientX - rect.left, e.clientY - rect.top];
  const readRect = () => {
    const r = host.getBoundingClientRect?.();
    if (r) rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const capture = (id) => {
    try {
      host.setPointerCapture?.(id);
    } catch {
      // A pointer already gone (released before this ran) cannot be captured; nothing to hold.
    }
  };
  const uncapture = (id) => {
    try {
      if (host.hasPointerCapture?.(id)) host.releasePointerCapture(id);
    } catch {
      // Likewise: nothing to release.
    }
  };

  function onPointerDown(e) {
    if (destroyed) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A primary press means no other pointer is down: any still held here lost
    // its pointerup somewhere (a browser that swallowed it), and would turn this
    // press into a second finger forever.
    if (e.isPrimary && pointers.size) {
      if (g && MANIP.has(g.kind)) finishManip(g, false);
      pointers.clear();
      g = null;
    }
    readRect();
    const p = local(e);
    pointers.set(e.pointerId, { x: p[0], y: p[1] });
    if (pointers.size === 1) beginOne(e, p);
    else if (pointers.size === 2) beginTwo(e);
    else if (g?.owned) consume(e);
  }

  function beginOne(e, p) {
    const kind = kindOf(e);
    const hit = hitTest(p, kind);
    if (hit) {
      consume(e);
      capture(e.pointerId);
      // preventDefault on the press also stops the focus a click gives, and the keys need it.
      if (doc.activeElement !== host) host.focus?.({ preventScroll: true });
      if (hit.id !== selectedId) {
        selectedId = hit.id;
        cb.onSelect?.(hit.id);
      }
      const pose0 = poseOf(pieceById(hit.id));
      const track = tracker(pose0);
      g = { kind: "press", owned: true, target: hit.kind, id: hit.id, pointerId: e.pointerId, ptype: kind, p0: p, travel: 0, pose0, track, d0: track(p), shift: !!e.shiftKey };
    } else {
      // Bare fabric turns the hat when there is a camera to turn, and is left
      // to whatever is under it when there is not; a tap deselects either way.
      const owned = !!camera;
      if (owned) {
        consume(e);
        capture(e.pointerId);
        if (doc.activeElement !== host) host.focus?.({ preventScroll: true });
      }
      g = { kind: "fabric", owned, pointerId: e.pointerId, ptype: kind, p0: p, travel: 0, orbit0: owned ? camera.getOrbit() : null };
    }
    dirty = true;
    renderSoon();
  }

  /**
   * A second finger: pinch, twist and pan the selected piece, wherever it
   * landed, as one gesture. Not when the first finger was left to what is
   * under the host (bare fabric with no camera): whatever saw it go down must
   * see both fingers through to their pointerups, or it keeps a phantom
   * pointer that breaks its next gesture.
   */
  function beginTwo(e) {
    const sel = selectedPiece();
    if (!g || g.kind === "spent" || !g.owned || !sel) {
      if (g?.owned) consume(e);
      if (g) g = { kind: "spent", owned: g.owned };
      return;
    }
    consume(e);
    capture(e.pointerId);
    const [a, b] = [...pointers.keys()];
    const pa = pointerAt(a);
    const pb = pointerAt(b);
    // A drag the pinch interrupts carries on inside it, so the two are one commit.
    const carried = g.id === sel.id && MANIP.has(g.kind);
    if (carried) computeRaw(g);
    const pose0 = carried && g.raw ? { ...g.raw } : poseOf(sel);
    const orient = orientAt(pose0);
    g = {
      kind: "pinch", owned: true, id: sel.id, a, b, ptype: "touch", pose0,
      dist0: hypot(pa, pb) || 1,
      angle: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]),
      turn: 0,
      mid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2],
      pan: [0, 0],
      panInv: inverseAt(pose0.cx, pose0.cy),
      orient,
      pxPerDie: pxPerDieAt(pose0),
      floor: carried ? g.floor : floorFor(pose0),
      // the drag's last valid pose carries on; a fresh pinch starts from the piece
      from: carried ? g.from ?? null : poseOf(sel),
      // A piece at its level is already there: onSnap is for a twist ARRIVING at a right angle.
      snapAt: turnFromLevel(pose0.rotation, level).at,
      twisting: false,
      changed: carried,
    };
    dirty = true;
    schedule();
  }

  function onPointerMove(e) {
    const ptr = pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === "mouse" && !g && !destroyed) {
        readRect();
        hoverAt = local(e);
        schedule();
      }
      return;
    }
    const p = local(e);
    ptr.x = p[0];
    ptr.y = p[1];
    if (!g) return;
    if (g.owned) consume(e);
    if (g.kind === "spent") return;
    if (g.kind === "pinch") {
      if (e.pointerId === g.a || e.pointerId === g.b) {
        g.changed = true;
        schedule();
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    g.shift = !!e.shiftKey;
    g.travel = Math.max(g.travel, hypot(p, g.p0));
    if (g.kind === "press" && g.travel > SLOP[g.ptype]) startManip(g);
    else if (g.kind === "fabric" && g.owned && g.travel > SLOP[g.ptype]) g.kind = "orbit";
    if (MANIP.has(g.kind) || g.kind === "orbit") schedule();
  }

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    const cancelled = e.type === "pointercancel";
    // A cancel's coordinates are not where the finger was; keep the last move's.
    if (!cancelled) {
      const p = local(e);
      pointers.set(e.pointerId, { x: p[0], y: p[1] });
    }
    uncapture(e.pointerId);
    if (g) {
      if (g.owned) consume(e);
      const mine = g.kind === "pinch" ? e.pointerId === g.a || e.pointerId === g.b : e.pointerId === g.pointerId;
      if (mine && g.kind !== "spent") {
        if (MANIP.has(g.kind)) {
          finishManip(g, !cancelled);
        } else if (g.kind === "orbit" && !cancelled) {
          orbitStep(g);
        }
        if ((g.kind === "fabric" || g.kind === "orbit") && !cancelled && g.travel < TAP_PX && selectedId != null) {
          selectedId = null;
          cb.onSelect?.(null);
        }
        g = { kind: "spent", owned: g.owned };
        host.style.cursor = restore.cursor;
        dirty = true;
      }
    }
    pointers.delete(e.pointerId);
    if (!pointers.size) g = null;
    renderSoon();
  }

  // ---- Keys ----------------------------------------------------------------------
  /**
   * A key's change to the selected piece: confined, committed as its own
   * step, and noted at a limit. A turn passes `asked`, the size to confine
   * from (see `intent`); the note is still for the size it showed.
   */
  function keyPose(sel, raw, kind, asked = null) {
    // from where the piece is: on a polygon a step goes along a gently sloping edge, and stops when pushed into one
    const lim = limits(poseOf(sel), "step");
    const said = confinePose(raw, lim);
    const fit = asked ? confinePose({ ...raw, w: asked.w, h: asked.h }, lim) : said;
    const pose = poseOut(fit);
    const same = ["cx", "cy", "w", "h"].every((k) => Math.abs(pose[k] - sel[k]) < KEY_SAME_PX) && pose.rotation === wrap180(sel.rotation || 0);
    // A nudge into the edge it already sits against changes nothing: no step, but say why.
    if (!same) {
      setLocalPose(sel.id, pose);
      remember(sel.id, kind, asked ?? raw, pose);
      cb.onCommit?.(sel.id, pose);
    }
    noteFor(said);
    renderSoon();
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  function onKeyDown(e) {
    if (destroyed || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== host && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))) return;
    if (e.key === "Escape") {
      if (abort()) return consume(e);
      if (selectedId != null) {
        selectedId = null;
        cb.onSelect?.(null);
        renderSoon();
        consume(e);
      }
      return;
    }
    // Keys wait while a finger or the mouse holds a piece.
    if (g && g.kind !== "spent") return;
    const sel = selectedPiece();
    const arrow = ARROWS[e.key];
    if (arrow && !sel) {
      if (!camera) return;
      consume(e);
      const o = camera.getOrbit();
      const by = e.shiftKey ? KEY_ORBIT_BIG : KEY_ORBIT;
      // As a drag the same way would: left turns theta up, up turns phi up.
      const within = (v, r) => (r ? Math.min(r[1], Math.max(r[0], v)) : v);
      camera.setOrbit({ theta: within(o.theta - arrow[0] * by, camera.window?.theta), phi: within(o.phi - arrow[1] * by, camera.window?.phi) });
      return;
    }
    if (!sel) return;
    const pose = poseOf(sel);
    if (arrow) {
      consume(e);
      // The arrow's direction ON SCREEN, carried into the die, so Right moves
      // the logo right as the customer sees it from wherever the camera is.
      const dist = NUDGE_IN * ppi * (e.shiftKey ? 10 : 1);
      const inv = inverseAt(pose.cx, pose.cy);
      let v = inv ? [inv[0] * arrow[0] + inv[1] * arrow[1], inv[2] * arrow[0] + inv[3] * arrow[1]] : arrow;
      const len = Math.hypot(v[0], v[1]);
      v = len > 0 ? [v[0] / len, v[1] / len] : arrow;
      return keyPose(sel, { ...pose, cx: pose.cx + v[0] * dist, cy: pose.cy + v[1] * dist }, "move");
    }
    if (e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}") {
      consume(e);
      const by = (e.shiftKey ? KEY_TURN_BIG : KEY_TURN) * (e.key === "]" || e.key === "}" ? 1 : -1) * orientAt(pose);
      // Each step confines from the size asked for, not the last step's shrunk
      // one: six turns there and six back end where they began.
      return keyPose(sel, { ...pose, rotation: pose.rotation + by }, "rotate", askedSize(sel));
    }
    if (e.key === "-" || e.key === "_" || e.key === "=" || e.key === "+") {
      consume(e);
      const grow = e.key === "=" || e.key === "+";
      const short = Math.min(pose.w, pose.h);
      let s = grow ? KEY_SCALE : 1 / KEY_SCALE;
      if (!grow && short > 0) s = Math.max(s, Math.min(1, floorFor(pose) / short));
      return keyPose(sel, { ...pose, w: pose.w * s, h: pose.h * s }, "scale");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      consume(e);
      cb.onDelete?.(sel.id);
    }
  }

  // ---- Wiring ----------------------------------------------------------------------
  // Capture phase, so the placer decides before model-viewer (inside the host)
  // sees a press: a press it takes never reaches model-viewer's own orbit.
  const CAPTURE = { capture: true };
  host.addEventListener("pointerdown", onPointerDown, CAPTURE);
  host.addEventListener("pointermove", onPointerMove, CAPTURE);
  host.addEventListener("pointerup", onPointerEnd, CAPTURE);
  host.addEventListener("pointercancel", onPointerEnd, CAPTURE);
  host.addEventListener("keydown", onKeyDown);

  function subscribeCamera() {
    unsubscribeCamera?.();
    const off = camera?.onMove?.(() => renderSoon());
    unsubscribeCamera = typeof off === "function" ? off : null;
  }
  subscribeCamera();
  renderSoon();

  return {
    /**
     * New pieces, selection, spot or camera from the host, or `cameraMoved`
     * to re-project the outline after the hat turned. A change of spot ends a
     * gesture as Escape does; a gesture whose piece is gone ends silently.
     */
    update(next = {}) {
      if (destroyed) return;
      if ("zone" in next && next.zone !== zone) {
        abort();
        zone = next.zone;
        areaSampled = null;
      }
      if (next.area) {
        area = { ...next.area };
        areaSampled = null;
      }
      if ("snapX" in next) snapXOpt = next.snapX;
      if ("level" in next) level = Number.isFinite(next.level) ? next.level : 0;
      if (next.cap) cap = { ...next.cap };
      if (Array.isArray(next.pieces)) pieces = next.pieces.map((p) => ({ ...p }));
      if ("selectedId" in next) selectedId = next.selectedId ?? null;
      if (next.labels) labels = next.labels;
      if ("reducedMotion" in next) {
        reducedMotion = !!next.reducedMotion;
        applyMotion();
      }
      if ("camera" in next && next.camera !== camera) {
        camera = next.camera ?? null;
        subscribeCamera();
      }
      for (const name of CALLBACKS) if (typeof next[name] === "function") cb[name] = next[name];
      if (g?.id != null && g.kind !== "spent" && !pieceById(g.id)) g = pointers.size ? { kind: "spent", owned: g.owned } : null;
      dirty = true;
      renderSoon();
    },
    /** End the gesture in progress as Escape does (no commit). True when there was one. */
    cancel: () => abort(),
    /** Take everything off the host. A gesture held at that moment commits what it did, rather than strand the piece. */
    destroy() {
      if (destroyed) return;
      if (g && MANIP.has(g.kind)) finishManip(g, false);
      g = null;
      for (const id of pointers.keys()) uncapture(id);
      pointers.clear();
      if (frame != null) cancelFrame(frame);
      frame = null;
      destroyed = true;
      host.removeEventListener("pointerdown", onPointerDown, CAPTURE);
      host.removeEventListener("pointermove", onPointerMove, CAPTURE);
      host.removeEventListener("pointerup", onPointerEnd, CAPTURE);
      host.removeEventListener("pointercancel", onPointerEnd, CAPTURE);
      host.removeEventListener("keydown", onKeyDown);
      unsubscribeCamera?.();
      if (typeof svg.remove === "function") svg.remove();
      else svg.parentNode?.removeChild(svg);
      host.style.touchAction = restore.touchAction;
      host.style.position = restore.position;
      host.style.cursor = restore.cursor;
      host.style.isolation = restore.isolation;
      if (restore.tabIndex) host.removeAttribute?.("tabindex");
    },
  };
}
