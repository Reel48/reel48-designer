// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/components/storefront/hat/hat-edit-host.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
/**
 * The designer's side of editing a spot on the 3D hat (round E1, 2026-10-21):
 * what HatStepForm hands Hat3D as its `edit` prop, worked out from the design
 * document and the hidden stage, as plain functions, so
 * tests/hat-edit-host.test.ts checks every number without a DOM.
 *
 * Two units meet here. Hat3D, the placer (hat-place.js) and the confine rule
 * (hat-confine.js) work in die px (the die's native stage px) and degrees.
 * The design document stores fractions of the stage: `x` of its width, `y` of
 * its height, a logo's `scale` and a line of text's `fontScale` of its width.
 *
 * - spotLimits: a spot's AREA (its die zone's own `area` object, so the placer
 *   reads a polygon once), its CAP in die px, its snap line, its LEVEL (the
 *   turn that reads 0°) and its name.
 * - pieceOf / piecesOf: the pieces of one spot as the placer takes them. A
 *   logo's box is the document's (elementPose: what the stage draws); a line
 *   of text has a size only once the stage has measured it with its font
 *   (DesignStage measureElement), kept here with the fontScale and the words
 *   it was measured at, and scaled with the fontScale since.
 * - commitPatch: a pose the placer let go at, as the one UPDATE_ELEMENT patch
 *   that puts the piece there, only the fields that moved.
 * - pieceArtRect / renderPieceArt / createPieceArtCache: a piece's art alone
 *   at die scale on its unturned box, from the stage's exportArtCanvas.
 * - restArtFor: the spot's art without one piece, on the zone's rect.
 * - stepView: whether a step shows the hat (and edits on it) or the flat spot.
 * - adjustAction: the phone's Adjust row (HatAdjustControls), one confined
 *   UPDATE_ELEMENT a press, with the note the placer would give; askedSize
 *   the size a turn shrank a piece from, so turning back gives it back.
 * - layerResize, layerRotate: the desktop's LayerControls on a hat die (its
 *   `resize` and `rotate`), a tenth a press and turns that keep their size.
 * - drawnTextBox, stageTextMeasure: a line of text's box from the stage, for
 *   the pieces and for the reducer's `measureText`.
 */
import { SPOT_NAMES, spotLevel } from "../core/hat-config.js";
import { elementPose, zoneArea, zoneCap, zoneOfElement } from "../core/hat-placements.js";
import { areaHome, confinePose } from "../core/region.js";

const RAD = Math.PI / 180;
/** Closer than this (die px, degrees) is the same: float noise, not a change. */
const SAME = 1e-6;
/** One press of a nudge, inches (the placer's keys and the lab's buttons). */
export const NUDGE_IN = 0.05;
/** One press of Turn left or Turn right, degrees (Brayden, 2026-10-22: "move it one degree at a time"). */
export const TURN_DEG = 1;
/** One press of Smaller or Larger: the lab's 10%. */
export const SIZE_STEP = 1.1;
/** The smallest a press makes a piece's shorter side, inches (the placer's floor). */
export const MIN_SIDE_IN = 0.25;

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isPolygon = (a) => isObject(a) && Array.isArray(a.outline);

// ---- Which view a step shows ------------------------------------------------------------

/**
 * What HatStepForm shows on a step: the 3D hat, or the flat spot, and whether
 * the hat is the editor. On a placing step (`faceStep`) the hat edits once it
 * has shown the design (`hatShown`, Hat3D's "ready", latched by the form),
 * unless the 3D can't run (`failed`) or can't edit here (`editFailed`); until
 * then the flat spot takes the artwork while the hat loads and paints out of
 * sight (`loadingHat`, so it can say "ready"). Every other step shows the hat.
 * From lg (`rail`) a look at the hat (`peek`) shows it over the flat spot.
 * `active` is Hat3D's: painting, on screen or about to be.
 *
 * @param {{ faceStep: boolean, failed: boolean, editFailed: boolean, hatShown: boolean, rail?: boolean, peek?: boolean }} o
 */
export function stepView({ faceStep, failed, editFailed, hatShown, rail = false, peek = false }) {
  const hatCanEdit = faceStep && !failed && !editFailed;
  const editOnHat = hatCanEdit && hatShown;
  const loadingHat = hatCanEdit && !hatShown;
  const show3D = !failed && (!faceStep || editOnHat);
  const on3D = show3D || (rail && faceStep && peek && !failed);
  return { editOnHat, loadingHat, show3D, on3D, placing: faceStep && !on3D, active: on3D || loadingHat };
}

// ---- A spot's limits ----------------------------------------------------------------

const limitsByDie = new WeakMap();

/**
 * A spot of `die` as the placer takes it, the same object each time for the
 * same die and zone: `area` the zone's own (hat-placements zoneArea), `cap`
 * its max imprint in die px, `snapX` the die x a dragged centre sticks to on
 * a polygon area (its home: on the front, the centre seam; the package's snap
 * line), `level` the turn at which art runs parallel to the bottom of the hat
 * (hat-config SPOT_LEVELS: what the designer calls 0°), `labels.spot` its
 * name in a sentence. Null for a zone not on `die`.
 *
 * @param {any} die a hat-config die
 * @param {string} zoneId
 */
export function spotLimits(die, zoneId) {
  if (!die) return null;
  let byZone = limitsByDie.get(die);
  if (!byZone) limitsByDie.set(die, (byZone = new Map()));
  if (byZone.has(zoneId)) return byZone.get(zoneId);
  const zone = die.zones.find((z) => z.id === zoneId) ?? null;
  let limits = null;
  if (zone) {
    const area = zoneArea(zone);
    const home = areaHome(area);
    limits = Object.freeze({
      zone: zone.id,
      area,
      cap: Object.freeze(zoneCap(zone, die)),
      maxImprint: zone.maxImprint,
      pxPerInch: die.pxPerInch,
      ...(isPolygon(area) && home ? { snapX: home[0] } : {}),
      level: spotLevel(die.id, zone.id),
      labels: Object.freeze({ spot: SPOT_NAMES[zone.id] ?? zone.id }),
    });
  }
  byZone.set(zoneId, limits);
  return limits;
}

// ---- Pieces --------------------------------------------------------------------------

/**
 * A line of text's box as the stage has drawn it (textBox of measureElement),
 * read against the design the stage last drew (`drawn`: CoozieStage's
 * shownRef), whose fontScale the measurement is at. Null before the stage
 * has drawn the line, or with no stage.
 *
 * @param {{ measureElement?: (id: string) => { w: number, h: number } | null } | null | undefined} stage
 * @param {{ elements?: any[] } | null | undefined} drawn
 * @param {string} id
 */
export function drawnTextBox(stage, drawn, id) {
  if (!stage?.measureElement) return null;
  const el = drawn?.elements?.find((e) => e?.id === id);
  return el ? textBox(el, stage.measureElement(id)) : null;
}

/**
 * hat-history's `measureText` on the stage: a line of text's unturned box in
 * die px at its OWN fontScale, the stage's drawing of it scaled by how its
 * fontScale has moved since, when its words and font are the ones drawn;
 * else null (the reducer then holds it by its centre). `getStage` and
 * `getDrawn` are read at each call (refs), so the reducer stays one function.
 *
 * @param {() => any} getStage
 * @param {() => any} getDrawn
 */
export function stageTextMeasure(getStage, getDrawn) {
  return (el) => {
    if (!isObject(el) || el.type !== "text" || !finite(el.fontScale) || !(el.fontScale > 0)) return null;
    const box = drawnTextBox(getStage(), getDrawn(), el.id);
    if (!box || box.sig !== textSignature(el)) return null;
    const k = el.fontScale / box.fontScale;
    return { w: box.w * k, h: box.h * k };
  };
}

/** What a line of text's measured size depends on besides its fontScale. */
export function textSignature(el) {
  return JSON.stringify([el.text, el.fontFamily, el.fontStyle, el.fontWeight, el.align, el.letterSpacing, el.lineHeight]);
}

/**
 * A text element's size as the stage measured it (measureElement's `w`, `h`,
 * die px, unturned), kept with what it was measured at.
 *
 * @param {any} el
 * @param {{ w: number, h: number } | null | undefined} measured
 * @returns {{ w: number, h: number, fontScale: number, sig: string } | null}
 */
export function textBox(el, measured) {
  if (!isObject(el) || el.type !== "text" || !measured) return null;
  if (!(measured.w > 0 && measured.h > 0) || !finite(el.fontScale) || !(el.fontScale > 0)) return null;
  return { w: measured.w, h: measured.h, fontScale: el.fontScale, sig: textSignature(el) };
}

/** The name a piece goes by: a logo's file name, a line of text in quotes. */
export function pieceLabel(el) {
  return el.type === "logo" ? el.fileName || "Logo" : `“${el.text ?? ""}”`;
}

/**
 * One element as a placer piece on `die` ({ id, cx, cy, w, h, rotation,
 * label }, die px), or null without a finite centre. A logo's size is its
 * document box; text's is `box` (textBox) scaled by its fontScale since,
 * when the box was measured with these words and this font, else 0 (held by
 * its centre until the stage measures it).
 *
 * @param {any} el
 * @param {any} die
 * @param {{ w: number, h: number, fontScale: number, sig: string } | null} [box]
 */
export function pieceOf(el, die, box = null) {
  const pose = elementPose(el, die);
  if (!pose) return null;
  let { w, h } = pose;
  if (el.type === "text") {
    const fits = box && box.sig === textSignature(el) && finite(el.fontScale) && box.fontScale > 0;
    const k = fits ? el.fontScale / box.fontScale : 0;
    w = fits ? box.w * k : 0;
    h = fits ? box.h * k : 0;
  }
  return { id: el.id, cx: pose.cx, cy: pose.cy, w, h, rotation: pose.rotation, label: pieceLabel(el) };
}

/**
 * The pieces on `zoneId`, in the document's order (topmost last, as the
 * placer takes them).
 *
 * @param {any[]} elements
 * @param {string} zoneId
 * @param {any} die
 * @param {{ zoneOf: (el: any) => string | null, boxes?: Record<string, any> }} o
 */
export function piecesOf(elements, zoneId, die, { zoneOf, boxes = {} }) {
  const out = [];
  for (const el of elements ?? []) {
    if (el?.type !== "logo" && el?.type !== "text") continue;
    if (zoneOf(el) !== zoneId) continue;
    const piece = pieceOf(el, die, boxes[el.id] ?? null);
    if (piece) out.push(piece);
  }
  return out;
}

/** Degrees between two turns, -180 to 180. */
function turnBetween(a, b) {
  return (((((b || 0) - (a || 0)) % 360) + 540) % 360) - 180;
}

/**
 * The UPDATE_ELEMENT patch that puts `el` (its placer piece `piece`) at
 * `pose` (die px, degrees): `x`, `y` as fractions of the stage, `rotation`,
 * and a logo's `scale` or a measured text's `fontScale` by how much the pose
 * grew. Only what moved is in it, so a field that did not keeps its stored
 * value bit for bit; null when nothing moved.
 *
 * @param {any} el
 * @param {{ cx: number, cy: number, w: number, h: number, rotation: number }} pose
 * @param {{ cx: number, cy: number, w: number, h: number, rotation: number }} piece
 * @param {any} die
 */
export function commitPatch(el, pose, piece, die) {
  if (!isObject(el) || !pose || !piece) return null;
  const W = die.stage.width;
  const H = die.stage.height;
  const patch = {};
  if (finite(pose.cx) && Math.abs(pose.cx - piece.cx) > SAME) patch.x = pose.cx / W;
  if (finite(pose.cy) && Math.abs(pose.cy - piece.cy) > SAME) patch.y = pose.cy / H;
  if (finite(pose.rotation) && Math.abs(turnBetween(piece.rotation, pose.rotation)) > SAME) patch.rotation = pose.rotation;
  if (finite(pose.w) && piece.w > 0 && Math.abs(pose.w - piece.w) > SAME) {
    if (el.type === "logo") patch.scale = pose.w / W;
    else if (el.type === "text" && finite(el.fontScale)) patch.fontScale = (el.fontScale * pose.w) / piece.w;
  }
  return Object.keys(patch).length ? patch : null;
}

// ---- A piece's art ---------------------------------------------------------------------

/**
 * The die rect a piece's art is exported from: its unturned box when it is
 * square to the die, else the bounding box of its turned one (the stage draws
 * it turned), both about its centre.
 *
 * @param {{ cx: number, cy: number, w: number, h: number, rotation?: number }} piece
 */
export function pieceArtRect(piece) {
  const t = (piece.rotation || 0) * RAD;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const square = turnBetween(0, piece.rotation) === 0;
  const w = square ? piece.w : piece.w * c + piece.h * s;
  const h = square ? piece.h : piece.w * s + piece.h * c;
  return { x: piece.cx - w / 2, y: piece.cy - h / 2, w, h, turned: !square };
}

/**
 * A piece's art alone, at die scale, its canvas the piece's unturned box
 * (Hat3D's `pieceArt`): the stage's art layer with only this element drawn
 * and no ground (exportArtCanvas({ color: false, only })), on the piece's box;
 * a turned piece is exported on its bounding box and turned back onto its own.
 * Null when the stage gives nothing or the piece has no size.
 *
 * @param {{ exportArtCanvas: Function }} stage
 * @param {{ id: string, cx: number, cy: number, w: number, h: number, rotation?: number }} piece
 * @param {{ createElement: (tag: string) => any }} doc
 */
export function renderPieceArt(stage, piece, doc) {
  if (!stage?.exportArtCanvas || !(piece?.w > 0 && piece.h > 0)) return null;
  const rect = pieceArtRect(piece);
  const src = stage.exportArtCanvas({ color: false, only: piece.id, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
  if (!src?.width || !src.height) return null;
  if (!rect.turned) return src;
  const out = doc.createElement("canvas");
  out.width = Math.max(1, Math.round(piece.w));
  out.height = Math.max(1, Math.round(piece.h));
  const g = out.getContext("2d");
  // die px of the piece's unturned box onto the canvas, its centre at the middle
  g.setTransform(out.width / piece.w, 0, 0, out.height / piece.h, 0, 0);
  g.translate(piece.w / 2, piece.h / 2);
  g.rotate(-(piece.rotation || 0) * RAD);
  g.drawImage(src, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
  // read, not kept: iOS keeps a canvas's memory until its size is zeroed
  src.width = 0;
  return out;
}

/** What a piece's art depends on: everything but where it is and how it is turned, and its size to the px. */
function artKey(el, piece) {
  const { x, y, rotation, ...rest } = el;
  void x;
  void y;
  void rotation;
  return `${JSON.stringify(rest)}|${Math.round(piece.w)}x${Math.round(piece.h)}`;
}

/**
 * The pieces' art, kept per piece while it is unchanged: the hat's look keeps
 * its sprites by canvas, so the same canvas back means no new sprite (its one
 * slow call) for a piece moved or turned since. A piece's canvas made again
 * zeroes the one it replaces.
 */
export function createPieceArtCache() {
  const kept = new Map(); // id -> { key, canvas }
  return {
    /**
     * @param {any} stage
     * @param {any} el the piece's element
     * @param {any} piece
     * @param {any} doc
     */
    get(stage, el, piece, doc) {
      if (!isObject(el) || !piece) return null;
      const key = artKey(el, piece);
      const hit = kept.get(piece.id);
      if (hit && hit.key === key && hit.canvas.width) return hit.canvas;
      const canvas = renderPieceArt(stage, piece, doc);
      if (!canvas) return null;
      if (hit && hit.canvas !== canvas) hit.canvas.width = 0;
      kept.set(piece.id, { key, canvas });
      return canvas;
    },
    /** Lets every kept canvas go (leaving the step, a new design). */
    clear() {
      for (const { canvas } of kept.values()) canvas.width = 0;
      kept.clear();
    },
  };
}

/**
 * The spot's art without one piece (Hat3D's `restArt`): the stage's art layer
 * without that element and without the ground, on the zone's rect, in die px.
 * Null when nothing else is on the spot (the hat then shows the spot bare
 * under the piece), or the zone is not on the die.
 *
 * @param {{ exportArtCanvas: Function }} stage
 * @param {any} die
 * @param {string} zoneId
 * @param {string} exceptId
 * @param {any[]} elements
 * @param {(el: any) => string | null} zoneOf
 */
export function restArtFor(stage, die, zoneId, exceptId, elements, zoneOf) {
  const zone = die?.zones.find((z) => z.id === zoneId);
  if (!stage?.exportArtCanvas || !zone) return null;
  const others = (elements ?? []).some((el) => el?.id !== exceptId && (el.type === "logo" || el.type === "text") && zoneOf(el) === zoneId);
  if (!others) return null;
  return stage.exportArtCanvas({ color: false, rect: { ...zone.rect }, exclude: [exceptId] }) ?? null;
}

// ---- The phone's Adjust row --------------------------------------------------------------

/** What a press of each of the Adjust row's buttons does. */
export const ADJUST_ACTS = Object.freeze(["smaller", "larger", "ccw", "cw", "straight", "left", "right", "up", "down", "centre"]);
/** Those, and "rotate": a turn to `rotation` degrees (the desktop's angle buttons, layerRotate). */
const ACTS = new Set([...ADJUST_ACTS, "rotate"]);
const TURNS = new Set(["ccw", "cw", "straight", "rotate"]);

/** A size in inches as the Adjust row reads it: "2.10 × 1.05 in", or null for a piece with no size yet. */
export function sizeLabel(piece, pxPerInch) {
  if (!(piece?.w > 0 && piece.h > 0) || !(pxPerInch > 0)) return null;
  return `${(piece.w / pxPerInch).toFixed(2)} × ${(piece.h / pxPerInch).toFixed(2)} in`;
}

/**
 * A turn as the designer reads it: whole degrees from the spot's level
 * (spotLimits `level`, where 0° is parallel to the bottom of the hat),
 * clockwise positive, -179 to 180.
 */
export function angleFromLevel(rotation, level = 0) {
  const a = Math.round(turnBetween(level, rotation));
  return a === -180 ? 180 : a || 0;
}

/** A piece's turn as the Adjust row reads it: "0°", "12°", "−3°". */
export function angleLabel(piece, level = 0) {
  const a = angleFromLevel(piece?.rotation ?? 0, level);
  return `${a < 0 ? "−" : ""}${Math.abs(a)}°`;
}

/** Closer than this (die px, degrees) a piece is still the size and turn a turn left it at. */
const INTENT_PX = 1e-3;
const INTENT_DEG = 1e-6;

/**
 * The size to turn `piece` at: the one asked for before a turn of the Adjust
 * row shrank it to the cap (`intent`, from adjustAction), while the piece is
 * still the size and turn that turn left it at; else its own. As the
 * placer's keys keep it (hat-place.js askedSize), so turning a logo and
 * turning it back gives back its size instead of ratcheting it down.
 *
 * @param {{ id: string, w: number, h: number, at: { w: number, h: number, rotation: number } } | null | undefined} intent
 * @param {{ id: string, w: number, h: number, rotation?: number } | null | undefined} piece
 * @returns {{ w: number, h: number } | null}
 */
export function askedSize(intent, piece) {
  if (!intent || !piece || intent.id !== piece.id) return null;
  const holds =
    Math.abs(piece.w - intent.at.w) <= INTENT_PX &&
    Math.abs(piece.h - intent.at.h) <= INTENT_PX &&
    Math.abs(turnBetween(intent.at.rotation, piece.rotation || 0)) <= INTENT_DEG;
  return holds ? { w: intent.w, h: intent.h } : null;
}

/**
 * One press of the Adjust row on the selected piece: the pose it asks for,
 * confined to the spot as the placer's keys confine theirs (from where the
 * piece is, `slide: "step"`, so a nudge follows a gently sloping edge and
 * stops when pushed into one; Centre is a jump to the area's home, confined
 * where it lands), as one UPDATE_ELEMENT through the hat's reducer, which
 * confines it again; and the note the placer gives when a limit was met.
 * `action` is null when the press changes nothing (pushed into the edge it is
 * against), `note` "" when no limit was met.
 *
 * Turn left and Turn right are a degree each (TURN_DEG); Straighten turns the
 * piece to its spot's level (`limits.level`), parallel to the bottom of the
 * hat. A turn (Turn left, Turn right, Straighten) confines from `asked`, the size
 * asked for before an earlier turn shrank the piece (askedSize), as the
 * placer's keys do: six turns there and six back end where they began. Its
 * note is still for the size the piece shows. `intent` is what to keep for
 * the next press: the size a turn was asked at and what it left (a turn), null
 * (a resize ends it), or undefined (a move keeps whatever was kept).
 *
 * @param {string} act one of ADJUST_ACTS, or "rotate" with `rotation`
 * @param {{ element: any, piece: any, limits: ReturnType<typeof spotLimits>, die: any,
 *   asked?: { w: number, h: number } | null, rotation?: number }} o
 * @returns {{ action: { type: "UPDATE_ELEMENT", id: string, patch: Record<string, number>, slide?: "step", jump?: true } | null,
 *   note: string, intent?: { id: string, w: number, h: number, at: { w: number, h: number, rotation: number } } | null }}
 */
export function adjustAction(act, { element, piece, limits, die, asked = null, rotation = null }) {
  if (!element || !piece || !limits || !ACTS.has(act)) return { action: null, note: "" };
  if (act === "rotate" && !finite(rotation)) return { action: null, note: "" };
  const ppi = limits.pxPerInch;
  const was = { cx: piece.cx, cy: piece.cy, w: piece.w, h: piece.h, rotation: piece.rotation || 0 };
  const pose = { ...was };
  const step = NUDGE_IN * ppi;
  const sized = was.w > 0 && was.h > 0;
  if (act === "smaller" || act === "larger") {
    if (!sized) return { action: null, note: "" };
    let k = act === "larger" ? SIZE_STEP : 1 / SIZE_STEP;
    // never below the placer's floor on the shorter side
    if (k < 1) k = Math.max(k, Math.min(1, (MIN_SIDE_IN * ppi) / Math.min(was.w, was.h)));
    pose.w = was.w * k;
    pose.h = was.h * k;
  }
  if (act === "ccw") pose.rotation = was.rotation - TURN_DEG;
  if (act === "cw") pose.rotation = was.rotation + TURN_DEG;
  if (act === "straight") pose.rotation = limits.level ?? 0;
  if (act === "rotate") pose.rotation = rotation;
  if (act === "left") pose.cx -= step;
  if (act === "right") pose.cx += step;
  if (act === "up") pose.cy -= step;
  if (act === "down") pose.cy += step;
  const centre = act === "centre";
  if (centre) {
    const home = areaHome(limits.area);
    if (home) [pose.cx, pose.cy] = home;
  }
  // a turn as the placer keeps one: -180 to 180
  pose.rotation = turnBetween(0, pose.rotation);
  const lim = centre ? { area: limits.area, cap: limits.cap } : { area: limits.area, cap: limits.cap, from: { cx: was.cx, cy: was.cy }, slide: "step" };
  const turn = TURNS.has(act);
  const from = turn && sized && asked?.w > 0 && asked.h > 0 ? { w: asked.w, h: asked.h } : null;
  // the note for the size it shows; the pose from the size asked for
  const said = confinePose(pose, lim);
  const fit = from ? confinePose({ ...pose, w: from.w, h: from.h }, lim) : said;
  const spot = limits.labels.spot;
  const note = said.capped
    ? `That's the largest the ${spot} takes: ${limits.maxImprint.w} × ${limits.maxImprint.h} in.`
    : said.moved && !centre
      ? `The ${spot}'s logo area ends here.`
      : "";
  const patch = commitPatch(element, fit, was, die);
  if (!patch) return { action: null, note };
  const intent = turn
    ? sized
      ? { id: element.id, w: from?.w ?? was.w, h: from?.h ?? was.h, at: { w: fit.w, h: fit.h, rotation: fit.rotation } }
      : undefined
    : act === "smaller" || act === "larger"
      ? null
      : undefined;
  return {
    action: { type: "UPDATE_ELEMENT", id: element.id, patch, ...(centre ? { jump: /** @type {true} */ (true) } : { slide: /** @type {"step"} */ ("step") }) },
    note,
    ...(intent === undefined ? {} : { intent }),
  };
}

// ---- The desktop's LayerControls on a hat die -----------------------------------------------

/**
 * LayerControls' `resize` on a hat die: Smaller or Larger (`direction` -1 or
 * 1) by the Adjust row's tenth (SIZE_STEP), a logo's `scale` or a line's
 * `fontScale`, never under MIN_SIDE_IN (a logo's shorter side, a line's font
 * size), and Smaller never grows a piece already under it. Null when the
 * press changes nothing. The hat's reducer then keeps the piece in its spot
 * and under its cap. (The can cooler's fixed steps, 0.05 of the sheet, are
 * 0.93 in on round E1's sheet, and their floor made Smaller grow a small logo.)
 *
 * @param {any} element
 * @param {number} direction
 * @param {any} die
 */
export function layerResize(element, direction, die) {
  if (!isObject(element) || !die || !direction) return null;
  const floor = MIN_SIDE_IN * die.pxPerInch;
  const grow = direction > 0;
  let side = 0;
  if (element.type === "logo") {
    const pose = elementPose(element, die);
    if (!pose || !(pose.w > 0 && pose.h > 0) || !finite(element.scale)) return null;
    side = Math.min(pose.w, pose.h);
  } else if (element.type === "text" && finite(element.fontScale) && element.fontScale > 0) {
    side = element.fontScale * die.stage.width;
  } else {
    return null;
  }
  const k = grow ? SIZE_STEP : Math.max(1 / SIZE_STEP, Math.min(1, floor / side));
  if (k === 1) return null;
  return element.type === "logo" ? { scale: element.scale * k } : { fontScale: element.fontScale * k };
}

/**
 * LayerControls' `rotate` on a hat die: a turn to `rotation` degrees, kept in
 * its spot from the size asked for before an earlier turn shrank it (as the
 * Adjust row's turns, adjustAction "rotate"), as the patch to send, or null
 * for none. `intentRef` keeps what the last turn was asked at between
 * presses; `box` a line of text's measured box (drawnTextBox), when there is
 * one.
 *
 * @param {any} element
 * @param {number} rotation
 * @param {{ die: any, intentRef: { current: any }, box?: any }} o
 */
export function layerRotate(element, rotation, { die, intentRef, box = null }) {
  if (!isObject(element) || !die || !finite(rotation)) return null;
  const zone = zoneOfElement(element, die);
  const limits = zone ? spotLimits(die, zone.id) : null;
  const piece = pieceOf(element, die, box);
  if (!limits || !piece) return { rotation };
  const { action, intent } = adjustAction("rotate", { element, piece, limits, die, asked: askedSize(intentRef.current, piece), rotation });
  if (intent !== undefined) intentRef.current = intent;
  return action?.patch ?? null;
}
