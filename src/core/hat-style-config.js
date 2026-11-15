// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-style-config.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The hat designer's styles: what one hat style is to the designer, its 3D
// and its order, in one entry keyed by the style's product handle ("no-7"),
// so a second 3D style is one more entry here (and its files in
// hat-3d-assets.js), never a fork of the designer.
//
// ---------------------------------------------------------------------------
// S1 (2026-10-23) moved the No. 7's values here, unchanged, from where each
// reader kept its own copy: its parts and the colour step's rows
// (hat-config.js HAT_PARTS, HAT_PART_GROUPS), the parts that show another's
// colour (hat-look.js PART_FOLLOWS and NEVER_OWN), the part the strap tag's
// logo stands out from (hat-look.js TAG_LOGO), the part the sweatband
// follows (sweatband.js SWEATBAND_FOLLOWS), each spot's level (hat-config.js
// SPOT_LEVELS), the panel behind each spot (a ZONE_PART in both
// HatDesigner.jsx and HatStepForm.jsx), where the 3D turns for a colour row
// (HatStepForm.jsx GROUP_VIEW), each spot's area in words (hat-config.js
// SPOT_AREAS) and the fixed REEL48 mark the spec prints (hat-spec.ts).
//
// S2 (2026-10-24) adds the No. 6, from its model build's lab corrections
// (scripts/blender/hat-no6/lab/site_runtime.py SHIMS, one per field here)
// and Brayden's No. 6 decisions: the plastic snapback and its woven tag
// match the hat and are not the customer's to pick.
//
// Each reader asks for the style of the die it holds (hatStyleOf(die.id)):
// the server checks, describes and prices a document by its OWN die's style,
// as it already takes the product from that die, never from the page.
//
// It imports nothing, so the server, the client and the model labs can all
// read it. hat-look.js and sweatband.js, which the labs copy byte for byte
// and load on their own, import nothing of it either: they take a style's
// values as arguments, and their own constants (the No. 7's) are only what a
// caller that names none gets. tests/hat-style-config.test.ts holds them
// equal to the No. 7's entry here.
// ---------------------------------------------------------------------------

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
 * @typedef {{ id: string, label: string }} HatPart
 * @typedef {{ id: string, label: string, parts: string[] }} HatPartGroup
 * @typedef {{
 *   handle: string,
 *   label: string,
 *   dieIds: string[],
 *   currentDieId: string,
 *   parts: HatPart[],
 *   partGroups: HatPartGroup[],
 *   partFollows: Record<string, string>,
 *   neverOwn: string[],
 *   plasticParts: string[],
 *   sweatbandFollows: string,
 *   tagLogo: { follows: string },
 *   zonePart: Record<string, string>,
 *   groupView: Record<string, string>,
 *   spotLevels: Record<string, Record<string, number>>,
 *   spotHomes: Record<string, Record<string, [number, number]>>,
 *   spotAreas: Record<string, string>,
 *   fixedMarks: string[],
 *   path: string,
 *   draftKey: string,
 *   itemName: string,
 *   fileStem: string,
 *   frontName: string,
 * }} HatStyle
 */

/**
 * The No. 7: the unstructured 6-panel strap-back dad hat (hat-config.js
 * HAT_NO_7_DIE says what each of its dies is).
 *
 * @type {HatStyle}
 */
const NO_7 = {
  handle: "no-7",
  label: "No. 7",
  /**
   * Every die a stored No. 7 design may name, oldest first. New designs are
   * made on `currentDieId` (round E1's); the first die stays readable for the
   * orders, carts and old tabs that hold one (hat-config.js says how).
   */
  dieIds: ["hat-no-7", "hat-no-7-v2"],
  currentDieId: "hat-no-7-v2",
  /**
   * The fabric parts a customer can colour, by the id its GLB material
   * carries (`part_<id>`). Stitching and the inside tapes follow the panel
   * colour (Brayden, 2026-10-19); the strap tag's REEL48 logo is fixed.
   * Which of these colour separately and which move together is Brayden's to
   * say: until he does, each is its own part. The sweatband is a part of the
   * model and the order, but not the customer's to colour: it follows the
   * front panels (sweatbandFollows).
   */
  parts: [
    { id: "crown_FL", label: "Front left panel" },
    { id: "crown_FR", label: "Front right panel" },
    { id: "crown_LS", label: "Left side panel" },
    { id: "crown_RS", label: "Right side panel" },
    { id: "crown_LB", label: "Back left panel" },
    { id: "crown_RB", label: "Back right panel" },
    { id: "bill_top", label: "Bill, top" },
    { id: "bill_under", label: "Bill, underside" },
    { id: "button", label: "Button" },
    { id: "eyelet", label: "Eyelets" },
    { id: "binding", label: "Binding" },
    { id: "sweatband", label: "Sweatband" },
    { id: "strap", label: "Strap" },
    { id: "tape", label: "Inside tape" },
  ],
  /**
   * The colour step's "Build your own" rows, as the lab's L1 build showed them
   * to Brayden (hat-look.js PART_GROUPS): each row colours its parts together,
   * in one step. A design's `parts` stays keyed by part; the inside tape is
   * never coloured on its own, and the binding follows the back left panel
   * until it has its own colour (partFollows), so neither is a row. Nor is
   * the sweatband (2026-10-21): it follows the front panels, and every row
   * writes it again.
   */
  partGroups: [
    { id: "front", label: "Front panels", parts: ["crown_FL", "crown_FR"] },
    { id: "sideBack", label: "Side and back panels", parts: ["crown_LS", "crown_RS", "crown_LB", "crown_RB"] },
    { id: "billTop", label: "Bill top", parts: ["bill_top"] },
    { id: "billUnder", label: "Under the bill", parts: ["bill_under"] },
    { id: "button", label: "Button", parts: ["button"] },
    { id: "eyelets", label: "Eyelets", parts: ["eyelet"] },
    { id: "strap", label: "Strap", parts: ["strap"] },
  ],
  /**
   * Parts that show another part's colour on the 3D. The inside seam tapes
   * always do (Brayden, L0, 2026-10-19: no separate tape colour); the binding
   * round the strap opening is the panels' own fabric, so it does until it
   * has its own.
   */
  partFollows: { tape: "crown_LB", binding: "crown_LB" },
  /** Parts never shown in a colour of their own, whatever a design holds: they always follow. */
  neverOwn: ["tape"],
  /** Parts that are plastic, not fabric: no sheen tint. The No. 7 has none. */
  plasticParts: [],
  /**
   * The part the sweatband follows (sweatband.js says the rule): the front
   * panels, by the left one. The inside label's default ground is that band.
   */
  sweatbandFollows: "crown_FL",
  /** The REEL48 logo on the strap tag stands out from this part's colour (hat-look.js TAG_LOGO). */
  tagLogo: { follows: "strap" },
  /** The part each outside spot is sewn on, for the colour behind it; the front's is "the hat's colour". */
  zonePart: { front: "crown_FL", left: "crown_LS", right: "crown_RS", back: "crown_LB" },
  /** Where the 3D turns when a colour row is chosen: the spot nearest that part. */
  groupView: {
    front: "front",
    sideBack: "left",
    billTop: "front",
    billUnder: "front",
    button: "whole",
    eyelets: "left",
    strap: "back",
    sweatband: "label",
  },
  /**
   * Each spot's LEVEL, by die: the turn (degrees, clockwise as `rotation` is
   * stored) at which art runs parallel to the bottom of the hat. The designer
   * calls it 0°, a new piece starts there and Straighten goes back to it
   * (Brayden, 2026-10-22: "At 0 degrees, the angle of the side embroidery or
   * front embroidery should be in line with the angle of the bottom of the
   * hat"). A die's axes are level with the ground at each panel's centre
   * (12p_panels.py turns each chart upright there), and the No. 7 sits tipped
   * toward its bill, so a side panel's bottom edge runs down toward the front:
   * on round E1's die a line fitted to it, from the back seam to where it turns
   * up into the bill, is -7.2 degrees on the left and 7.9 on the right. The
   * front's bottom edge is level at the centre seam, and the back's strap and
   * the inside label's band are level, so they are 0. A die not listed is all
   * 0, the first No. 7's included, so its orders read as they were made.
   */
  spotLevels: { "hat-no-7-v2": { left: -7, right: 8 } },
  /**
   * Where a new logo lands on a spot, by die (die px, the piece's centre),
   * when it is not the area's own home (region.js areaHome). The No. 7 has
   * none: each lands at its area's home.
   */
  spotHomes: {},
  /**
   * Where a logo may go on each spot (round E1's areas), in a sentence's words:
   * the placing steps ("you can move it anywhere on the side panel"), the
   * page's facts and its markdown mirror all read these, so they never drift.
   */
  spotAreas: {
    front: "anywhere on the two front panels",
    left: "anywhere on the side panel",
    right: "anywhere on the side panel",
    back: "anywhere above the strap",
    label_tall: "anywhere on the label",
    label_square: "anywhere on the label",
  },
  /** The fixed marks every hat of the style is made with, as the spec's lines say them. */
  fixedMarks: ["REEL48 strap tab: standard"],
  /** The designer's page, its design links and Stripe's way back (design/hat/page.tsx). */
  path: "/design/hat",
  /**
   * The draft store's key on this device (hat-draft.js). The first die's id,
   * and it stays so: a draft saved on it is still found.
   */
  draftKey: "hat-no-7",
  /** The line's name in analytics' add_to_cart and begin_checkout: the product's title. */
  itemName: "Custom Hat No. 7",
  /** The downloaded pictures' names: `<stem>.png`, `<stem>-3d.png`. */
  fileStem: "reel48-no7-hat",
  /** What the sweatband follows, in a sentence ("to suit the front panels"). */
  frontName: "front panels",
};

/**
 * The No. 6: the structured 5-panel canvas cap with a plastic snapback
 * (Brayden signed its model off on 2026-10-24). One front panel and no
 * centre seam, two side and two back panels, eyelets on the sides and backs,
 * and a plastic snapback whose woven tag carries the REEL48 logo.
 *
 * @type {HatStyle}
 */
const NO_6 = {
  handle: "no-6",
  label: "No. 6",
  dieIds: ["hat-no-6"],
  currentDieId: "hat-no-6",
  /**
   * Its parts, by the id each GLB material carries. The snapback (`snap`,
   * plastic) and its woven tag (`snap_tag`) are parts of the model and the
   * order, but neither is the customer's to colour: both match the hat
   * (partFollows), as the inside tapes and the binding do. The sweatband
   * follows the front panel.
   */
  parts: [
    { id: "crown_F", label: "Front panel" },
    { id: "crown_LS", label: "Left side panel" },
    { id: "crown_RS", label: "Right side panel" },
    { id: "crown_LB", label: "Back left panel" },
    { id: "crown_RB", label: "Back right panel" },
    { id: "bill_top", label: "Bill, top" },
    { id: "bill_under", label: "Bill, underside" },
    { id: "button", label: "Button" },
    { id: "eyelet", label: "Eyelets" },
    { id: "binding", label: "Binding" },
    { id: "sweatband", label: "Sweatband" },
    { id: "tape", label: "Inside tape" },
    { id: "snap", label: "Snapback" },
    { id: "snap_tag", label: "Snapback tag" },
  ],
  /** The colour step's rows, as the No. 6 labs showed them: no strap, no snapback row. */
  partGroups: [
    { id: "front", label: "Front panel", parts: ["crown_F"] },
    { id: "sideBack", label: "Side and back panels", parts: ["crown_LS", "crown_RS", "crown_LB", "crown_RB"] },
    { id: "billTop", label: "Bill top", parts: ["bill_top"] },
    { id: "billUnder", label: "Under the bill", parts: ["bill_under"] },
    { id: "button", label: "Button", parts: ["button"] },
    { id: "eyelets", label: "Eyelets", parts: ["eyelet"] },
  ],
  /**
   * The inside tapes and the binding follow the back panels, as on the No. 7;
   * the snapback matches the hat (the back panels) and its tag the snapback
   * (Brayden, 2026-10-22).
   */
  partFollows: { tape: "crown_LB", binding: "crown_LB", snap: "crown_LB", snap_tag: "crown_LB" },
  neverOwn: ["tape", "binding", "snap", "snap_tag"],
  /** The snapback is plastic: shaded as it is, with no fabric sheen. */
  plasticParts: ["snap"],
  sweatbandFollows: "crown_F",
  /** The REEL48 logo is on the snapback's woven tag. */
  tagLogo: { follows: "snap_tag" },
  zonePart: { front: "crown_F", left: "crown_LS", right: "crown_RS", back: "crown_LB" },
  groupView: {
    front: "front",
    sideBack: "left",
    billTop: "front",
    billUnder: "front",
    button: "whole",
    eyelets: "left",
    sweatband: "label",
  },
  /**
   * Measured on the No. 6's production die the way #245 measured the
   * No. 7's: its side panels' bottom edges run -6 and +6 degrees (05z_zones,
   * re-measured through the GLB); the front, the back above the snapback and
   * the label are level.
   */
  spotLevels: { "hat-no-6": { left: -6, right: 6 } },
  /**
   * The No. 6's homes (zones_no6.json, each cap-sized home's centre): the
   * front centred on its flat face, each side low on its panel and the back
   * low and centred above the snapback (Brayden's No. 6 decisions: side
   * logos default low).
   */
  spotHomes: {
    "hat-no-6": {
      front: [809.37, 485.32],
      left: [2088.17, 1060.42],
      right: [2988.56, 1059.39],
      back: [738.49, 2103.92],
    },
  },
  spotAreas: {
    front: "anywhere on the flat front face",
    left: "anywhere on the whole side panel",
    right: "anywhere on the whole side panel",
    back: "anywhere above the snapback",
    label_tall: "anywhere on the label",
  },
  /**
   * The snapback's tag carries the REEL48 logo on every hat, and the plastic
   * is matched to the hat (partFollows), which the factory is told.
   */
  fixedMarks: ["REEL48 snapback tag: standard", "Snapback: plastic, matched to the back panels"],
  path: "/design/hat/no-6",
  draftKey: "hat-no-6",
  itemName: "Custom Hat No. 6",
  fileStem: "reel48-no6-hat",
  frontName: "front panel",
};

/** Every hat style the designer makes, by product handle. */
export const HAT_DESIGN_STYLES = /** @type {Readonly<Record<string, Readonly<HatStyle>>>} */ (
  deepFreeze({ [NO_7.handle]: NO_7, [NO_6.handle]: NO_6 })
);

/** The style every lookup falls back to. */
export const DEFAULT_HAT_STYLE = HAT_DESIGN_STYLES["no-7"];

const STYLE_OF_DIE = new Map(Object.values(HAT_DESIGN_STYLES).flatMap((s) => s.dieIds.map((id) => [id, s])));

/**
 * A style by its product handle or by the id of a die it owns, else the
 * default (the No. 7), so a reader never goes without one. The server
 * refuses a die it does not know before it asks (hat-config.js hatDie).
 *
 * @param {unknown} handleOrDieId
 * @returns {Readonly<HatStyle>}
 */
export function hatStyleOf(handleOrDieId) {
  if (typeof handleOrDieId !== "string") return DEFAULT_HAT_STYLE;
  if (Object.prototype.hasOwnProperty.call(HAT_DESIGN_STYLES, handleOrDieId)) return HAT_DESIGN_STYLES[handleOrDieId];
  return STYLE_OF_DIE.get(handleOrDieId) ?? DEFAULT_HAT_STYLE;
}

/**
 * The parts a style's rows colour: every part a customer chooses.
 *
 * @param {Readonly<HatStyle>} style
 * @returns {string[]}
 */
export function chosenPartsOf(style) {
  return style.partGroups.flatMap((g) => g.parts);
}
