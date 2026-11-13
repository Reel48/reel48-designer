// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-step-machine.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The hat form's steps, as data, plus the pure arithmetic around them: which
// step follows which, how a step is written into the URL and the history
// entry, and which spots of the die each placing step shows. The same exports
// as coozie-step-machine.js where the shared step hooks read them
// (useStepFormHistory and useInlineSteps take this module as their `machine`),
// with the hat's own steps and its own history key, so a can cooler form entry
// is never read as a hat's.

/**
 * One decision per step (integration plan §5, approved 2026-10-19). `face`
 * steps place artwork on one spot at a time, on the 3D hat itself since round
 * E1 (or the spot flat, where the hat can't be edited), and `zones` are the
 * die's zones that step can show; the rest show the hat in 3D.
 *
 * `label` is the progress bar's short name for the step; `title` is the
 * question the panel asks. Sentence case, no em dashes (both are guarded).
 */
export const STEPS = Object.freeze([
  { id: "colors", label: "Colors", title: "Pick your colors", camera: "overview" },
  { id: "front", label: "Front", title: "Add your logo to the front", camera: "face", zones: ["front"] },
  { id: "spots", label: "More spots", title: "Add more spots?", camera: "face", zones: ["left", "right", "back"] },
  // The rectangle only (2026-10-21): the square label is no longer offered.
  { id: "label", label: "Inside label", title: "Add an inside label?", camera: "face", zones: ["label_tall"] },
  { id: "quantity", label: "Quantity", title: "How many hats?", camera: "overview" },
  // As the can cooler's: the results page, where the count stops.
  { id: "share", label: "Share", title: "Your design is done", camera: "overview" },
  { id: "checkout", label: "Checkout", title: "Ready to check out", camera: "overview" },
]);

export const STEP_IDS = Object.freeze(STEPS.map((s) => s.id));
export const FIRST_STEP = STEP_IDS[0];
export const LAST_STEP = STEP_IDS[STEP_IDS.length - 1];

/** Where the design is done: the share page. The count stops there. */
export const DONE_STEP = "share";
export const COUNTED_STEPS = STEP_IDS.indexOf(DONE_STEP);

/** Whether `id` is one of the numbered steps that build the design. */
export function isCountedStep(id) {
  const i = STEP_IDS.indexOf(id);
  return i >= 0 && i < COUNTED_STEPS;
}

/** "Step 3 of 5." for a step that builds the design, "" from the share page on. */
export function stepPosition(id) {
  return isCountedStep(id) ? `Step ${STEP_IDS.indexOf(id) + 1} of ${COUNTED_STEPS}.` : "";
}

export function isStepId(id) {
  return typeof id === "string" && STEP_IDS.includes(id);
}

/** A step id, or null. */
export function normalizeStepId(id) {
  return isStepId(id) ? id : null;
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
// The URL and the history entry: `#design/<step>`, as the can cooler's, for
// the same reasons (coozie-step-machine.js). The history key is the hat's.
// ---------------------------------------------------------------------------

export const HASH_PREFIX = "#design";
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

export const HISTORY_KEY = "hatForm";

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
// The spots
// ---------------------------------------------------------------------------

/** What each zone is called on its switch and in the lists. */
export const ZONE_LABELS = Object.freeze({
  front: "Front",
  left: "Left side",
  right: "Right side",
  back: "Back",
  label_tall: "Inside label",
  label_square: "Inside label",
});

/**
 * The inside label's two shapes on the die, and the zone each one is. Only
 * the rectangle is offered (2026-10-21); the square is here to read a design
 * that has one, which is moved to the rectangle when it is opened again
 * (hat-draft.js).
 */
export const LABEL_ZONES = Object.freeze({ tall: "label_tall", square: "label_square" });
export const DEFAULT_LABEL_SHAPE = "tall";

/**
 * The label shape a design has chosen: the label zone its `zones` names, or
 * the default. The package keeps one label zone at a time (SET_ZONE).
 */
export function labelShapeOf(design) {
  const zones = design?.zones ?? {};
  if (zones.label_square) return "square";
  if (zones.label_tall) return "tall";
  return DEFAULT_LABEL_SHAPE;
}

/**
 * The zones a step can show, in the order its switch lists them; on the label
 * step the design's label shape's, the rectangle on every die a design opens
 * on today.
 */
export function zonesForStep(stepId, design) {
  if (stepId === "label") return [LABEL_ZONES[labelShapeOf(design)]];
  return stepById(stepId)?.zones ?? [];
}

/** The zone a step opens on. */
export function firstZoneOf(stepId, design) {
  return zonesForStep(stepId, design)[0] ?? "front";
}

/**
 * The view the stage takes on `stepId` showing `zone`: that zone alone, on a
 * placing step; the whole die (`focus: null`) anywhere else. A hat has no
 * fold, so nothing is turned.
 */
export function viewForStep(stepId, zone) {
  if (stepById(stepId)?.camera !== "face") return { focus: null, rotate180: false };
  const zones = stepById(stepId)?.zones ?? [];
  return { focus: zones.includes(zone) ? zone : zones[0] ?? "front", rotate180: false };
}

/** The step that places artwork on `zone`; a square label's is the label step too. */
export function stepForZone(zone) {
  if (zone === LABEL_ZONES.square) return "label";
  return STEPS.find((s) => s.zones?.includes(zone))?.id ?? "front";
}
