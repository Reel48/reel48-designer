// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/coozie-step-machine.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The mobile can cooler form's steps, as data, plus the pure arithmetic around
// them: which step follows which, how a step is written into the URL and the
// history entry, which face of the die the canvas frames, and where new artwork
// lands on that face. Kept out of the components so it can be tested in the
// node test environment, which has no DOM.

/**
 * One decision per step, in the order Brayden set (2026-10-09). `face` steps
 * zoom the canvas into one panel so artwork is big enough to drag with a
 * finger; the rest show the whole die. Since 2026-10-18 (Brayden: fold magnet
 * and speed in) the magnet and the production speed are two switches on the
 * quantity step, so five numbered steps build the design and the order.
 *
 * `label` is the progress bar's short name for the step; `title` is the
 * question the panel asks. Sentence case, no em dashes (both are guarded).
 */
export const STEPS = Object.freeze([
  { id: "size", label: "Can", title: "Which can is it for?", camera: "overview" },
  { id: "color", label: "Color", title: "Pick a color or pattern", camera: "overview" },
  { id: "logo", label: "Logo", title: "Add your logo", camera: "face" },
  { id: "text", label: "Text", title: "Add text?", camera: "face" },
  { id: "quantity", label: "Quantity", title: "How many do you need?", camera: "overview" },
  // The results page (Brayden, 2026-10-10): share or email the design before
  // the order summary. The 3D fills it, with Share a circle on the design;
  // its title is the screen reader's heading only on a phone, and the open
  // row's heading on the desktop. Arriving here from the last numbered step
  // sets off the confetti (Brayden, 2026-10-17).
  { id: "share", label: "Share", title: "Your design is done", camera: "overview" },
  { id: "checkout", label: "Checkout", title: "Ready to check out", camera: "overview" },
]);

export const STEP_IDS = Object.freeze(STEPS.map((s) => s.id));
export const FIRST_STEP = STEP_IDS[0];
export const LAST_STEP = STEP_IDS[STEP_IDS.length - 1];

/**
 * Where the design is done (Brayden, 2026-10-17): the share page. The count
 * stops there. The steps before it build the design and are numbered ("Step 3
 * of 7"); the share page celebrates it and checkout buys it, so neither is
 * counted.
 */
export const DONE_STEP = "share";
export const COUNTED_STEPS = STEP_IDS.indexOf(DONE_STEP);

/** Whether `id` is one of the numbered steps that build the design. */
export function isCountedStep(id) {
  const i = STEP_IDS.indexOf(id);
  return i >= 0 && i < COUNTED_STEPS;
}

/** "Step 3 of 7." for a step that builds the design, "" from the share page on. */
export function stepPosition(id) {
  return isCountedStep(id) ? `Step ${STEP_IDS.indexOf(id) + 1} of ${COUNTED_STEPS}.` : "";
}

export function isStepId(id) {
  return typeof id === "string" && STEP_IDS.includes(id);
}

// Steps that were folded into another (2026-10-18), so a link, a history
// entry or a draft saved on one still lands where its question now is.
const FOLDED_STEPS = Object.freeze({ magnet: "quantity", speed: "quantity" });

/** A step id, or the step a folded one now lives on, or null. */
export function normalizeStepId(id) {
  if (isStepId(id)) return id;
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(FOLDED_STEPS, id) ? FOLDED_STEPS[id] : null;
}

export function stepIndex(id) {
  return STEP_IDS.indexOf(id);
}

export function stepById(id) {
  return STEPS[stepIndex(id)] ?? null;
}

/** The step after `id`, or null on the last one. */
export function nextStep(id) {
  const i = stepIndex(id);
  return i >= 0 && i < STEP_IDS.length - 1 ? STEP_IDS[i + 1] : null;
}

/** The step before `id`, or null on the first one. */
export function prevStep(id) {
  const i = stepIndex(id);
  return i > 0 ? STEP_IDS[i - 1] : null;
}

// ---------------------------------------------------------------------------
// The URL and the history entry
//
// Each step is a hash, `#design/<step>`, so the phone's own back gesture steps
// back through the form instead of leaving the page. A hash, not `?step=`:
// PageViewTracker counts a page view per query-string change and none per hash
// change, so a query parameter would log eight page views per order.
// ---------------------------------------------------------------------------

export const HASH_PREFIX = "#design";

/**
 * A link that asks for a new design ("Add another design" on the cart page):
 * the designer starts one at once when the saved design is safe in the cart
 * (or there is none), and otherwise offers the saved one first, as ever.
 * Not a step, so parseStepHash reads it as null.
 */
export const NEW_DESIGN_HASH = `${HASH_PREFIX}/new`;

export function formatStepHash(id) {
  return `${HASH_PREFIX}/${id}`;
}

/**
 * What a location hash asks for: a step id, `FIRST_STEP` for a bare
 * `#design`, or null when the hash is not ours (or names no step).
 */
export function parseStepHash(hash) {
  if (typeof hash !== "string") return null;
  if (hash === HASH_PREFIX) return FIRST_STEP;
  if (!hash.startsWith(`${HASH_PREFIX}/`)) return null;
  return normalizeStepId(hash.slice(HASH_PREFIX.length + 1));
}

/**
 * The state object a form entry carries. Next copies its own router internals
 * into whatever object pushState receives (app-router.js,
 * copyNextJsInternalHistoryState), so this key rides alongside them.
 *
 * `depth` counts the form's entries above the page's own, so the close button
 * can unwind exactly that many. `returnTo` (`{ step, depth }`) marks an entry
 * opened by an Edit link on the checkout step: its primary action unwinds back
 * to that entry instead of walking on through the steps in between.
 */
export const HISTORY_KEY = "coozieForm";

function validDepth(n) {
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * @param {string} step
 * @param {number} depth
 * @param {{ step: string, depth: number } | null} [returnTo]
 */
export function historyStateFor(step, depth, returnTo = null) {
  return { [HISTORY_KEY]: { step, depth, ...(returnTo ? { returnTo } : {}) } };
}

/** The form's part of a history state, or null for any other entry. */
export function readHistoryState(state) {
  const entry = state && typeof state === "object" ? state[HISTORY_KEY] : null;
  const step = entry ? normalizeStepId(entry.step) : null;
  if (!step) return null;
  const depth = validDepth(entry.depth);
  const r = entry.returnTo;
  const returnStep = r && typeof r === "object" ? normalizeStepId(r.step) : null;
  const returnTo = returnStep && validDepth(r.depth) < depth ? { step: returnStep, depth: validDepth(r.depth) } : null;
  return { step, depth, returnTo };
}

// ---------------------------------------------------------------------------
// The camera and where artwork lands
// ---------------------------------------------------------------------------

export const FACES = Object.freeze(["front", "base", "back"]);
export const DEFAULT_FACE = "front";

export const FACE_LABELS = Object.freeze({ front: "Front", base: "Base", back: "Back" });

/**
 * The view the canvas takes on `stepId`. On a face step the Back panel is
 * turned 180 degrees: it folds under at the base, so on the finished can
 * cooler it reads upright only when the artwork on it is upside down in the
 * flat template. Showing it turned means the customer designs it the way it
 * will be seen.
 */
export function viewForStep(stepId, face = DEFAULT_FACE) {
  if (stepById(stepId)?.camera !== "face") return { focus: null, rotate180: false };
  const f = FACES.includes(face) ? face : DEFAULT_FACE;
  return { focus: f, rotate180: f === "back" };
}

/**
 * The face's rectangle in native stage pixels. Front and back are the die's
 * own zones; the base is the disc's bounding box.
 */
export function faceRect(geom, face) {
  if (face === "base") {
    return { x0: geom.cx - geom.r, y0: geom.cy - geom.r, x1: geom.cx + geom.r, y1: geom.cy + geom.r };
  }
  const zone = geom.zones?.find((z) => z.id === face);
  return zone ? zone.bounds : null;
}

/**
 * Where a new logo or text element goes when added on `face`: its centre, as
 * the fractions of the die's native frame the design document stores, and
 * turned 180 degrees on the back so it prints upright (see viewForStep).
 */
export function placementFor(face, geom, stage) {
  const rect = faceRect(geom, face) ?? faceRect(geom, DEFAULT_FACE);
  return {
    x: (rect.x0 + rect.x1) / 2 / stage.width,
    y: (rect.y0 + rect.y1) / 2 / stage.height,
    rotation: face === "back" ? 180 : 0,
  };
}

/**
 * Which face an element sits on, by its centre: the base disc if the centre is
 * inside it, otherwise the panel on that side of the fold. Used to keep the
 * canvas and the selection on the same side, so the panel's tools never act
 * on artwork out of sight. Artwork trimmed to a side (designer v1.10.0
 * `clip`) is on that side, as the canvas has it.
 */
export function faceOf(el, geom, stage) {
  if (Object.prototype.hasOwnProperty.call(FACE_LABELS, el.clip)) return el.clip;
  const x = el.x * stage.width;
  const y = el.y * stage.height;
  if (Math.hypot(x - geom.cx, y - geom.cy) <= geom.r) return "base";
  return el.y < geom.bottomPanelStartY ? "front" : "back";
}

// Angles as the transformer reports them, in (-180, 180].
function wrap180(deg) {
  const r = ((((deg % 360) + 540) % 360) - 180);
  return r === -180 ? 180 : r;
}

// A logo copied onto the base must fit the disc: its diagonal at most this
// share of the disc's diameter, so it clears the edge where the foam curves.
const BASE_FIT = 0.85;

/**
 * Where a copy of `el` goes on `toFace` ("Copy the front"):
 * `{ x, y, rotation }`, plus `scale` for a logo going to the base.
 *
 * Back from front, or front from back: the same spot as seen on the finished
 * can cooler. The back folds under at the base, so it is the front turned 180
 * degrees in the flat template, and a mirror through the panel's centre with
 * the angle turned 180 lands the copy where the original is, the right way up.
 * Same size: both panels are the same width on every die.
 *
 * The base: centred on the disc, upright, and shrunk only if it would not fit.
 *
 * A source near an edge (a front logo beside the disc, say) can mirror off the
 * target panel; then the copy goes to the target's centre instead, so it is
 * always on the side the customer asked for.
 */
export function copyPlacement(el, toFace, geom, stage) {
  const from = faceOf(el, geom, stage);
  const target = faceRect(geom, toFace) ?? faceRect(geom, DEFAULT_FACE);
  const tx = (target.x0 + target.x1) / 2;
  const ty = (target.y0 + target.y1) / 2;
  // Undo the source panel's turn, then apply the target's.
  const upright = el.rotation - (from === "back" ? 180 : 0);

  if (toFace === "base") {
    const aspect = el.naturalHeight / el.naturalWidth || 1;
    const fits = (2 * geom.r * BASE_FIT) / (stage.width * Math.hypot(1, aspect));
    return {
      x: tx / stage.width,
      y: ty / stage.height,
      rotation: wrap180(upright),
      ...(el.type === "logo" || el.scale != null ? { scale: Math.min(el.scale, fits) } : {}),
    };
  }

  const source = faceRect(geom, from === "base" ? DEFAULT_FACE : from);
  const dx = el.x * stage.width - (source.x0 + source.x1) / 2;
  const dy = el.y * stage.height - (source.y0 + source.y1) / 2;
  const turn = (from === "back") !== (toFace === "back") ? -1 : 1;
  const mirrored = { x: (tx + turn * dx) / stage.width, y: (ty + turn * dy) / stage.height };
  const landed = faceOf(mirrored, geom, stage) === toFace ? mirrored : { x: tx / stage.width, y: ty / stage.height };
  return {
    ...landed,
    rotation: wrap180(upright + (toFace === "back" ? 180 : 0)),
  };
}

/**
 * "Copy the front": the actions that put a mirrored copy of every front
 * element of `kind` ("logo" or "text") on the back, in their stacking order.
 * Each is a DUPLICATE_ELEMENT (so the copy keeps everything: artwork, size,
 * opacity, font, fill) and an UPDATE_ELEMENT moving it into place, and all of
 * them share `key`, which the history reducer coalesces into ONE undo step.
 * `nextId(type)` makes each new element's id.
 */
export function copyFrontActions(elements, kind, geom, stage, nextId, key) {
  const actions = [];
  for (const el of elements) {
    if (el.type !== kind || faceOf(el, geom, stage) !== "front") continue;
    // A line emptied in the field is about to be removed, not copied.
    if (el.type === "text" && !String(el.text ?? "").trim()) continue;
    const newId = nextId(el.type);
    const { x, y, rotation } = copyPlacement(el, "back", geom, stage);
    // A front logo let run past the edge is trimmed to the front; its copy is
    // trimmed the same way, to the back.
    const clip = el.clip ? { clip: "back" } : {};
    actions.push({ type: "DUPLICATE_ELEMENT", id: el.id, newId, coalesceKey: key });
    actions.push({ type: "UPDATE_ELEMENT", id: newId, patch: { x, y, rotation, ...clip }, coalesceKey: key });
  }
  return actions;
}

// A new logo leaves this share of its side free on every edge's account, so
// it starts wholly inside with room to move.
const FACE_FIT = 0.85;

/**
 * The size (a fraction of the stage width, as ADD_LOGO's `scale`) for a new
 * logo of this natural size on `face`: the package's default 0.4, or smaller
 * when that would not fit the side, so it starts inside its boundary.
 */
export function logoScaleFor(face, natural, geom, stage, preferred = 0.4) {
  const aspect = natural?.naturalHeight / natural?.naturalWidth || 1;
  if (face === "base") {
    return Math.min(preferred, (2 * geom.r * FACE_FIT) / (stage.width * Math.hypot(1, aspect)));
  }
  const rect = faceRect(geom, face) ?? faceRect(geom, DEFAULT_FACE);
  const w = (rect.x1 - rect.x0) * FACE_FIT;
  const h = (rect.y1 - rect.y0) * FACE_FIT;
  return Math.min(preferred, w / stage.width, h / aspect / stage.width);
}

/**
 * How many logos and lines of text each side carries, for the steps' push to
 * the back and their "Copy the front" (almost every order prints both sides,
 * Brayden 2026-10-09): `{ logo: { here, front, back }, text: { ... } }`, where
 * `here` is the side shown. Both layouts count with this one rule.
 */
export function sidesFor(elements, geom, stage, face) {
  const sides = { logo: { here: 0, front: 0, back: 0 }, text: { here: 0, front: 0, back: 0 } };
  for (const el of elements) {
    const count = sides[el.type];
    if (!count) continue;
    const f = faceOf(el, geom, stage);
    if (f === face) count.here += 1;
    if (f === "front") count.front += 1;
    if (f === "back") count.back += 1;
  }
  return sides;
}

/**
 * The note under the canvas when artwork is let go past its side's edge (the
 * stage glides it back): where to put it instead, when it was heading for
 * another side (`target` rings that side's switch), or that it stays put.
 * Only the first time: after that the stage lets it run past the edge
 * (designer v1.10.0 `overflow`, which reports `canOverflow`), and the note
 * says how.
 */
export function confineNote({ face, toward, canOverflow = false }) {
  const again = canOverflow ? " To let it run past the edge, drag it out again." : "";
  if (toward) {
    return {
      text: `To put artwork on the ${FACE_LABELS[toward].toLowerCase()}, switch to ${FACE_LABELS[toward]}.${again}`,
      target: toward,
    };
  }
  return { text: `Artwork stays on the ${FACE_LABELS[face].toLowerCase()}.${again}` };
}

/** The note when artwork is let go past its side's edge and trimmed there. */
export function clipNote({ face }) {
  return { text: `Anything past the edge of the ${FACE_LABELS[face].toLowerCase()} is trimmed off.` };
}

/**
 * What the canvas shows of a "with magnet" can cooler's magnet: drawn solid
 * on the back panel, faded to a ghost while artwork is selected so the logo
 * being placed under it stays visible, and nothing without one. (A part sewn
 * on, never print: the stage leaves it out of every proof.)
 */
export function magnetOnStage(decoration, selectedId) {
  if (decoration !== "with_magnet") return null;
  return selectedId ? "ghost" : "solid";
}
