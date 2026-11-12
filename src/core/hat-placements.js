// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-placements.ts (origin/main d78d90ee), TypeScript as JSDoc. Comments are the storefront's; imports point into this package.
//
/**
 * Which spots a hat design uses, which of them is the primary one, and how
 * many extra spots that is: the numbers a hat line is priced from.
 *
 * Worked out from the design's ELEMENTS on the server, every time, and never
 * read from anything the browser posted alongside them: a stamped spot count
 * would let a forged request buy three spots for the price of one, and a cart
 * resumed from a reminder email (cart/resume) re-adds its lines from the
 * stored document alone.
 *
 * The rules (Brayden, 2026-10-19 and 10-20):
 *   - An element belongs to the spot its centre is in, or else the nearest
 *     spot (a logo nudged into a gutter is still that spot's), the same rule
 *     as the designer's `nearestZone`.
 *   - A spot is used when it holds a logo or a line of text that is more than
 *     spaces (hasPrintableArtwork).
 *   - The primary spot is the front, or else the first used of the left
 *     side, the right side and the back. It is priced by the product's
 *     ladder for its method, as a catalog hat's decoration is.
 *   - Every other used spot is one extra spot, the inside label included,
 *     each one charge from the side-embroidery ladder: "it might say side
 *     embroidery, but it is all the same thing".
 *   - The REEL48 logo on the strap tag is fixed on the model, not on the die,
 *     so it never counts.
 *
 * Two limits per spot (Brayden, 2026-10-21, round E1): its AREA, where art may
 * sit (`zone.area` on a die that has one: both front panels as one region with
 * the eyelets kept out, a whole side panel; else `zone.rect`, which on the
 * first No. 7 die IS the max imprint), and its CAP, the largest logo it prints
 * (`maxImprint`, unchanged in E1). "The spot its centre is in" is the spot
 * whose area holds the centre, and "nearest" is the distance to an area, so a
 * die without areas reads exactly as it did. On a die with areas, a logo whose
 * turned box overhangs its area or is past its cap is refused (hatSpotProblem),
 * measured with hat-confine's `overhang`, the rule the designer confines art
 * by. A design on a die without areas (the first No. 7 die, superseded) is
 * never refused for it: the designer it was made in confined its on-canvas
 * handles but not its Rotate and size buttons, so its carts, its quantity
 * changes and a tab opened before E1 are taken as that designer made them
 * (hat-spec.ts flags a logo bigger than its spot's max imprint for the team).
 *
 * Plain module, like design-lines.ts: the cart, the Stripe description, the
 * emails and the admin screen all read it.
 */
import { areaRings, confinePose, overhang, pointInArea, poseValid } from "./region.js";
import { decorationLabel } from "./decorations.js";
import { designKindOf, hasPrintableArtwork } from "./design-lines.js";
import { hatDie, OUTSIDE_ZONES, SPOT_NAMES } from "./hat-config.js";

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ outline: number[][], holes?: number[][][] }} HatPolygon
 *   A polygon area: one closed outline and its keep-outs, die px, y down.
 * @typedef {Rect | HatPolygon} HatArea
 *   Where art may sit on a spot: a rect, or a polygon with keep-outs (region.js's Area).
 * @typedef {{
 *   id: string,
 *   label: string,
 *   rect: Rect,
 *   area?: HatArea,
 *   maxImprint: { w: number, h: number },
 *   methods: readonly string[],
 * }} HatZone
 *   `rect`: the spot's island on the die, its max imprint on a die without
 *   areas, else the overlay's bounds. `area`: where art may sit, when it is not
 *   the rect (E1: the whole panels).
 * @typedef {{
 *   id: string,
 *   kind: string,
 *   label: string,
 *   productHandle: string,
 *   pxPerInch: number,
 *   stage: { width: number, height: number },
 *   zones: readonly HatZone[],
 *   reserved?: readonly { id: string, rect: Rect }[],
 *   gutterIn?: number,
 * }} HatDie
 *   `reserved`: rects kept free for spots not offered yet (nothing is printed
 *   there). `gutterIn`: the least space between two spots, in inches.
 * @typedef {(id: unknown) => HatDie | null} HatDieOf
 *   A die by its id: hat-config's `hatDie`, or a host's own (a die not in hat-config yet).
 * @typedef {{ zone: string, method: string, primary: boolean }} HatPlacement
 * @typedef {{ id: string | null, zone: string, overhang: number, overCap: number }} HatMisfit
 *   A logo that breaks its spot's limits: die px past the area, the fraction over the cap.
 * @typedef {{
 *   die: HatDie,
 *   placements: HatPlacement[],
 *   primary: HatPlacement | null,
 *   extraSpots: number,
 *   stray: number,
 *   misfits: HatMisfit[],
 * }} HatSpots
 *   `placements`: the used spots, in the die's order. `extraSpots`: used spots
 *   after the primary one; every used spot when there is none. `stray`:
 *   printable elements with no spot of their own (strayElement). `misfits`:
 *   logos past their spot's area or cap, beyond float noise (MISFIT_PX,
 *   MISFIT_CAP); only on spots with an `area`.
 */

/** A logo may lie this many die px past its area before it is refused: float noise, a host rounding. */
export const MISFIT_PX = 0.5;
/** A logo may be this fraction over its cap before it is refused. */
export const MISFIT_CAP = 0.005;

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** @type {(v: unknown) => v is number} */
const finite = (v) => typeof v === "number" && Number.isFinite(v);

// ---- A spot's two limits, and a piece's pose ------------------------------------------

/**
 * Where art may sit on a spot: its `area`, else its `rect`. The zone's own
 * object, never a copy: hat-confine reads a polygon once per outline array.
 */
/**
 * @param {HatZone} zone
 * @returns {HatArea}
 */
export function zoneArea(zone) {
  return zone.area ?? zone.rect;
}

/** The largest a spot prints, die px: its max imprint at the die's px/in. */
/**
 * @param {HatZone} zone
 * @param {HatDie} die
 * @returns {{ w: number, h: number }}
 */
export function zoneCap(zone, die) {
  return { w: zone.maxImprint.w * die.pxPerInch, h: zone.maxImprint.h * die.pxPerInch };
}

/**
 * @typedef {{ cx: number, cy: number, w: number, h: number, rotation: number }} HatPose
 *   A pose in die px: `w` x `h` the unturned size, `rotation` degrees (region.js's Pose).
 * @typedef {(el: Record<string, unknown>) => { w: number, h: number } | null | undefined} MeasureText
 *   A line of text's unturned box in die px at its own fontScale, when the host can measure it.
 */

/**
 * An element as a pose on `die`, or null when its centre is not a pair of
 * finite fractions of the stage.
 *
 * A logo's box is the stage's: `scale` of the stage's width wide, its natural
 * aspect tall (square when the natural size is missing, as the package's
 * ADD_LOGO reads it). Text has no size without its font's metrics, so it is a
 * point (held by its centre) unless `measure` gives its box.
 *
 * @param {unknown} el
 * @param {HatDie} die
 * @param {MeasureText} [measure]
 * @returns {HatPose | null}
 */
export function elementPose(el, die, measure) {
  if (!isObject(el) || !finite(el.x) || !finite(el.y)) return null;
  const W = die.stage.width;
  let w = 0;
  let h = 0;
  if (el.type === "logo") {
    if (finite(el.scale) && el.scale > 0) {
      const nw = el.naturalWidth;
      const nh = el.naturalHeight;
      w = el.scale * W;
      h = w * (finite(nw) && finite(nh) && nw > 0 && nh > 0 ? nh / nw : 1);
    }
  } else if (measure) {
    const box = measure(el);
    if (box && finite(box.w) && finite(box.h) && box.w >= 0 && box.h >= 0) {
      w = box.w;
      h = box.h;
    }
  }
  return { cx: el.x * W, cy: el.y * die.stage.height, w, h, rotation: finite(el.rotation) ? el.rotation : 0 };
}

/** @typedef {{ cx: number, cy: number, scale: number }} Fit confinePose's answer, as far as an element needs it. */

/**
 * `el` at `fit` (hat-confine's answer for `pose`, the element's own pose):
 * its centre moved on the axes that moved, and its size (a logo's `scale`, a
 * measured text's `fontScale`) times the shrink. The same object when neither
 * changed, so an unmoved piece keeps its stored fractions bit for bit.
 *
 * @template {Record<string, unknown>} T
 * @param {T} el
 * @param {HatPose} pose
 * @param {Fit} fit
 * @param {HatDie} die
 * @returns {T}
 */
export function placeElement(el, pose, fit, die) {
  const mx = fit.cx !== pose.cx;
  const my = fit.cy !== pose.cy;
  const shrunk = fit.scale < 1;
  if (!mx && !my && !shrunk) return el;
  /** @type {Record<string, unknown>} */
  const next = { ...el };
  if (mx) next.x = fit.cx / die.stage.width;
  if (my) next.y = fit.cy / die.stage.height;
  if (shrunk) {
    if (el.type === "logo" && finite(el.scale)) next.scale = el.scale * fit.scale;
    else if (finite(el.fontScale)) next.fontScale = el.fontScale * fit.scale;
  }
  return /** @type {T} */ (next);
}

/**
 * @typedef {{
 *   from?: { cx: number, cy: number } | [number, number] | null,
 *   slide?: boolean | "step",
 *   measure?: MeasureText,
 * }} ConfineOptions
 *   `from`: the last valid centre (a drag's last frame, a nudge's start): on a
 *   polygon the piece travels from there. `slide`: region.js's, true (a drag),
 *   "step" (a nudge), false.
 */

/**
 * `el` kept inside `zone`'s area and no bigger than its cap: hat-confine's
 * `confinePose` on its pose. Never grown. The same object when it already
 * keeps both, or when it has no pose.
 *
 * @template {Record<string, unknown>} T
 * @param {T} el
 * @param {HatZone} zone
 * @param {HatDie} die
 * @param {ConfineOptions} [options]
 * @returns {T}
 */
export function confineElement(el, zone, die, { from = null, slide = true, measure } = {}) {
  const pose = elementPose(el, die, measure);
  if (!pose) return el;
  const fit = confinePose(pose, { area: zoneArea(zone), cap: zoneCap(zone, die), from, slide });
  return placeElement(el, pose, fit, die);
}

/**
 * Whether `el` keeps both of `zone`'s limits as it stands (hat-confine's
 * `poseValid`): inside its area and within its cap. A piece with no pose
 * (no finite centre) does not.
 */
/**
 * @param {unknown} el
 * @param {HatZone} zone
 * @param {HatDie} die
 * @param {MeasureText} [measure]
 */
export function fitsSpot(el, zone, die, measure) {
  const pose = elementPose(el, die, measure);
  return !!pose && poseValid(pose, { area: zoneArea(zone), cap: zoneCap(zone, die) });
}

// ---- Which spot ----------------------------------------------------------------------

/** @type {(a: HatArea) => a is Rect} */
const isRect = (a) => !("outline" in a) || !Array.isArray(/** @type {HatPolygon} */ (a).outline);

/** The distance from (x, y) to the segment a-b. */
/** @param {number} x @param {number} y @param {number} ax @param {number} ay @param {number} bx @param {number} by */
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/**
 * How far (x, y) is from an area: 0 inside it, else the distance to its
 * nearest edge (a rect's sides, a polygon's outline or a keep-out's edge).
 */
/**
 * @param {HatArea} area
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function distanceToArea(area, x, y) {
  if (isRect(area)) {
    const { x: x0, y: y0, w, h } = area;
    return Math.hypot(Math.max(x0 - x, 0, x - (x0 + w)), Math.max(y0 - y, 0, y - (y0 + h)));
  }
  if (pointInArea(area, x, y)) return 0;
  let best = Infinity;
  for (const ring of areaRings(area)) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const d = segDist(x, y, a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The spot an element belongs to: the one whose area its centre is in, or
 * else the one whose area is nearest, ties going to the earlier spot. Null
 * when its centre is not a pair of finite fractions of the stage.
 */
/**
 * @param {unknown} el
 * @param {HatDie} die
 * @returns {HatZone | null}
 */
export function zoneOfElement(el, die) {
  if (!isObject(el)) return null;
  const { x: nx, y: ny } = el;
  if (!finite(nx) || !finite(ny)) return null;
  return zoneAtPoint(die, nx * die.stage.width, ny * die.stage.height);
}

/** The spot whose area holds die point (x, y), or the nearest; null with no spots. */
/**
 * @param {HatDie} die
 * @param {number} x
 * @param {number} y
 * @returns {HatZone | null}
 */
export function zoneAtPoint(die, x, y) {
  /** @type {HatZone | null} */
  let best = null;
  let bestD = Infinity;
  for (const z of die.zones) {
    const d = distanceToArea(zoneArea(z), x, y);
    if (d < bestD) {
      best = z;
      bestD = d;
    }
  }
  return best;
}

/** @type {(x: number, y: number, r: Rect) => boolean} */
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * Whether an element sits on no spot: its centre in a reserved rect (the
 * bill top, under the bill), or further than a gutter from every spot's area.
 * The nearest spot would otherwise claim it, and art placed under the bill
 * would be made as an inside label. The designer keeps art inside its spot,
 * so only a forged or broken document has one.
 */
/**
 * @param {unknown} el
 * @param {HatDie} die
 * @returns {boolean}
 */
export function strayElement(el, die) {
  const zone = zoneOfElement(el, die);
  if (!zone || !isObject(el)) return true;
  const x = /** @type {number} */ (el.x) * die.stage.width;
  const y = /** @type {number} */ (el.y) * die.stage.height;
  if ((die.reserved ?? []).some((r) => inRect(x, y, r.rect))) return true;
  return distanceToArea(zoneArea(zone), x, y) > (die.gutterIn ?? 0) * die.pxPerInch;
}

/**
 * Whether a logo breaks its spot's limits, and by how much: null when it
 * keeps both (to MISFIT_PX past the area and MISFIT_CAP over the cap), or is
 * not a logo with a size. Text is never refused here: the server cannot
 * measure it without its font, so it keeps the spec's "Check size" flag.
 */
/**
 * @param {unknown} el
 * @param {HatZone} zone
 * @param {HatDie} die
 * @returns {HatMisfit | null}
 */
export function logoMisfit(el, zone, die) {
  if (!isObject(el) || el.type !== "logo") return null;
  const pose = elementPose(el, die);
  if (!pose || !(pose.w > 0)) return null;
  const o = overhang(pose, { area: zoneArea(zone), cap: zoneCap(zone, die) });
  if (!(o.area > MISFIT_PX) && !(o.cap > MISFIT_CAP)) return null;
  return { id: typeof el.id === "string" ? el.id : null, zone: zone.id, overhang: o.area, overCap: o.cap };
}

/**
 * The spots a hat design document uses. Null for anything that is not a hat
 * design on a die this storefront knows. `dieOf` reads the document's
 * `dieId` (hat-config's `hatDie` unless a host passes its own).
 */
/**
 * @param {unknown} json
 * @param {HatDieOf} [dieOf]
 * @returns {HatSpots | null}
 */
export function hatPlacements(json, dieOf = /** @type {HatDieOf} */ (/** @type {unknown} */ (hatDie))) {
  if (designKindOf(json) !== "hat" || !isObject(json)) return null;
  const die = dieOf(json.dieId);
  if (!die) return null;

  /** @type {Set<string>} */
  const used = new Set();
  let stray = 0;
  /** @type {HatMisfit[]} */
  const misfits = [];
  for (const el of Array.isArray(json.elements) ? json.elements : []) {
    if (!hasPrintableArtwork([el])) continue;
    if (strayElement(el, die)) stray += 1;
    const zone = zoneOfElement(el, die);
    if (!zone) continue;
    used.add(zone.id);
    // Only a spot with an area (E1) is held to its limits; see the header.
    const misfit = zone.area ? logoMisfit(el, zone, die) : null;
    if (misfit) misfits.push(misfit);
  }

  const chosen = isObject(json.zones) ? json.zones : {};
  // The method the customer chose for the spot, or the spot's only one (a
  // side, the back and the label each have one).
  /** @type {(zone: HatZone) => string} */
  const methodOf = (zone) => {
    const entry = chosen[zone.id];
    const method = isObject(entry) ? entry.method : undefined;
    return typeof method === "string" ? method : zone.methods[0];
  };
  const primaryId = OUTSIDE_ZONES.find((id) => used.has(id)) ?? null;
  const placements = die.zones
    .filter((z) => used.has(z.id))
    .map((z) => ({ zone: z.id, method: methodOf(z), primary: z.id === primaryId }));
  const primary = placements.find((p) => p.primary) ?? null;
  return { die, placements, primary, extraSpots: primary ? placements.length - 1 : placements.length, stray, misfits };
}

/** @type {(zone: string) => string} */
const spotName = (zone) => SPOT_NAMES[/** @type {keyof typeof SPOT_NAMES} */ (zone)] ?? zone;

/**
 * Why these spots cannot be sold as this product, as a sentence for the
 * customer, or null when they can.
 *
 * Only the primary spot's method has to be one of the product's decorations
 * (its ladder prices the hat). Every other spot is checked against its own
 * spot's methods instead: the inside label is woven, which is no product's
 * decoration, and checking it against the product would refuse every label.
 *
 * An order needs one spot on the outside of the hat (assumed until Brayden
 * confirms, 2026-10-20), so a hat with only an inside label is refused.
 *
 * A logo past its spot's area or bigger than its cap is refused (2026-10-21)
 * on a die with areas: the designer keeps every logo inside both there, so
 * only a forged, broken or stale document has one, and it could not be made
 * as shown. A design on the first die has no misfits (hatPlacements).
 */
/**
 * @param {HatSpots} spots
 * @param {readonly string[]} decorationTypes
 * @returns {string | null}
 */
export function hatSpotProblem(spots, decorationTypes) {
  const { die, primary, placements, stray } = spots;
  if (stray > 0) return "Some of your artwork isn't on a spot we can print. Please move it onto the hat and try again.";
  const zoneById = new Map(die.zones.map((z) => [z.id, z]));
  const misfits = spots.misfits ?? [];
  const tooBig = misfits.find((m) => m.overCap > MISFIT_CAP);
  if (tooBig) {
    const name = spotName(tooBig.zone);
    const cap = zoneById.get(tooBig.zone)?.maxImprint;
    const most = cap ? ` The largest it takes is ${cap.w} × ${cap.h} in.` : "";
    return `Your logo on the ${name} is bigger than the ${name} can take.${most} Please make it smaller and try again.`;
  }
  const over = misfits[0];
  if (over) {
    return `Your logo on the ${spotName(over.zone)} runs past the edge of the area we can print. Please move it inside and try again.`;
  }
  if (!primary) return "Add your logo to the front, a side or the back of the hat.";
  for (const p of placements) {
    const zone = zoneById.get(p.zone);
    const offered = zone?.methods.includes(p.method) && (!p.primary || decorationTypes.includes(p.method));
    if (!offered) {
      return `${decorationLabel(p.method)} isn't offered on the ${spotName(p.zone)}. Please choose another method.`;
    }
  }
  if (placements.filter((p) => p.zone.startsWith("label_")).length > 1) {
    return "Choose one inside label shape, square or rectangle.";
  }
  return null;
}

/**
 * How a line's decoration reads, as two phrases every reader joins its own
 * way: `decoration` ("Embroidery", or "Embroidery front" on a hat design) and
 * `extra` ("side embroidery" on a catalog hat that has it, "2 more spots:
 * left side, inside label" on a hat design, or null).
 *
 * The one reader of the side-embroidery flag (2026-10-20). A hat design line
 * stores `sideEmbroidery: true` for ANY extra spot, so the flag alone would
 * call a back spot and a label "side embroidery" on the cart line, the Stripe
 * description, both order emails and the admin screen.
 */
/** @typedef {{ decoration: string, extra: string | null }} SpotSummary */

/**
 * @param {{ decorationType: string, sideEmbroidery: boolean, designJson?: unknown }} item
 * @returns {SpotSummary}
 */
export function spotSummary(item) {
  const spots = hatPlacements(item.designJson);
  if (spots?.primary) {
    const extras = spots.placements.filter((p) => !p.primary).map((p) => spotName(p.zone));
    return {
      decoration: `${decorationLabel(item.decorationType)} ${spotName(spots.primary.zone)}`,
      extra: extras.length ? `${extras.length} more spot${extras.length === 1 ? "" : "s"}: ${extras.join(", ")}` : null,
    };
  }
  return { decoration: decorationLabel(item.decorationType), extra: item.sideEmbroidery ? "side embroidery" : null };
}

/** `extra` as an item of its own in a " · " list: "Side embroidery". */
/** @param {SpotSummary} summary @returns {string | null} */
export function extraAsItem(summary) {
  return summary.extra ? summary.extra[0].toUpperCase() + summary.extra.slice(1) : null;
}

/** Both phrases as one: "Embroidery + side embroidery". */
/** @param {SpotSummary} summary @returns {string} */
export function spotLine(summary) {
  return summary.extra ? `${summary.decoration} + ${summary.extra}` : summary.decoration;
}
