// The die registry: the physical shape a design is authored onto.
//
// Extracted verbatim from Reel48-Storefront/src/lib/coozie-config.js. The
// arithmetic below is unchanged — `tests/dies.test.js` pins every derived
// number and the full traced outline against values captured from that file
// before the move, and the storefront's own die test now runs against this
// package. A 0.001 change to pxPerInch fails all of it.
//
// That matters more than it looks. Every stored designJson holds element
// positions as FRACTIONS of a die's stage frame, so a frame that moves
// relocates artwork on orders already placed — including orders already in
// production. docs/REMOTE_ADMIN.md in the storefront says it plainly: re-deriving
// this in a consumer means two copies of the geometry, and the one that drifts
// is the one that gets an order made wrong. That is the whole reason this
// package exists.
//
// ---------------------------------------------------------------------------
// Die-line geometry, koozies
//
// A collapsible koozie is one flat cut of foam: front panel, circular base,
// back panel. Folded at the base, the panels glue into a tube and the circle
// becomes the bottom — which is why anything on the bottom panel prints upside
// down (see the `flipped` zone below).
//
// The standard numbers are measured off Reel48's own production art: a
// 336.75 x 768 pt vector page whose die is 304 pt wide, panels 290 pt tall,
// base disc 207 pt across, 161 pt between the panels. (The source file is named
// for the customer it was cut for, so it is referenced by shape rather than by
// name — this repo is public.)
//
// The slim die is the 12 oz SLEEK can — 2.24" x 6.13", what White Claw, Truly,
// High Noon, Michelob Ultra and Red Bull 12 oz all use. (A true slim can is
// 53 mm / 200-end and almost always 8.4 oz; it is not this.) Confirmed with the
// supplier on 2026-08-01: treat both dies as production specs and re-confirm
// before changing either.
// ---------------------------------------------------------------------------

/**
 * The panels span this fraction of the stage width; the rest is margin. Shared
 * by both koozie dies so a logo's `scale` covers the same share of the panel on
 * each.
 */
const PANEL_WIDTH_FRACTION = 0.8;

/**
 * Koozie geometry: two panels with a circular base between them.
 *
 * Returns the derived numbers, the traced outline as declarative path commands,
 * and the zones an element can land in. The outline is DATA rather than a
 * sequence of ctx calls so a renderer can walk it without knowing what a koozie
 * is — which is what lets a hat or a polo be added as a registry entry instead
 * of a second renderer.
 */
function koozieOutline({ panelW, panelH, discD, gap }, { width, height }) {
  const pxPerInch = (width * PANEL_WIDTH_FRACTION) / panelW;

  const pw = panelW * pxPerInch;
  const ph = panelH * pxPerInch;
  const g = gap * pxPerInch;
  const r = (discD * pxPerInch) / 2;
  const x0 = (width - pw) / 2;
  const y0 = (height - (2 * ph + g)) / 2;

  const y1 = y0 + ph;
  const y2 = y0 + ph + g;
  const y3 = y0 + 2 * ph + g;
  const cx = width / 2;
  const cy = y0 + ph + g / 2;
  // Half-width of the chord where the disc meets a panel edge, and the angle
  // off horizontal at that point — the disc is wider than the gap, so its top
  // and bottom are hidden behind the panels.
  const chord = Math.sqrt(r * r - (g / 2) ** 2);
  const theta = Math.asin(g / 2 / r);

  return {
    pxPerInch,
    x0,
    x1: x0 + pw,
    y0,
    y1,
    y2,
    y3,
    cx,
    cy,
    r,
    chord,
    theta,
    // Kept for compatibility with stored designs and existing consumers. The
    // `flipped` zone below is the general form; this is the koozie's answer to
    // the same question.
    bottomPanelStartY: y2 / height,

    // The outline, in the order traceDie() drew it. Fill for the silhouette,
    // stroke for the die-line — the same path both times, so the mask and the
    // outline cannot drift apart the way two raster layers could.
    cmds: [
      ["M", x0, y0],
      ["L", x0 + pw, y0],
      ["L", x0 + pw, y1],
      ["L", cx + chord, y1],
      ["A", cx, cy, r, -theta, theta, false], // right of the disc
      ["L", x0 + pw, y2],
      ["L", x0 + pw, y3],
      ["L", x0, y3],
      ["L", x0, y2],
      ["L", cx - chord, y2],
      ["A", cx, cy, r, Math.PI - theta, Math.PI + theta, false], // left
      ["L", x0, y1],
      ["Z"],
    ],

    // Where an element can land, and what that means.
    //
    // Replaces the single `bottomPanelStartY` scalar. A hat has no fold, a polo
    // has a bounded imprint area, and a cooler wraps — all three are zones with
    // different properties rather than different scalars, so the upside-down
    // warning and the snap guides generalise instead of being re-derived.
    zones: [
      {
        id: "front",
        label: "Front panel",
        bounds: { x0, x1: x0 + pw, y0, y1 },
        flipped: false,
        snapLines: { x: [cx], y: [(y0 + y1) / 2] },
        maxImprint: null,
      },
      {
        id: "back",
        label: "Back panel (folds under)",
        bounds: { x0, x1: x0 + pw, y0: y2, y1: y3 },
        // Anything here prints upside down unless rotated ~180 degrees. This
        // flag is what the designer's warning reads.
        flipped: true,
        snapLines: { x: [cx], y: [(y2 + y3) / 2] },
        maxImprint: null,
      },
    ],
  };
}

/**
 * Every die Reel48 can print, keyed by id.
 *
 * `stage` is the native pixel frame the design is authored in, and both koozie
 * frames are PINNED. Adding a die is free; resizing one silently relocates
 * artwork on orders already placed. Add a new id rather than changing a frame.
 *
 * Adding a hat, polo or cooler is an entry here plus an outline function —
 * nothing in the renderer or the design document changes.
 */
export const DIES = {
  "koozie-standard": {
    id: "koozie-standard",
    kind: "koozie",
    label: "Standard can",
    blurb: "Regular 12 oz can",
    productHandle: "custom-coozie",
    measurements: { panelW: 4.2222, panelH: 4.0278, discD: 2.875, gap: 2.2361 },
    stage: { width: 1000, height: 2000 },
    outline: koozieOutline,
  },
  "koozie-slim": {
    id: "koozie-slim",
    kind: "koozie",
    label: "Slim can",
    blurb: "12 oz slim (sleek) can — seltzers, energy drinks",
    productHandle: "custom-coozie-slim",
    measurements: { panelW: 3.6935, panelH: 5.75, discD: 2.515, gap: 1.9561 },
    // Chosen so a slim stage pixel is the same physical size as a standard one
    // (189.5 px/in), then rounded to whole pixels.
    stage: { width: 875, height: 2600 },
    outline: koozieOutline,
  },
};

/** What a design authored before `dieId` existed meant by `size`. */
const LEGACY_SIZE_IDS = {
  standard: "koozie-standard",
  slim: "koozie-slim",
};

export const DEFAULT_DIE_ID = "koozie-standard";

/**
 * Narrow anything — a die object, an id, a legacy `size`, undefined, or
 * untrusted JSON — to a real die.
 *
 * THE `kind` ARGUMENT IS NOT OPTIONAL DECORATION. The storefront's
 * `resolveSize()` fell back to `standard` for anything unrecognised, which was
 * correct while koozies were the only product: a design stored before slim
 * existed carries no size at all and must land somewhere. Once hats exist, that
 * same fallback silently renders a hat design on a can — a wrong product made
 * at full cost. So a caller that KNOWS what it is opening passes `kind` and
 * gets a throw instead of a silent koozie.
 */
export function resolveDie(dieOrId, { kind } = {}) {
  const raw = typeof dieOrId === "string" ? dieOrId : dieOrId?.id;
  const id = LEGACY_SIZE_IDS[raw] ?? raw;
  const die = DIES[id];

  if (die && (!kind || die.kind === kind)) return die;
  if (kind) {
    throw new Error(
      `No die ${JSON.stringify(raw)} of kind ${JSON.stringify(kind)}. ` +
        `Known: ${Object.keys(DIES).join(", ")}`,
    );
  }
  return DIES[DEFAULT_DIE_ID];
}

/** Every die of one kind, for a picker. */
export function diesOfKind(kind) {
  return Object.values(DIES).filter((d) => d.kind === kind);
}

const geometryCache = new Map();

/**
 * Die-line geometry in native stage pixels, plus its outline and zones.
 *
 * Cached per die id, as the original was — the numbers are pure functions of
 * constants, and this runs inside a Konva sceneFunc on every frame.
 */
export function dieGeometry(dieOrId, opts) {
  const die = resolveDie(dieOrId, opts);
  const cached = geometryCache.get(die.id);
  if (cached) return cached;

  const geom = die.outline(die.measurements, die.stage);
  geometryCache.set(die.id, geom);
  return geom;
}

/**
 * Walk an outline's path commands onto a canvas 2D context (Konva's sceneFunc
 * context proxies one).
 *
 * `scale` converts native stage pixels to whatever the context is drawing at.
 *
 * This is the generic walker. `traceDie` below keeps the storefront's existing
 * call signature working unchanged.
 */
export function tracePath(ctx, cmds, scale = 1) {
  const s = (v) => v * scale;
  ctx.beginPath();
  for (const cmd of cmds) {
    const [op] = cmd;
    if (op === "M") ctx.moveTo(s(cmd[1]), s(cmd[2]));
    else if (op === "L") ctx.lineTo(s(cmd[1]), s(cmd[2]));
    else if (op === "A") ctx.arc(s(cmd[1]), s(cmd[2]), s(cmd[3]), cmd[4], cmd[5], cmd[6]);
    else if (op === "Z") ctx.closePath();
    else throw new Error(`unknown path command: ${op}`);
  }
}

/** The storefront's existing entry point, unchanged in signature and output. */
export function traceDie(ctx, geom, scale = 1) {
  tracePath(ctx, geom.cmds, scale);
}

/**
 * The centre lines a dragged element snaps to, in NATIVE stage px.
 *
 * Gathered from the zones and deduped, replacing three hardcoded expressions in
 * the storefront's stage. For a koozie the answer is identical — one vertical
 * through the panel centre, one horizontal through each panel — which
 * `tests/dies.test.js` asserts against the values captured before the move.
 *
 * The generalisation is what earns it: a hat has one zone, a polo has a bounded
 * imprint area, a cooler wraps. None of those can be written as "the midpoints
 * of the two panels", and every one of them is a registry entry away.
 *
 * The stage centre is deliberately NOT a target. On a koozie that is the middle
 * of the base disc, which is not somewhere artwork ever goes.
 */
export function snapTargets(geom) {
  const xs = new Set();
  const ys = new Set();
  for (const z of geom.zones ?? []) {
    for (const x of z.snapLines?.x ?? []) xs.add(x);
    for (const y of z.snapLines?.y ?? []) ys.add(y);
  }
  return { x: [...xs], y: [...ys] };
}

/**
 * Which zone a normalized point sits in, or null if it is off the die.
 *
 * The upside-down warning becomes "in a zone whose `flipped` is true", rather
 * than "below bottomPanelStartY" — the same answer for a koozie and a
 * meaningful one for a die that folds somewhere else or not at all.
 */
export function zoneAt(geom, nx, ny, stage) {
  const x = nx * stage.width;
  const y = ny * stage.height;
  for (const z of geom.zones) {
    const b = z.bounds;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return z;
  }
  return null;
}

// Colour of the die-line drawn over the artwork, and its width in *display*
// pixels — a fixed display width keeps it a hairline at any canvas size and
// scales up naturally in the exported proof.
export const DIE_LINE_COLOR = "#3C4246";
export const DIE_LINE_OPACITY = 0.7;
export const DIE_LINE_WIDTH = 1.5;
