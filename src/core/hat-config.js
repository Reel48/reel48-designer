// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-config.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The hat designer's configuration: the die each hat is designed on, and the
// spots on it a customer can decorate.
//
// ---------------------------------------------------------------------------
// THE DIE LIVES IN @reel48/designer/core (v1.11.0, `hats.js`): the one
// definition the canvas, the 3D model's print UVs and the hub all read,
// exactly as the can cooler's dies moved there (coozie-config.js says why).
// Until v1.11.0 the storefront carried a copy of the model build's
// `die_no7.json` here; it is now read from the package, in the shape the
// copy had, so every reader of it (hat-placements.ts, hat-spec.ts,
// hat-submit.ts) is unchanged. tests/hat-placements.test.ts pins the frame.
//
// THE FRAME IS PINNED once an order exists against it, as a can cooler's is:
// a resized rect relocates artwork on orders already placed. `reserved` holds
// rects for spots not offered yet, so adding one never moves the frame.
//
// TWO NO. 7 DIES since v1.12.0 (round E1, 2026-10-21, Brayden: "the
// whole-panel areas feel right. Go ahead with the designer package and the
// site."). New designs are made on `hat-no-7-v2` (HAT_NO_7_DIE): each spot's
// AREA (both front panels with the eyelets kept out, a whole side panel) round
// the same CAPS (maxImprint), on a 3720 x 1808 frame. Every design made before
// is on `hat-no-7` (HAT_NO_7_V1_DIE, `supersededBy: "hat-no-7-v2"`), which
// stays readable for the orders, carts and old tabs that hold one: the server
// checks and prices a document on its OWN die (hatDie(doc.dieId)), and the
// designer moves one onto v2 before it opens it (hat-draft.js, hat-migrate.js).
//
// THE NO. 6 since v1.13.0 (Brayden signed its model off on 2026-10-24):
// `hat-no-6` (HAT_NO_6_DIE), its own 3480 x 2336 frame. Which dies exist, and
// each style's parts, levels and homes, are hat-style-config.js's.
// ---------------------------------------------------------------------------

import { resolveDie } from "./dies.js";
import { DEFAULT_HAT_STYLE, HAT_DESIGN_STYLES, chosenPartsOf } from "./hat-style-config.js";
import { PMS_COLORS, pmsByHex, pmsById, pmsIdOf } from "./pms-palette.js";
import { withSweatband } from "./sweatband.js";

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} HatRect
 * @typedef {{ outline: number[][], holes: number[][][] }} HatPolygon
 * @typedef {{ id: string, kind: string, label: string, productHandle: string,
 *   status: string, supersededBy?: string, pxPerInch: number, stage: { width: number, height: number },
 *   zones: { id: string, label: string, rect: HatRect, area?: HatPolygon,
 *     maxImprint: { w: number, h: number }, methods: string[] }[],
 *   reserved: { id: string, label: string, rect: HatRect, maxImprint: { w: number, h: number } }[],
 *   gutterIn: number }} HatDieConfig
 */

/** A package hat die in the shape every storefront reader takes (hat-placements.ts HatDie), frozen. */
function storefrontDie(pkg) {
  const m = pkg.measurements;
  return /** @type {HatDieConfig} */ (
    deepFreeze({
      id: pkg.id,
      kind: pkg.kind,
      label: pkg.label,
      productHandle: pkg.productHandle,
      status: pkg.status,
      ...(pkg.supersededBy ? { supersededBy: pkg.supersededBy } : {}),
      pxPerInch: m.pxPerInch,
      stage: { ...pkg.stage },
      zones: m.zones.map((z) => ({
        id: z.id,
        label: z.label,
        rect: { ...z.rect },
        ...(z.area
          ? { area: { outline: z.area.outline.map((p) => [...p]), holes: (z.area.holes ?? []).map((h) => h.map((p) => [...p])) } }
          : {}),
        maxImprint: { ...z.maxImprint },
        methods: [...z.methods],
      })),
      reserved: m.reserved.map((r) => ({
        id: r.id,
        label: r.label,
        rect: { ...r.rect },
        maxImprint: { ...r.maxImprint },
      })),
      gutterIn: m.gutterIn,
    })
  );
}

/**
 * Every hat die a stored design may name, each style's (hat-style-config.js
 * dieIds): the current ones and the ones they superseded.
 */
export const HAT_DIES = /** @type {Readonly<Record<string, HatDieConfig>>} */ (
  Object.freeze(
    Object.fromEntries(
      Object.values(HAT_DESIGN_STYLES).flatMap((s) => s.dieIds.map((id) => [id, storefrontDie(resolveDie(id, { kind: "hat" }))])),
    ),
  )
);

/**
 * The first No. 7 die (`hat-no-7`), 1560 x 1296 at 200 px/in: each zone's
 * rect IS that spot's maximum imprint, bleed in the gutters between them, and
 * the inside label in two shapes (`label_tall`, `label_square`), one chosen at
 * a time. Superseded by HAT_NO_7_DIE: never offered for a new design, kept so
 * every design made on it is still read, priced and described as it was made.
 */
export const HAT_NO_7_V1_DIE = HAT_DIES["hat-no-7"];

/**
 * The No. 7 (the unstructured 6-panel strap-back dad hat) that new designs are
 * made on: round E1's `hat-no-7-v2`, 3720 x 1808 at 200 px/in. Each zone has
 * its AREA (`area`: where art may sit, die px, holes kept out: both front
 * panels round the eyelets, each whole side panel; the back and the label are
 * rects as polygons) and its CAP (`maxImprint`, the largest it prints:
 * 4.5 x 2.25 in front, 2 x 1.5 in sides, 2.5 x 0.875 in back, 1.75 x 1 in
 * label); `rect` is only the island's bounding box, bleed included. One
 * inside label, the rectangle. Its frame is the served 3D model's print UVs
 * (hat-3d-assets MODEL_FRAME). The REEL48 logo on the strap tag is fixed on
 * the model and is not on the die.
 *
 * `status` is the lab's: the areas are proposed until the physical fit test
 * confirms them.
 */
export const HAT_NO_7_DIE = HAT_DIES[HAT_DESIGN_STYLES["no-7"].currentDieId];

/**
 * The No. 6 (the structured 5-panel canvas cap with a plastic snapback):
 * `hat-no-6`, 3480 x 2336 at 200 px/in. Its front is the flat front face
 * below the top bend, each side its whole panel round an eyelet, the back
 * anywhere above the snapback round two, and one inside label, the
 * rectangle; the caps are the No. 7's. Its frame is its 3D model's print UVs.
 */
export const HAT_NO_6_DIE = HAT_DIES[HAT_DESIGN_STYLES["no-6"].currentDieId];

/**
 * A hat die by id, current or superseded, or null. Own keys only, so a posted
 * "constructor" is null. A die with `supersededBy` reads an old design; a new
 * one is made on HAT_NO_7_DIE.
 */
export function hatDie(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(HAT_DIES, id) ? HAT_DIES[id] : null;
}

/**
 * Each spot's LEVEL, by die (each style's spotLevels, hat-style-config.js
 * says what a level is): the turn at which art runs parallel to the bottom
 * of the hat. A die not listed is all 0.
 */
export const SPOT_LEVELS = /** @type {Readonly<Record<string, Readonly<Record<string, number>>>>} */ (
  Object.freeze(Object.assign({}, ...Object.values(HAT_DESIGN_STYLES).map((s) => s.spotLevels)))
);

/**
 * A spot's level on a die (SPOT_LEVELS), 0 for any other.
 *
 * @param {unknown} dieId
 * @param {unknown} zoneId
 * @returns {number}
 */
export function spotLevel(dieId, zoneId) {
  const levels = typeof dieId === "string" && Object.prototype.hasOwnProperty.call(SPOT_LEVELS, dieId) ? SPOT_LEVELS[dieId] : null;
  return levels && typeof zoneId === "string" && Object.prototype.hasOwnProperty.call(levels, zoneId) ? levels[zoneId] : 0;
}

/** Where a new piece lands on each spot, by die (each style's spotHomes), when not at its area's home. */
export const SPOT_HOMES = /** @type {Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>} */ (
  Object.freeze(Object.assign({}, ...Object.values(HAT_DESIGN_STYLES).map((s) => s.spotHomes)))
);

/**
 * Where a new piece lands on a spot of a die (die px, its centre), or null:
 * at the area's own home, as the designer package puts it.
 *
 * @param {unknown} dieId
 * @param {unknown} zoneId
 * @returns {readonly [number, number] | null}
 */
export function spotHome(dieId, zoneId) {
  const homes = typeof dieId === "string" && Object.prototype.hasOwnProperty.call(SPOT_HOMES, dieId) ? SPOT_HOMES[dieId] : null;
  return homes && typeof zoneId === "string" && Object.prototype.hasOwnProperty.call(homes, zoneId) ? homes[zoneId] : null;
}

/**
 * The spots on the outside of the hat, in the order the primary spot is
 * chosen from (Brayden, 2026-10-19): the front, or else the first of the
 * others that is used. The inside label is never the primary spot.
 */
export const OUTSIDE_ZONES = Object.freeze(["front", "left", "right", "back"]);

/**
 * The inside label's shapes, by zone. Only the rectangle is offered (Brayden,
 * 2026-10-21: "Inside labels are only the rectangle shape, they are never
 * square"), and it is the current die's one label. The first die's square is
 * in this map so a design made on it is still read and described; a design
 * opened again is moved to the current die, its square label's art onto the
 * rectangle (hat-draft.js, hat-migrate.js), and the server refuses a new one
 * from a tab opened before (hat-submit.ts).
 */
export const LABEL_SHAPES = Object.freeze({ label_tall: "tall", label_square: "square" });
/** The inside label's zone: the rectangle. */
export const LABEL_ZONE = "label_tall";
/** Zones no longer offered, that only a first-die design can name. */
export const RETIRED_ZONES = Object.freeze(["label_square"]);

/**
 * What each spot is called inside a sentence: on the cart line, the Stripe
 * description and the order emails ("2 more spots: left side, inside label").
 */
export const SPOT_NAMES = Object.freeze({
  front: "front",
  left: "left side",
  right: "right side",
  back: "back",
  label_tall: "inside label",
  label_square: "inside label",
});

/** Where a logo may go on each of the No. 7's spots, in words (its style's spotAreas). */
export const SPOT_AREAS = DEFAULT_HAT_STYLE.spotAreas;

/**
 * A spot as the page's facts say it, from its own die zone's cap and its
 * style's words: "Anywhere on the two front panels, up to 4.5 × 2.25 in";
 * the inside label "A 1.75 × 1 in rectangle".
 *
 * @param {{ id: string, maxImprint: { w: number, h: number } }} zone
 * @param {{ spotAreas: Readonly<Record<string, string>> }} [style]
 */
export function spotFact(zone, style = DEFAULT_HAT_STYLE) {
  const { w, h } = zone.maxImprint;
  if (zone.id in LABEL_SHAPES) return `A ${w} × ${h} in ${LABEL_SHAPES[zone.id] === "square" ? "square" : "rectangle"}`;
  // A JS caller's zones.map(spotFact) hands an index here: the default's words, as before styles.
  const where = (style?.spotAreas ?? DEFAULT_HAT_STYLE.spotAreas)[zone.id];
  return where ? `${where[0].toUpperCase()}${where.slice(1)}, up to ${w} × ${h} in` : `Up to ${w} × ${h} in`;
}

/**
 * The No. 7's parts and its colour step's rows (its style's parts and
 * partGroups, hat-style-config.js says what each is). A reader with a design
 * in hand takes them from the style of the design's die instead.
 */
export const HAT_PARTS = DEFAULT_HAT_STYLE.parts;
export const HAT_PART_GROUPS = DEFAULT_HAT_STYLE.partGroups;

/**
 * The fabric colours: every PANTONE Solid Coated colour the palette carries
 * (pms-palette.js, which says how a design stores one), each `{ id, code,
 * name, hex, ... }`. Every part but the sweatband is coloured from it.
 */
export const HAT_FABRIC_COLORS = PMS_COLORS;

/**
 * The quick picks: one Pantone colour on every part, by its code. Each is the
 * palette's nearest colour (CIEDE2000) to the lab's preset of the same name
 * (2026-10-22), every one a different code. For Brayden to confirm. A code
 * the palette does not carry is not shown, so a palette update can never show
 * a preset without its colour.
 */
const PRESET_CODES = [
  { id: "navy", label: "Navy", code: "PMS 533 C" }, // ΔE 0.00 from the lab's #1F2A44
  { id: "black", label: "Black", code: "PMS 419 C" }, // ΔE 3.79 from #1C1C1E
  { id: "white", label: "White", code: "PMS 9285 C" }, // ΔE 2.29 from #F1F0EB
  { id: "stone", label: "Stone", code: "PMS 4240 C" }, // ΔE 2.25 from #CBBE9E
  { id: "charcoal", label: "Charcoal", code: "PMS 10393 C" }, // ΔE 1.95 from #43474D
  { id: "red", label: "Red", code: "PMS 10416 C" }, // ΔE 0.98 from #A42A2E
  { id: "royal", label: "Royal", code: "PMS 10248 C" }, // ΔE 2.13 from #2A4BA0
  { id: "forest", label: "Forest", code: "PMS 553 C" }, // ΔE 2.72 from #25473A
];

/** The presets on offer: `{ id, label, hex, pms, code }`, `pms` the palette id. */
export const HAT_PRESETS = Object.freeze(
  PRESET_CODES.flatMap((p) => {
    const colour = p.code ? pmsById(pmsIdOf(p.code)) : null;
    return colour ? [Object.freeze({ id: p.id, label: p.label, hex: colour.hex, pms: colour.id, code: colour.code })] : [];
  }),
);
export const DEFAULT_PRESET_ID = "navy";

/** The parts the No. 7's rows colour: every part a customer chooses. */
export const CHOSEN_PARTS = Object.freeze(chosenPartsOf(DEFAULT_HAT_STYLE));

/**
 * Every part a style's rows colour in one preset's colour, as a design's
 * `parts`, with its sweatband.
 *
 * @param {string} id
 * @param {import("./hat-style-config.js").HatStyle} [style]
 */
export function presetParts(id, style = DEFAULT_HAT_STYLE) {
  const preset = HAT_PRESETS.find((p) => p.id === id) ?? HAT_PRESETS[0];
  return wholeHatParts(preset.hex, style);
}

/**
 * One colour on every part a style's customer chooses, with its sweatband.
 *
 * @param {string} hex
 * @param {import("./hat-style-config.js").HatStyle} [style]
 */
export function wholeHatParts(hex, style = DEFAULT_HAT_STYLE) {
  return withSweatband(Object.fromEntries(chosenPartsOf(style).map((part) => [part, hex])), style.sweatbandFollows);
}

/**
 * The preset a design's parts all match, or null for one built part by part.
 *
 * @param {Record<string, string> | undefined} parts
 * @param {import("./hat-style-config.js").HatStyle} [style]
 */
export function presetOf(parts, style = DEFAULT_HAT_STYLE) {
  const chosen = chosenPartsOf(style);
  return HAT_PRESETS.find((p) => chosen.every((id) => String(parts?.[id] ?? "").toLowerCase() === p.hex.toLowerCase()))?.id ?? null;
}

/**
 * How a part's colour is named to a person: "Navy, PMS Black 6 C" for a
 * preset, "PMS 2945 C" for any other palette colour, the hex for anything
 * else (an old design not yet moved onto the palette).
 */
export function fabricColourName(hex) {
  const colour = pmsByHex(hex);
  if (!colour) return typeof hex === "string" ? hex.toUpperCase() : "";
  const preset = HAT_PRESETS.find((p) => p.pms === colour.id);
  return preset ? `${preset.label}, ${colour.code}` : colour.code;
}

// ---------------------------------------------------------------------------
// PLACEHOLDERS (2026-10-20). Brayden has not supplied these yet:
//   - the thread chart and the most threads one spot takes.
// The list is null until he does, and null means "any #rrggbb colour": the
// server checks the shape of what it is sent and caps how much, and checks
// each value against the list once the list is filled in (hat-submit.ts).
// Nothing here invents a palette. The fabric colours are Pantone's
// (HAT_FABRIC_COLORS, above), and the label's ground is any colour by
// Brayden's word (below).
// ---------------------------------------------------------------------------

/** `[{ id, label, hex }]`, or null for any colour. */
export const HAT_THREAD_COLORS = null;
/**
 * The inside label's ground: any #rrggbb colour (Brayden, 2026-10-21:
 * "Clients can choose a hex color for the inside label as it's not tied to
 * the Pantone palette"). Null means any colour, as the lists above.
 */
export const LABEL_GROUND_COLORS = null;
/**
 * The off-white "Natural" ground. A label the customer picks no ground for is
 * woven on the sweatband's colour instead (sweatband.js labelGroundFor),
 * recorded on the order (hat-submit.ts) so the factory is told it.
 */
export const NATURAL_LABEL_GROUND = "#F1F0EB";
/**
 * The ground's quick swatches beside its free picker. The label step puts
 * "Same as the sweatband" (the default, no ground stored) before them, and
 * "Same as the hat" after.
 */
export const LABEL_GROUND_SWATCHES = Object.freeze([
  { id: "natural", label: "Natural", hex: NATURAL_LABEL_GROUND },
  { id: "white", label: "White", hex: "#FFFFFF" },
  { id: "black", label: "Black", hex: "#1C1C1E" },
]);
/** A ceiling on the threads one spot lists, until the real limit is known. */
export const MAX_THREADS_PER_SPOT = 15;
