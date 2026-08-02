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
//   logo:   + { fileName, mimeType, naturalWidth, naturalHeight, scale }
//             scale = logo width as a fraction of stage width
//   text:   + { text, fontFamily, fontStyle, fill, align, fontScale }
//             fontScale = font size as a fraction of stage width
//
// EVERY COORDINATE IS A FRACTION of the die's stage frame, which is why those
// frames are pinned in dies.js. The original uploaded File objects and custom
// font files live in host component state, never here — this is what gets
// serialized on submit.

import { DIES, resolveDie } from "./dies.js";

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

export function initialDesignState(size) {
  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    // Seeded from ?size= so /products/custom-coozie-slim opens on the slim die.
    size: legacySizeId(resolveDie(size ?? DIES["koozie-standard"].id)),
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

export function designReducer(state, action) {
  switch (action.type) {
    case "SET_COLOR":
      return { ...state, color: action.color };

    case "SET_PATTERN":
      return { ...state, patternId: action.patternId };

    case "SET_SIZE": {
      // Positions are stage fractions and both koozie frames put the panels
      // across the same 80% of the width, so artwork carries over to the other
      // die without remapping. Undoable, like any other design change.
      //
      // That is a property of the KOOZIE pair, not a general one — a hat frame
      // shares no such relationship, which is why switching across kinds is not
      // something this action can express.
      const size = legacySizeId(resolveDie(action.size));
      return size === state.size ? state : { ...state, size };
    }

    case "ADD_LOGO": {
      const el = {
        id: action.id,
        type: "logo",
        fileName: action.fileName,
        mimeType: action.mimeType,
        naturalWidth: action.naturalWidth,
        naturalHeight: action.naturalHeight,
        x: 0.5,
        y: 0.5,
        scale: 0.4,
        rotation: 0,
        opacity: 1,
      };
      return { ...state, elements: [...state.elements, el], selectedId: el.id };
    }

    case "ADD_TEXT": {
      const el = {
        id: action.id,
        type: "text",
        ...DEFAULT_TEXT,
        x: 0.5,
        y: 0.5,
        rotation: 0,
        opacity: 1,
      };
      return { ...state, elements: [...state.elements, el], selectedId: el.id };
    }

    case "UPDATE_ELEMENT": {
      const { id, patch } = action;
      return {
        ...state,
        elements: state.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)),
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
  return {
    schemaVersion: state.schemaVersion,
    size: state.size,
    color: state.color,
    patternId: state.patternId,
    elements: state.elements.map((el) => {
      const base = {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        rotation: el.rotation,
        opacity: el.opacity,
      };
      if (el.type === "logo") {
        return {
          ...base,
          fileName: el.fileName,
          mimeType: el.mimeType,
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          scale: el.scale,
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
    }),
  };
}
