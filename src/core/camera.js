// The camera: which part of a die the stage is looking at, and from where.
//
// Added in v1.5.0 for the storefront's phone designer. The canvas sits in a
// fixed-height box on the top half of a phone, and a whole koozie die drawn in
// that box leaves a logo a few millimetres wide: too small to drag with a
// finger. So on the "logo" and "text" steps the stage zooms into ONE face of
// the flat die (front panel, base disc, or back panel), and on every other step
// it shows the whole die fitted to the box.
//
// WHY THIS IS IN core/: it is pure arithmetic over the die geometry, and the
// stage applies its answer to three Konva layers that must agree exactly. A
// camera that drifts by a pixel between the artwork and the die-line overlay
// shows the customer a cut line that is not where the factory will cut. Pure
// numbers can be pinned by a golden file with no canvas, so they live here and
// `tests/camera.golden.json` pins them.
//
// WHAT IT NEVER TOUCHES: the design document. A camera is a way of LOOKING at
// the stage frame; element positions stay fractions of that frame, and the
// exported proof is always the whole die at native resolution (the stage
// resets the camera for the export). Nothing here can relocate artwork.
//
// Coordinate spaces, because three are in play:
//   native   the die's pinned stage frame (`die.stage`), e.g. 1000 x 2000.
//            `dieGeometry()` returns everything in these units.
//   display  where the stage's nodes live: the die drawn at
//            displayW x displayH, displayH = displayW * native.height/native.width.
//            native -> display is `* displayW / native.width`, the stage's `scale`.
//   viewport the Konva Stage itself, i.e. the container box in CSS px.
// A camera maps display -> viewport, as Konva layer attrs.

/** The camera a layer has when nothing is applied: what v1.4.1 always used. */
export const IDENTITY_CAMERA = Object.freeze({
  x: 0,
  y: 0,
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

/**
 * The faces of a die a camera can focus on, in NATIVE stage px.
 *
 * Every zone contributes its own bounds under its own id — for a koozie that is
 * `front` and `back` — and a die with a base disc adds `base`, the disc's
 * bounding box. A koozie therefore gets exactly `{ front, back, base }`.
 *
 * Derived from the zones rather than hardcoded for the same reason the snap
 * targets are: a hat has one zone and no disc, and should get one focus rect
 * without anyone writing a second camera.
 *
 * The base rect is the WHOLE disc, including the parts hidden behind the
 * panels where it meets them. Framing the visible lens alone would crop the
 * circle the customer recognises as "the bottom".
 */
export function focusRects(geom) {
  const rects = {};
  for (const z of geom.zones ?? []) {
    const b = z.bounds;
    rects[z.id] = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }
  if ([geom.cx, geom.cy, geom.r].every(Number.isFinite)) {
    rects.base = {
      x0: geom.cx - geom.r,
      y0: geom.cy - geom.r,
      x1: geom.cx + geom.r,
      y1: geom.cy + geom.r,
    };
  }
  return rects;
}

/**
 * The display width a die gets when it is fitted INSIDE a viewport (CSS
 * "contain"): as wide as the box allows, unless the box is too short for the
 * die's aspect, in which case the height decides.
 *
 * Written once, here, because the stage sizes the die with it and the golden
 * tests feed the same number into `cameraFor` — two copies of this expression
 * would be two places for the die and its camera to disagree.
 */
export function containDisplayWidth(viewport, native) {
  return Math.min(viewport.width, (viewport.height * native.width) / native.height);
}

/**
 * Konva layer attrs that point the stage at `rect`, or at the whole die.
 *
 * Returns `{ x, y, offsetX, offsetY, scaleX, scaleY, rotation }`. Konva applies
 * them as translate(x, y) · rotate · scale · translate(-offset), so `offset` is
 * the display-space point that lands on viewport (x, y). That is why the answer
 * is expressed as offsets rather than one baked translation: offset, scale and
 * rotation interpolate independently, so a tween between two cameras slides
 * the look-at point while it zooms instead of swinging the die around the
 * viewport's corner.
 *
 *   rect null  OVERVIEW. The die's centre on the viewport's centre, scaled to
 *              fit. When displayW came from `containDisplayWidth` the scale is
 *              1 (up to float dust), so overview is exactly the layout the
 *              stage already drew.
 *   rect       FOCUS. `rect` is in NATIVE px (from `focusRects`). Its centre on
 *              the viewport's centre, as large as fits inside `margin` of the
 *              viewport on each side, turned by `rotate`.
 *
 * `rotate` is 0 or 180 in practice: the koozie's back panel folds under and
 * prints upside down unless the artwork on it is rotated ~180 (the zone's
 * `flipped` flag), so the stage can show the back view turned over, reading
 * the way it will on the can. Overview ignores it — the whole die is only ever
 * shown the way it is cut.
 *
 * @param {object} p
 * @param {{x0,y0,x1,y1}|null} p.rect  native px, or null for overview
 * @param {{width,height}} p.native    the die's stage frame
 * @param {number} p.displayW          width the die is drawn at, display px
 * @param {{width,height}} p.viewport  the stage (container) size, CSS px
 * @param {number} [p.rotate=0]        degrees, focus only
 * @param {number} [p.margin=0.06]     fraction of the viewport kept clear per side
 * @param {{top?,right?,bottom?,left?}} [p.inset] CSS px of the viewport the host
 *        covers with its own controls (an undo row, a side switcher). The
 *        camera frames inside what is left and centres there, so the stage can
 *        keep its full size (a resize re-fits instantly; a view change glides)
 *        while the artwork stays clear of the overlays. Omitted = no inset,
 *        exactly the v1.5.0 answer.
 */
export function cameraFor({ rect, native, displayW, viewport, rotate = 0, margin = 0.06, inset }) {
  // Nothing measured yet: a camera computed from zero would be NaN/Infinity,
  // and Konva would happily draw nothing with it.
  if (!(displayW > 0) || !(viewport?.width > 0) || !(viewport?.height > 0)) {
    return { ...IDENTITY_CAMERA };
  }
  // The same expression the stage uses for its own displayH, so the camera
  // centres the die the stage actually drew rather than one a float away.
  const displayH = displayW * (native.height / native.width);
  const top = Math.max(0, inset?.top ?? 0);
  const right = Math.max(0, inset?.right ?? 0);
  const bottom = Math.max(0, inset?.bottom ?? 0);
  const left = Math.max(0, inset?.left ?? 0);
  // The safe box. Never collapsed to nothing: an inset larger than the stage
  // (a tiny window) falls back to the whole viewport rather than a zero scale.
  const safeW = viewport.width - left - right > 1 ? viewport.width - left - right : viewport.width;
  const safeH = viewport.height - top - bottom > 1 ? viewport.height - top - bottom : viewport.height;
  const x = (safeW === viewport.width ? 0 : left) + safeW / 2;
  const y = (safeH === viewport.height ? 0 : top) + safeH / 2;

  if (!rect) {
    const s = Math.min(safeW / displayW, safeH / displayH);
    return {
      x,
      y,
      offsetX: displayW / 2,
      offsetY: displayH / 2,
      scaleX: s,
      scaleY: s,
      rotation: 0,
    };
  }

  // Native -> display, the stage's own `scale`.
  const toDisplay = displayW / native.width;
  const x0 = rect.x0 * toDisplay;
  const y0 = rect.y0 * toDisplay;
  const x1 = rect.x1 * toDisplay;
  const y1 = rect.y1 * toDisplay;
  const k = Math.min(
    (safeW * (1 - 2 * margin)) / (x1 - x0),
    (safeH * (1 - 2 * margin)) / (y1 - y0),
  );
  return {
    x,
    y,
    offsetX: (x0 + x1) / 2,
    offsetY: (y0 + y1) / 2,
    scaleX: k,
    scaleY: k,
    rotation: rotate,
  };
}

/**
 * Where a display-space point lands in the viewport under `camera` — Konva's
 * own transform order, written out so it can be tested without a canvas and
 * reused by anything the stage overlays in HTML (the inline text editor).
 */
export function cameraPoint(camera, point) {
  const dx = (point.x - camera.offsetX) * camera.scaleX;
  const dy = (point.y - camera.offsetY) * camera.scaleY;
  const a = (camera.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: camera.x + dx * cos - dy * sin,
    y: camera.y + dx * sin + dy * cos,
  };
}

/**
 * The camera that shows a die re-laid out at `toDisplayW` exactly where
 * `camera` showed it at `fromDisplayW` (v1.6.0, for the stage's
 * `animateResize`). Every node's display position scales with the display
 * width, so the same viewport point, turn and look-at fraction need scale
 * times old/new and offsets times new/old. The stage starts its glide here,
 * so a resize never jumps before it eases.
 */
export function cameraForResize(camera, fromDisplayW, toDisplayW) {
  if (!(fromDisplayW > 0) || !(toDisplayW > 0) || fromDisplayW === toDisplayW) return { ...camera };
  const r = fromDisplayW / toDisplayW;
  return {
    ...camera,
    scaleX: camera.scaleX * r,
    scaleY: camera.scaleY * r,
    offsetX: camera.offsetX / r,
    offsetY: camera.offsetY / r,
  };
}

/**
 * The Konva export config that takes the die, and only the die, at native
 * resolution from a stage laid out at `displayW` x `displayH` display px
 * (v1.8.0, for the stage's `exportArtCanvas`). Under IDENTITY_CAMERA the die
 * is drawn from the stage origin, so the rect is the die's own display box.
 *
 * It is always passed explicitly: a Konva Layer's export otherwise defaults
 * to the whole Konva stage, which in contain mode is the host's box, not the
 * die.
 *
 * `null` when there is nothing measured to export: a size that is missing,
 * zero, negative or not finite. A zero width would make Konva fall back to the
 * stage size, and the ratio would be Infinity.
 *
 * Not rounded. `width * pixelRatio` is `nativeW` only up to float dust
 * (19 * (1000 / 19) is 999.9999999999999) and a canvas truncates its size, so
 * the exported canvas can be a pixel short of native. A caller that needs the
 * exact die size draws the canvas at that size rather than trusting its own.
 *
 * @param {object} p
 * @param {number} p.displayW  width the die is drawn at, display px
 * @param {number} p.displayH  its height, display px
 * @param {number} p.nativeW   the die's stage frame width (`die.stage.width`)
 * @returns {{x: 0, y: 0, width: number, height: number, pixelRatio: number}|null}
 */
export function artExportRect({ displayW, displayH, nativeW } = {}) {
  if (![displayW, displayH, nativeW].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { x: 0, y: 0, width: displayW, height: displayH, pixelRatio: nativeW / displayW };
}
