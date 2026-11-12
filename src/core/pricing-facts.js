// What a design document is priced from: the product, its die, the can
// cooler's size, and a hat's primary method, extra spots and inside label.
//
// The facts are exactly the inputs the storefront prices a designed line from
// today (Reel48-Storefront origin/main d78d90ee):
//
//   - A hat (src/lib/server/hat-submit.ts parseHatDesignDoc, then
//     src/lib/server/cart.ts hatLineSpots and priceLine): the die names the
//     product; the primary spot's method picks the product's ladder
//     (calculateFullPrice's decorationType); every other used spot, the inside
//     label included, adds one charge from the side-embroidery ladder
//     (`sideSpots = spots.extraSpots`). Here the label is reported apart
//     (`label`), so `extraSpots + (label ? 1 : 0)` is the storefront's
//     `sideSpots`, and a pricer that charges the label (the hub's
//     LABEL_IS_CHARGED) charges what the storefront does.
//   - A can cooler (src/lib/server/coozie-quote.ts handleCoozieSubmit): the
//     size picks the product (each die is its own product); the magnet is the
//     decoration and is NOT in the document (a line option).
//
// It refuses (InvalidDesignError) everything those server-side parsers
// refuse, with the same sentence for the buyer, and more besides: a document
// whose schemaVersion, kind, die or can size it does not know is refused
// rather than read as a standard can cooler, as the storefront's resolveSize
// would. The spots are worked out from the ELEMENTS every time
// (hat-placements.js), never read from a stamped count.

import { designKindOf, hasPrintableArtwork } from "./design-lines.js";
import { element, MAX_SHARED_ELEMENTS } from "./design-element.js";
import { hatDie, LABEL_SHAPES, LABEL_ZONE, MAX_THREADS_PER_SPOT, RETIRED_ZONES } from "./hat-config.js";
import { hatPlacements, hatSpotProblem, zoneOfElement } from "./hat-placements.js";
import { hatStyleOf } from "./hat-style-config.js";
import { pmsByFormerHex, pmsByHex } from "./pms-palette.js";
import { labelGroundFor, withSweatband } from "./sweatband.js";

/**
 * A design document that cannot be priced. `message` is a sentence for the
 * buyer (the storefront's own, where it has one); `reason` is a short code for
 * logs and tests.
 */
export class InvalidDesignError extends Error {
  /**
   * @param {string} message
   * @param {string} reason
   */
  constructor(message, reason) {
    super(message);
    this.name = "InvalidDesignError";
    /** @type {string} */
    this.reason = reason;
  }
}

/**
 * @typedef {"hat-no-7" | "hat-no-6" | "can-cooler"} PricedProduct
 * @typedef {"embroidery" | "pvc_patch" | "silicon_patch" | "woven_patch"} PrimaryMethod
 * @typedef {{
 *   product: PricedProduct,
 *   dieId: string,
 *   size: "standard" | "slim" | null,
 *   primaryMethod: PrimaryMethod | null,
 *   extraSpots: number,
 *   label: boolean,
 * }} PricingFacts
 */

/** The storefront's ceiling on a posted design document (coozie-quote.ts MAX_DESIGN_BYTES), in UTF-16 units as it measures. */
export const MAX_DESIGN_BYTES = 256 * 1024;
/** The most logos a design may carry (coozie-quote.ts MAX_LOGOS). */
export const MAX_LOGOS = 5;
/**
 * The decorations a hat product offers, so its primary spot's method must be
 * one (storefront scripts/seed-catalog.mjs HAT_DECORATIONS, which seeds every
 * hat's `decorationTypes`; hatSpotProblem checks the primary against it).
 */
export const HAT_DECORATIONS = Object.freeze(["embroidery", "pvc_patch", "silicon_patch", "woven_patch"]);
/** A hat product handle (hat-style-config.js) as a priced product. */
const HAT_PRODUCTS = Object.freeze({ "no-7": "hat-no-7", "no-6": "hat-no-6" });
/** A can cooler size as its die. */
const CAN_COOLER_DIES = Object.freeze({ standard: "koozie-standard", slim: "koozie-slim" });

const HEX = /^#[0-9a-f]{6}$/i;
const UNREADABLE = "Your hat design couldn't be read. Please refresh and try again.";
const COLOUR_GONE = "One of your hat colours isn't one we offer. Please refresh the page and pick it again.";
const NOT_A_CAN_COOLER = "This design is not a can cooler design. Please open it in its own designer and try again.";
const CAN_UNREADABLE = "Your can cooler design couldn't be read. Please refresh and try again.";

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {string} message
 * @param {string} reason
 * @returns {never}
 */
function refuse(message, reason) {
  throw new InvalidDesignError(message, reason);
}

/**
 * A colour from a hat-config list: its id or its hex. While a list is a
 * placeholder (null, as the thread chart and the label grounds are), any
 * #rrggbb colour (hat-submit.ts colorIn).
 *
 * @param {readonly { id: string, hex: string }[] | null} list
 * @param {unknown} value
 */
function colorIn(list, value) {
  if (typeof value !== "string") return null;
  if (!list) return HEX.test(value) ? value : null;
  const hit = list.find((c) => c.id === value || c.hex.toLowerCase() === value.toLowerCase());
  return hit ? value : null;
}

/** @param {unknown} doc */
function serializedLength(doc) {
  try {
    return JSON.stringify(doc)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/**
 * The priced facts of a design document. Throws InvalidDesignError for
 * anything it cannot price: an unknown schemaVersion, kind, die, can size or
 * zone, a method a spot does not offer, artwork on no spot or past its spot,
 * a hat with nothing on its outside, a colour not on the palette, and every
 * other refusal of the storefront's hat-submit.ts and coozie-quote.ts.
 *
 * @param {unknown} doc a design document (toDesignDescription's), parsed
 * @returns {PricingFacts}
 */
export function pricingFacts(doc) {
  if (!isObject(doc)) refuse("Your design couldn't be read. Please refresh and try again.", "not_an_object");
  if (serializedLength(doc) > MAX_DESIGN_BYTES) {
    refuse("Your design is too large to submit. Please simplify it and try again.", "too_large");
  }
  const kind = designKindOf(doc);
  if (kind === "hat") return hatFacts(doc);
  if (kind === "koozie") return canCoolerFacts(doc);
  return refuse(NOT_A_CAN_COOLER, "unknown_kind");
}

/**
 * @param {Record<string, any>} doc
 * @returns {PricingFacts}
 */
function canCoolerFacts(doc) {
  if (doc.schemaVersion !== 3) refuse(CAN_UNREADABLE, "unknown_schema_version");
  // Each size is its own product at its own price, so a size this build does
  // not cut is refused, never priced as the standard can (resolveSize would).
  const size = typeof doc.size === "string" && Object.prototype.hasOwnProperty.call(CAN_COOLER_DIES, doc.size) ? doc.size : null;
  if (!size) refuse(CAN_UNREADABLE, "unknown_size");
  return {
    product: "can-cooler",
    dieId: CAN_COOLER_DIES[/** @type {"standard" | "slim"} */ (size)],
    size: /** @type {"standard" | "slim"} */ (size),
    primaryMethod: null,
    extraSpots: 0,
    label: false,
  };
}

/**
 * hat-submit.ts parseHatDesignDoc, then cart.ts hatLineSpots, on a parsed
 * document: the document rebuilt from the fields the designer writes, its
 * spots worked out again from the elements, and refused where the storefront
 * refuses it.
 *
 * @param {Record<string, any>} doc
 * @returns {PricingFacts}
 */
function hatFacts(doc) {
  if (doc.kind !== "hat") refuse(UNREADABLE, "unknown_kind");
  if (doc.schemaVersion !== 4) refuse(UNREADABLE, "unknown_schema_version");
  const die = hatDie(doc.dieId);
  if (!die) refuse("This hat isn't one we can make from the designer yet.", "unknown_die");
  const product = Object.prototype.hasOwnProperty.call(HAT_PRODUCTS, die.productHandle)
    ? HAT_PRODUCTS[/** @type {keyof typeof HAT_PRODUCTS} */ (die.productHandle)]
    : null;
  if (!product) refuse("This hat isn't one we can make from the designer yet.", "unknown_product");

  // Elements, rebuilt field by field as a shared design is (design-element.js).
  if (!Array.isArray(doc.elements) || doc.elements.length > MAX_SHARED_ELEMENTS) refuse(UNREADABLE, "elements");
  /** @type {Record<string, unknown>[]} */
  const elements = [];
  for (const el of doc.elements) {
    const clean = element(el);
    if (!clean) refuse(UNREADABLE, "element");
    elements.push(/** @type {Record<string, unknown>} */ (clean));
  }
  if (elements.filter((el) => el.type === "logo").length > MAX_LOGOS) refuse(UNREADABLE, "too_many_logos");

  // Part colours: a part of this die's style, in a Pantone colour. The
  // sweatband is worked out again from the front panels.
  const style = hatStyleOf(die.id);
  /** @type {Record<string, string>} */
  const chosen = {};
  const partIds = new Set(style.parts.map((p) => p.id));
  for (const [id, value] of Object.entries(isObject(doc.parts) ? doc.parts : {})) {
    if (!partIds.has(id)) refuse(COLOUR_GONE, "unknown_part");
    if (id === "sweatband") continue;
    const pms = pmsByHex(value) ?? pmsByFormerHex(value);
    if (!pms) refuse(COLOUR_GONE, "not_pantone");
    chosen[id] = pms.hex;
  }
  const parts = withSweatband(chosen, style.sweatbandFollows);

  // Each spot's choices: a spot on this die, and only the fields it can carry.
  /** @type {Record<string, Record<string, unknown>>} */
  const zones = {};
  const zoneIds = new Set(die.zones.map((z) => z.id));
  for (const [id, entry] of Object.entries(isObject(doc.zones) ? doc.zones : {})) {
    if (!zoneIds.has(id) || !isObject(entry)) refuse(UNREADABLE, "unknown_zone");
    const shape = /** @type {Record<string, string>} */ (LABEL_SHAPES)[id];
    /** @type {Record<string, unknown>} */
    const out = {};
    if (entry.method !== undefined) {
      if (typeof entry.method !== "string") refuse(UNREADABLE, "method");
      out.method = entry.method;
    }
    if (entry.threads !== undefined) {
      const threads = Array.isArray(entry.threads) ? entry.threads.map((t) => colorIn(null, t)) : null;
      if (!threads || threads.length > MAX_THREADS_PER_SPOT || threads.some((t) => !t)) {
        refuse("One of your thread colours isn't one we offer. Please pick it again.", "thread");
      }
      out.threads = threads;
    }
    if (entry.shape !== undefined) {
      if (!shape || entry.shape !== shape) refuse(UNREADABLE, "label_shape");
      out.shape = shape;
    }
    if (entry.ground !== undefined) {
      const ground = shape ? colorIn(null, entry.ground) : null;
      if (!ground) refuse("Your label colour isn't one we offer. Please pick it again.", "label_ground");
      out.ground = ground;
    }
    zones[id] = out;
  }

  // The inside label comes in one shape at a time (hat-submit.ts).
  const labelEntries = Object.keys(zones).filter((id) => id in LABEL_SHAPES);
  const labelsUsed = [
    ...new Set(
      elements
        .filter((el) => hasPrintableArtwork([el]))
        .map((el) => zoneOfElement(el, die)?.id)
        .filter((id) => Boolean(id && id in LABEL_SHAPES)),
    ),
  ];
  if (labelsUsed.some((id) => RETIRED_ZONES.includes(/** @type {string} */ (id)))) {
    refuse("Inside labels are a rectangle only now. Please refresh the page to move your label onto it.", "retired_label");
  }
  if (labelEntries.length === 1 && labelsUsed.length === 1 && labelsUsed[0] !== labelEntries[0]) {
    refuse("Some of your label artwork is on the label shape you didn't choose. Please move it and try again.", "label_mismatch");
  }
  for (const id of labelEntries) if (!labelsUsed.includes(id)) delete zones[id];
  if (labelsUsed.includes(LABEL_ZONE)) {
    const entry = zones[LABEL_ZONE] ?? {};
    zones[LABEL_ZONE] = {
      ...entry,
      method: entry.method ?? "woven_label",
      shape: /** @type {Record<string, string>} */ (LABEL_SHAPES)[LABEL_ZONE],
      ground: entry.ground ?? labelGroundFor(parts, style.sweatbandFollows),
    };
  }

  const design = { schemaVersion: 4, kind: "hat", dieId: die.id, parts, zones, elements };
  const spots = hatPlacements(design);
  if (!spots) refuse(UNREADABLE, "unreadable");
  // cart.ts hatLineSpots: the same refusals, with the product's decorations.
  const problem = hatSpotProblem(spots, HAT_DECORATIONS);
  if (problem) refuse(problem, "spots");
  const primary = spots.primary;
  if (!primary) refuse("Add your logo to the front, a side or the back of the hat.", "no_primary");

  const isLabel = (/** @type {string} */ zone) => zone in LABEL_SHAPES;
  const extras = spots.placements.filter((p) => !p.primary);
  return {
    product: /** @type {PricedProduct} */ (product),
    dieId: die.id,
    size: null,
    primaryMethod: /** @type {PrimaryMethod} */ (primary.method),
    extraSpots: extras.filter((p) => !isLabel(p.zone)).length,
    label: extras.some((p) => isLabel(p.zone)),
  };
}
