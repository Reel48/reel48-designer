// The design document: the reducer, undo/redo, and the serializer.
//
// Extracted verbatim from Reel48-Storefront/src/lib/coozie-design.js. Behaviour
// is unchanged and `tests/design.test.js` pins it against output captured from
// that file before the move — including the serialized shape, which is the
// contract data.reel48.com's supplier zip is built from.
//
// This is in `core/` by the rule in the README: it computes numbers that end up
// in `designJson`. Panels, pickers and toolbars do not, and stay with the host
// app.
//
// The design is a flat, ordered list of ELEMENTS (render/z-order = array order).
// Two element types share a common transform so selection, the Transformer,
// duplicate, reorder and the centre-alignment guides all work uniformly:
//
//   common: { id, type, x, y, rotation, opacity }   // x/y = normalized centre 0..1
//   logo:   + { fileName, mimeType, naturalWidth, naturalHeight, scale, source? }
//             scale  = logo width as a fraction of stage width
//             source = where the artwork came from, when that is worth recording
//                      — see ADD_LOGO
//   text:   + { text, fontFamily, fontStyle, fill, align, fontScale }
//             fontScale = font size as a fraction of stage width
//   either: + { clip? }   (v1.10.0)
//             clip = the side ("front" | "back" | "base") the element is
//                    trimmed to: whatever of it lies past that side's edge is
//                    not printed. Omitted when the element is whole. On a
//                    zoned die (v1.11.0) the side is a zone id.
//
// EVERY COORDINATE IS A FRACTION of the die's stage frame, which is why those
// frames are pinned in dies.js. The original uploaded File objects and custom
// font files live in host component state, never here — this is what gets
// serialized on submit.
//
// v1.11.0: two document shapes, by the die's kind.
//
//   koozie   schemaVersion 3: { size, color, patternId, elements }, unchanged.
//   others   schemaVersion 4 (a hat): { kind, dieId, parts, zones, elements }
//            parts = { <partId>: <colour> }        each part's own colour
//            zones = { <zoneId>: { method, threads?, shape?, ground? } }
//                    how each decorated spot is made: the method (one of the
//                    die zone's `methods`), the thread ids, a label's shape
//                    ("tall" | "square") and its ground colour
//            elements are the shape above, x/y fractions of the die's frame.
//   A colour (a part's, a ground) is a hex `#RRGGBB` or the host's own
//   palette id: the package checks its shape, the host checks its palette.

import { DIES, dieGeometry, resolveDie } from "./dies.js";
import { faceAt, faceRegions, zoneOfElement } from "./confine.js";
import { areaHome, confinePose } from "./region.js";

// 3 added `size`. Documents written before it default to the standard die on
// read, so the bump is informational rather than a branch point.
//
// NOT bumped to 4 by the extraction, deliberately. `size` still carries the
// legacy id and the shape is byte-identical, because one behaviour-preserving
// move is easier to verify than a move plus a schema migration. Renaming it to
// `dieId` is a separate, deliberate change — and note that
// Reel48-Storefront/docs/REMOTE_ADMIN.md publishes `designSpec.size` as the
// contract data.reel48.com consumes, so both must be emitted for at least one
// release when that happens.
export const DESIGN_SCHEMA_VERSION = 3;

/**
 * The schema of a document on any die that is not a koozie (v1.11.0).
 *
 * `legacySizeId` maps every die that is not the slim koozie to "standard", so
 * a hat written as version 3 would read back as a standard can cooler: a wrong
 * product, made at full cost. Version 4 names its die (`dieId`) and its kind
 * and drops `size`, `color` and `patternId`, which a hat does not have. Koozies
 * keep writing version 3, with `size`, because data.reel48.com and stored
 * orders read it (see the note above).
 */
export const ZONED_SCHEMA_VERSION = 4;

/** The colour a design starts on. In `designJson`, so it lives here. */
export const DEFAULT_COLOR = "#1C2E4A";

/** The text element a new text starts as. Also in `designJson`. */
export const DEFAULT_TEXT = {
  text: "Your text",
  fontFamily: "Arial, sans-serif",
  fontStyle: "normal", // "normal" | "bold" | "italic" | "bold italic"
  fill: "#FFFFFF",
  align: "center",
  fontScale: 0.07, // fraction of stage width
};

/**
 * The die id as `designJson` spells it.
 *
 * The package keys dies as `koozie-standard`; stored documents say `standard`.
 * This is the compat shim, and it is the ONLY place the two vocabularies meet —
 * so when schemaVersion 4 introduces `dieId`, this function is what changes.
 */
function legacySizeId(die) {
  return die.id === "koozie-slim" ? "slim" : "standard";
}

/** Whether `state` is a version 4 document (v1.11.0): one that names its die. */
function isZoned(state) {
  return typeof state?.dieId === "string";
}

/**
 * The die a design is drawn on (v1.11.0): its legacy `size` for version 3,
 * through `resolveDie`'s koozie fallback, as ever.
 *
 * A version 4 document THROWS unless its `dieId` is a die of its `kind`: one
 * written against a hat this build does not have must not open on a can
 * cooler's frame, which is the silent wrong product `resolveDie` exists to
 * refuse. A host checks a stored document with `resolveDie(id, { kind })`
 * before it loads it.
 */
export function designDie(state) {
  if (!isZoned(state)) return resolveDie(state?.size);
  if (typeof state.kind !== "string" || !state.kind) {
    throw new Error(`Design on die ${JSON.stringify(state.dieId)} names no kind.`);
  }
  return resolveDie(state.dieId, { kind: state.kind });
}

/**
 * A new, empty document on die `size`: a die id, or a koozie's legacy size.
 * A koozie (and anything unrecognised, which falls back to the standard
 * koozie) starts as version 3, exactly as before; any other die as version 4.
 */
export function initialDesignState(size) {
  const die = resolveDie(size ?? DIES["koozie-standard"].id);
  if (die.kind !== "koozie") {
    return {
      schemaVersion: ZONED_SCHEMA_VERSION,
      kind: die.kind,
      dieId: die.id,
      parts: {},
      zones: {},
      elements: [],
      selectedId: null,
    };
  }
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    // Seeded from ?size= so /products/custom-coozie-slim opens on the slim die.
    size: legacySizeId(die),
    color: DEFAULT_COLOR,
    patternId: null,
    elements: [],
    selectedId: null,
  };
}

let idCounter = 0;
export function nextElementId(prefix = "el") {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.round(performance.now())}`;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Optional placement on ADD_LOGO / ADD_TEXT (v1.5.0). The storefront's phone
// designer adds artwork while the stage is zoomed into one face of the die, so
// "the centre of the stage frame" (0.5, 0.5) is the middle of the base disc —
// off-screen, and somewhere artwork never goes. The host passes the centre of
// the face it is showing instead, and 180 for the back panel, which prints
// upside down unless rotated (see the `flipped` zone in dies.js).
//
// Only a finite number counts; anything else is the default, so an action
// without these keys builds exactly the element it always built. Positions are
// clamped like NUDGE_ELEMENT and DUPLICATE_ELEMENT, because they are fractions
// of the stage frame and nothing outside 0..1 is on it.
function placedPosition(value) {
  return Number.isFinite(value) ? clamp01(value) : 0.5;
}

function placedRotation(value) {
  return Number.isFinite(value) ? value : 0;
}

// Optional size on ADD_LOGO / ADD_TEXT (v1.11.0): `scale` / `fontScale`, as
// fractions of stage width like the element's own. A hat's atlas is about four
// spots wide, so v1.5.0's fixed 0.4 of the sheet is wider than a side spot.
// Only a finite positive number counts.
//
// VERSION 4 DOCUMENTS ONLY, like `fitToZone`. The storefront's can cooler
// designer already sends a `scale` on every add, which v1.10.0 ignored; a
// koozie add keeps ignoring it, so it builds the element it always built.
function placedSize(state, value) {
  return isZoned(state) && Number.isFinite(value) && value > 0 ? value : null;
}

/** A new element fills this share of its zone, each way, under `fitToZone`. */
const FIT_TO_ZONE = 0.8;

// The new text's box at fontScale 1, in stage widths: "Your text" in Arial is
// 4.002 em wide by its advance widths, and one line of Konva text is 1 em tall.
// Only `fitToZone` reads it; the stage measures the real box from then on.
const DEFAULT_TEXT_BOX = Object.freeze({ width: 4.002, height: 1 });

/**
 * `fitToZone` on ADD_LOGO / ADD_TEXT (v1.11.0): a zone id, or `true` for the
 * side the element is being placed on. The element is centred in that side
 * (where no x/y is given) and sized so its box, turned by its rotation, fills
 * FIT_TO_ZONE of it. Returns `{ x, y, size }` (the scale or fontScale), or
 * null for no fit: no `fitToZone`, or a side the die does not have.
 *
 * `box` is the element's width and height at size 1, in stage widths.
 * Version 4 documents only (see `placedSize`).
 *
 * v1.12.0: on an area side the piece goes to the area's home (`areaHome`) at
 * FIT_TO_ZONE of the CAP, not of the area (a whole panel is far bigger than
 * what prints). An explicit x/y or size is kept, and then the piece is
 * confined (region.js `confinePose`), so it lands inside the area and within
 * the cap wherever it was asked for. `confined` says the x/y are final.
 */
function fitToZone(state, action, box, explicitSize = null) {
  const target = action.fitToZone;
  if (!target || !isZoned(state)) return null;
  const die = designDie(state);
  const geom = dieGeometry(die);
  const regions = faceRegions(geom);
  const { width: W, height: H } = die.stage;
  const id =
    target === true
      ? faceAt(geom, die.stage, { x: placedPosition(action.x), y: placedPosition(action.y) })
      : target;
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(regions, id)) return null;
  const region = regions[id];
  const a = (placedRotation(action.rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const bw = (box.width * cos + box.height * sin) * W;
  const bh = (box.width * sin + box.height * cos) * W;
  if (region.kind === "area") {
    const room = region.cap ?? { w: region.x1 - region.x0, h: region.y1 - region.y0 };
    const size = explicitSize ?? FIT_TO_ZONE * Math.min(room.w / bw, room.h / bh);
    if (!(size > 0) || !Number.isFinite(size)) return null;
    const [hx, hy] = areaHome(region.area);
    const pose = {
      cx: Number.isFinite(action.x) ? clamp01(action.x) * W : hx,
      cy: Number.isFinite(action.y) ? clamp01(action.y) * H : hy,
      w: box.width * W * size,
      h: box.height * W * size,
      rotation: placedRotation(action.rotation),
    };
    const r = confinePose(pose, { area: region.area, cap: region.cap });
    return { x: r.cx / W, y: r.cy / H, size: size * r.scale, confined: true };
  }
  let size;
  let cx;
  let cy;
  if (region.kind === "circle") {
    size = (FIT_TO_ZONE * 2 * region.r) / Math.hypot(bw, bh);
    cx = region.cx;
    cy = region.cy;
  } else {
    size = FIT_TO_ZONE * Math.min((region.x1 - region.x0) / bw, (region.y1 - region.y0) / bh);
    cx = (region.x0 + region.x1) / 2;
    cy = (region.y0 + region.y1) / 2;
  }
  if (!(size > 0) || !Number.isFinite(size)) return null;
  return { x: cx / W, y: cy / H, size };
}

/** Where an added element goes on one axis: the action's, the fit's, or the centre. */
function placedOn(value, fit) {
  if (Number.isFinite(value)) return clamp01(value);
  return Number.isFinite(fit) ? clamp01(fit) : 0.5;
}

// ---- Version 4 values (v1.11.0) --------------------------------------------
// The reducer refuses (returns the same state for) anything that is not one of
// these, so junk never reaches a stored document or an undo step.

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const COLOUR_RE = /^(#[0-9A-Fa-f]{6}|[A-Za-z0-9][A-Za-z0-9_-]{0,47})$/;
const SHAPES = new Set(["tall", "square"]);

const isId = (v) => typeof v === "string" && ID_RE.test(v);
const isColour = (v) => typeof v === "string" && COLOUR_RE.test(v);
const isThreads = (v) => Array.isArray(v) && v.every(isId);
const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

/** A zone's decoration in its stored key order, or null if it is not valid for `zone`. */
function zoneDecoration(zone, d) {
  if (!zone.methods?.includes(d.method)) return null;
  if (d.threads !== undefined && !isThreads(d.threads)) return null;
  if (d.ground !== undefined && !isColour(d.ground)) return null;
  return {
    method: d.method,
    ...(d.threads !== undefined ? { threads: [...d.threads] } : {}),
    ...(zone.shape ? { shape: zone.shape } : {}),
    ...(d.ground !== undefined ? { ground: d.ground } : {}),
  };
}

function sameDecoration(a, b) {
  if (!a || !b) return a === b;
  const ta = a.threads;
  const tb = b.threads;
  const sameThreads =
    ta === tb || (Array.isArray(ta) && Array.isArray(tb) && ta.length === tb.length && ta.every((t, i) => t === tb[i]));
  return a.method === b.method && a.shape === b.shape && a.ground === b.ground && sameThreads;
}

/**
 * SET_ZONE (v1.11.0): how one spot is made. Merges `method`, `threads` and
 * `ground` into the zone's decoration (`null` takes one off; `method: null`
 * takes the whole spot off), and refuses a method the die zone does not list.
 * A zone that lists one method takes it without being told.
 *
 * Zones with a `shape` are one spot in different shapes (the inside label),
 * one at a time. `shape` names the shape wanted, or `zone` names it directly;
 * either way the other shapes' decorations go, the spot's settings carry over,
 * and their artwork moves across (`moveToZone`). All of it is ONE undo step.
 */
function setZone(state, action) {
  if (!isZoned(state)) return state;
  const die = designDie(state);
  const geom = dieGeometry(die);
  let zone = geom.zones.find((z) => z.id === action.zone);
  if (!zone) return state;
  if (action.shape !== undefined) {
    if (!zone.shape || !SHAPES.has(action.shape)) return state;
    zone = geom.zones.find((z) => z.shape === action.shape);
    if (!zone) return state;
  }
  const siblings = zone.shape ? geom.zones.filter((z) => z.shape && z.id !== zone.id) : [];
  const zones = { ...state.zones };

  if (action.method === null) {
    let changed = false;
    for (const z of [zone, ...siblings]) {
      if (hasOwn(zones, z.id)) {
        delete zones[z.id];
        changed = true;
      }
    }
    return changed ? { ...state, zones } : state;
  }

  const carried = siblings.find((z) => hasOwn(zones, z.id));
  const prev = hasOwn(zones, zone.id) ? zones[zone.id] : carried ? zones[carried.id] : {};
  const merged = { ...prev };
  for (const key of ["method", "threads", "ground"]) {
    if (action[key] === undefined) continue;
    if (action[key] === null) delete merged[key];
    else merged[key] = action[key];
  }
  // A zone with one method has no choice to make, so it needs none named: a
  // label switching shape before it has any settings still moves its art.
  if (merged.method === undefined && zone.methods.length === 1) merged.method = zone.methods[0];
  const next = zoneDecoration(zone, merged);
  if (!next) return state;

  for (const z of siblings) delete zones[z.id];
  zones[zone.id] = next;
  let moved = state;
  for (const z of siblings) moved = moveToZone(moved, z.id, zone.id);

  const unchanged =
    moved === state &&
    sameDecoration(state.zones?.[zone.id], next) &&
    siblings.every((z) => !hasOwn(state.zones, z.id));
  return unchanged ? state : { ...moved, zones };
}

/**
 * Move every element on side `from` to side `to` (v1.11.0), as one similarity
 * about the two sides' centres: each element keeps its place relative to its
 * side's centre and its rotation, and the whole composition is shrunk (never
 * grown) by the factor that fits `from`'s size inside `to`. Artwork that fitted
 * its old side fits its new one. A trim to `from` becomes a trim to `to`.
 *
 * The inside label's two shapes share one centre on the hat, which is what
 * makes this the right move when the label switches shape. A version 4
 * document and rect or area sides only (a koozie's back panel is turned over,
 * which a similarity does not do); anything else, or nothing to move, returns
 * `state` itself.
 *
 * v1.12.0: an area side is measured by its CAP about its home, not by its
 * whole area, and art moved onto one is then confined to it (region.js): a
 * logo by its box, text by its centre (its width needs font metrics; the
 * stage's `measureElement` has it).
 */
export function moveToZone(state, from, to) {
  if (!isZoned(state) || from === to) return state;
  const die = designDie(state);
  const geom = dieGeometry(die);
  const regions = faceRegions(geom);
  const a = sideFrame(hasOwn(regions, from) ? regions[from] : null);
  const b = sideFrame(hasOwn(regions, to) ? regions[to] : null);
  if (!a || !b) return state;
  const { width: W, height: H } = die.stage;
  const k = Math.min(1, b.w / a.w, b.h / a.h);
  let moved = false;
  const elements = state.elements.map((el) => {
    if (zoneOfElement(geom, die.stage, el) !== from) return el;
    moved = true;
    const next = {
      ...el,
      x: (b.cx + (el.x * W - a.cx) * k) / W,
      y: (b.cy + (el.y * H - a.cy) * k) / H,
    };
    if (el.type === "logo") next.scale = el.scale * k;
    else next.fontScale = el.fontScale * k;
    if (el.clip === from) next.clip = to;
    if (b.region.kind === "area") {
      const w = el.type === "logo" ? next.scale * W : 0;
      const h = el.type === "logo" ? w * (el.naturalHeight / el.naturalWidth || 1) : 0;
      const r = confinePose(
        { cx: next.x * W, cy: next.y * H, w, h, rotation: el.rotation || 0 },
        { area: b.region.area, cap: el.type === "logo" ? b.region.cap : null },
      );
      next.x = r.cx / W;
      next.y = r.cy / H;
      if (el.type === "logo") next.scale *= r.scale;
    }
    return next;
  });
  return moved ? { ...state, elements } : state;
}

/** A side as moveToZone measures it: centre and size, the rect's, or an area's home and cap. */
function sideFrame(region) {
  if (region?.kind === "rect") {
    return { region, cx: (region.x0 + region.x1) / 2, cy: (region.y0 + region.y1) / 2, w: region.x1 - region.x0, h: region.y1 - region.y0 };
  }
  if (region?.kind === "area") {
    const [cx, cy] = areaHome(region.area);
    const size = region.cap ?? { w: region.x1 - region.x0, h: region.y1 - region.y0 };
    return { region, cx, cy, w: size.w, h: size.h };
  }
  return null;
}

export function designReducer(state, action) {
  switch (action.type) {
    // A version 4 document has no ground colour or pattern (v1.11.0): a hat
    // is coloured part by part, with SET_PARTS and SET_PART_COLOR.
    case "SET_COLOR":
      return isZoned(state) ? state : { ...state, color: action.color };

    case "SET_PATTERN":
      return isZoned(state) ? state : { ...state, patternId: action.patternId };

    case "SET_SIZE": {
      // Positions are stage fractions and both koozie frames put the panels
      // across the same 80% of the width, so artwork carries over to the other
      // die without remapping. Undoable, like any other design change.
      //
      // That is a property of the KOOZIE pair, not a general one — a hat frame
      // shares no such relationship, which is why switching across kinds is not
      // something this action can express. v1.11.0 says so: a koozie document
      // refuses any die that is not a koozie (where v1.10 wrote "standard" for
      // a hat id), and a version 4 document refuses every switch.
      if (isZoned(state)) return state;
      const die = resolveDie(action.size);
      if (die.kind !== "koozie") return state;
      const size = legacySizeId(die);
      return size === state.size ? state : { ...state, size };
    }

    case "SET_PARTS": {
      // A preset (v1.11.0): every part's colour at once, replacing the last
      // set, as ONE undo step. Refused whole if any entry is not valid.
      if (!isZoned(state)) return state;
      const given = action.parts;
      if (!given || typeof given !== "object" || Array.isArray(given)) return state;
      const entries = Object.entries(given);
      if (!entries.every(([part, colour]) => isId(part) && isColour(colour))) return state;
      const before = Object.entries(state.parts ?? {});
      const same =
        before.length === entries.length && entries.every(([part, colour]) => state.parts[part] === colour);
      return same ? state : { ...state, parts: Object.fromEntries(entries) };
    }

    case "SET_PART_COLOR": {
      // One part's colour (v1.11.0); `color: null` takes it back off.
      if (!isZoned(state) || !isId(action.part)) return state;
      const parts = { ...state.parts };
      if (action.color === null) {
        if (!hasOwn(parts, action.part)) return state;
        delete parts[action.part];
        return { ...state, parts };
      }
      if (!isColour(action.color) || parts[action.part] === action.color) return state;
      parts[action.part] = action.color;
      return { ...state, parts };
    }

    case "SET_ZONE":
      return setZone(state, action);

    case "MOVE_TO_ZONE":
      return moveToZone(state, action.from, action.to);

    case "ADD_LOGO": {
      const aspect = action.naturalHeight / action.naturalWidth || 1;
      const fit = fitToZone(state, action, { width: 1, height: aspect }, placedSize(state, action.scale));
      const el = {
        id: action.id,
        type: "logo",
        fileName: action.fileName,
        mimeType: action.mimeType,
        naturalWidth: action.naturalWidth,
        naturalHeight: action.naturalHeight,
        x: fit?.confined ? fit.x : placedOn(action.x, fit?.x),
        y: fit?.confined ? fit.y : placedOn(action.y, fit?.y),
        scale: fit?.confined ? fit.size : placedSize(state, action.scale) ?? fit?.size ?? 0.4,
        rotation: placedRotation(action.rotation),
        opacity: 1,
        // Optional, and omitted entirely when absent rather than set to
        // undefined — `source: undefined` would serialize as a missing key in
        // JSON but compare unequal in a golden test, which is a confusing way to
        // discover an additive change.
        //
        // `{kind: "brand", assetId}` means the buyer picked this from their
        // saved brand library on account.reel48.com. That is worth recording
        // because it changes what production is told: an approved mark on file,
        // not a file someone attached to an order. It also survives a change of
        // storage, where a URL would not.
        //
        // The storefront passes nothing, so its documents are byte-identical to
        // before — which is what lets this be additive at schemaVersion 3.
        ...(action.source ? { source: action.source } : {}),
      };
      return { ...state, elements: [...state.elements, el], selectedId: el.id };
    }

    case "ADD_TEXT": {
      const fit = fitToZone(state, action, DEFAULT_TEXT_BOX, placedSize(state, action.fontScale));
      const fontScale = fit?.confined ? fit.size : placedSize(state, action.fontScale) ?? fit?.size;
      const el = {
        id: action.id,
        type: "text",
        ...DEFAULT_TEXT,
        // Spread over DEFAULT_TEXT's own key, so it keeps that key's place.
        ...(fontScale ? { fontScale } : {}),
        x: fit?.confined ? fit.x : placedOn(action.x, fit?.x),
        y: fit?.confined ? fit.y : placedOn(action.y, fit?.y),
        rotation: placedRotation(action.rotation),
        opacity: 1,
      };
      return { ...state, elements: [...state.elements, el], selectedId: el.id };
    }

    case "UPDATE_ELEMENT": {
      const { id, patch } = action;
      return {
        ...state,
        elements: state.elements.map((el) => {
          if (el.id !== id) return el;
          const next = { ...el, ...patch };
          // `clip: null` takes a trim off (v1.10.0). The key goes, rather than
          // staying as null, so a whole element is the shape it always was.
          if ("clip" in patch && !patch.clip) delete next.clip;
          return next;
        }),
      };
    }

    case "NUDGE_ELEMENT": {
      // Keyboard nudge. `dx` and `dy` are both FRACTIONS OF STAGE WIDTH, so one
      // step moves the same visual distance on either axis; the aspect
      // conversion for y happens here, against the die's pinned stage frame,
      // rather than in each host. Clamped like DUPLICATE_ELEMENT. Hosts pass a
      // `coalesceKey` per key-hold so a held arrow is one undo step.
      const { id, dx = 0, dy = 0 } = action;
      const el = state.elements.find((e) => e.id === id);
      if (!el || (dx === 0 && dy === 0)) return state;
      // v1.11.0: a version 4 document's frame is its `dieId`'s.
      const { stage } = designDie(state);
      const x = clamp01(el.x + dx);
      const y = clamp01(el.y + dy * (stage.width / stage.height));
      if (x === el.x && y === el.y) return state;
      return {
        ...state,
        elements: state.elements.map((e) => (e.id === id ? { ...e, x, y } : e)),
      };
    }

    case "DUPLICATE_ELEMENT": {
      // The source clone (logo file / objectURL) is the caller's problem; here
      // we clone the element data under a new id, nudged so it is visible.
      const src = state.elements.find((el) => el.id === action.id);
      if (!src) return state;
      const clone = {
        ...src,
        id: action.newId,
        x: clamp01(src.x + 0.06),
        y: clamp01(src.y + 0.06),
      };
      return { ...state, elements: [...state.elements, clone], selectedId: clone.id };
    }

    case "REORDER_ELEMENT": {
      const { id, direction } = action; // -1 back, +1 front
      const idx = state.elements.findIndex((el) => el.id === id);
      if (idx === -1) return state;
      const target = idx + direction;
      if (target < 0 || target >= state.elements.length) return state;
      const elements = [...state.elements];
      [elements[idx], elements[target]] = [elements[target], elements[idx]];
      return { ...state, elements };
    }

    case "DELETE_ELEMENT": {
      const elements = state.elements.filter((el) => el.id !== action.id);
      const selectedId = state.selectedId === action.id ? null : state.selectedId;
      return { ...state, elements, selectedId };
    }

    case "SELECT_ELEMENT":
      return { ...state, selectedId: action.id };

    case "CLEAR_SELECTION":
      return { ...state, selectedId: null };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Undo/redo. History = { past, present, future, lastCoalesceKey }.
//
// Design-mutating actions push `present` onto `past`; SELECTION changes mutate
// `present` in place, because "I clicked a different element" is not something
// anyone wants to undo.
//
// Actions may carry a `coalesceKey` — the opacity slider does — so a continuous
// gesture collapses into ONE undo step: the first action with a new key pushes
// history, repeats with the same key only replace `present`. Without it, dragging
// a slider once would cost fifty presses of undo to reverse.
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;
const SELECTION_ACTIONS = new Set(["SELECT_ELEMENT", "CLEAR_SELECTION"]);

export function initialHistoryState(size) {
  return { past: [], present: initialDesignState(size), future: [], lastCoalesceKey: null };
}

export function historyReducer(history, action) {
  if (action.type === "UNDO") {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      lastCoalesceKey: null,
    };
  }
  if (action.type === "REDO") {
    if (history.future.length === 0) return history;
    const [next, ...rest] = history.future;
    return {
      past: [...history.past, history.present],
      present: next,
      future: rest,
      lastCoalesceKey: null,
    };
  }

  const present = designReducer(history.present, action);
  // Identity comparison, not deep equality: designReducer returns the SAME
  // object for a no-op, which is what makes "did anything change?" free.
  if (present === history.present) return history;

  if (SELECTION_ACTIONS.has(action.type)) {
    return { ...history, present, lastCoalesceKey: null };
  }
  if (action.coalesceKey && action.coalesceKey === history.lastCoalesceKey) {
    return { ...history, present };
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    lastCoalesceKey: action.coalesceKey || null,
  };
}

/**
 * The serializable description sent to the server on submit.
 *
 * Drops transient UI state (`selectedId`) and nothing else. This shape is the
 * contract: `Reel48-Storefront/src/lib/coozie-spec.ts` formats it for
 * production, and data.reel48.com builds the supplier artwork zip from it.
 * Changing a field name here changes what a factory is told to print.
 */
export function toDesignDescription(state) {
  // v1.11.0: a version 4 document, for any die that is not a koozie. The same
  // elements; the die named instead of a legacy size; parts and zones instead
  // of one colour.
  if (isZoned(state)) {
    return {
      schemaVersion: state.schemaVersion,
      kind: state.kind,
      dieId: state.dieId,
      parts: { ...state.parts },
      zones: Object.fromEntries(
        Object.entries(state.zones ?? {}).map(([id, z]) => [
          id,
          {
            method: z.method,
            ...(z.threads !== undefined ? { threads: [...z.threads] } : {}),
            ...(z.shape !== undefined ? { shape: z.shape } : {}),
            ...(z.ground !== undefined ? { ground: z.ground } : {}),
          },
        ]),
      ),
      elements: state.elements.map(describeElement),
    };
  }
  return {
    schemaVersion: state.schemaVersion,
    size: state.size,
    color: state.color,
    patternId: state.patternId,
    elements: state.elements.map(describeElement),
  };
}

/** One element as both document versions serialize it. */
function describeElement(el) {
  const base = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    // v1.10.0, and only when set, so an untrimmed design serializes
    // byte-for-byte as before.
    ...(el.clip ? { clip: el.clip } : {}),
  };
  if (el.type === "logo") {
    return {
      ...base,
      fileName: el.fileName,
      mimeType: el.mimeType,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      scale: el.scale,
      ...(el.source ? { source: el.source } : {}),
    };
  }
  return {
    ...base,
    text: el.text,
    fontFamily: el.fontFamily,
    fontStyle: el.fontStyle,
    fill: el.fill,
    align: el.align,
    fontScale: el.fontScale,
  };
}
