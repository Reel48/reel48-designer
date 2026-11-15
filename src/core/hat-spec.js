// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-spec.ts (origin/main d78d90ee), TypeScript as JSDoc. Comments are the storefront's; imports point into this package.
//
/**
 * A stored hat design document, as something a person can make the hat from:
 * the hat's die, each part's colour (with its Pantone code), each used spot
 * with its method, threads and (for the inside label) shape and ground, and
 * every piece of artwork with where it sits inside its spot, in inches.
 *
 * describeDesign (coozie-spec.ts) sends hat documents here, so the team
 * email, /admin/orders and the hub's `designSpec` all read one formatter, as
 * they do for a can cooler. The result is a CoozieSpec plus the hat's own
 * fields, so every reader that renders a can cooler's spec renders a hat's.
 *
 * `size` is NEVER null on a hat (2026-10-20). The hub's `dieFor` reads a null
 * size as a standard can, so a null here would lay a hat out on a can's die
 * without a word. `{ id: "hat-no-7" }` is a die it does not know yet, which it
 * says out loud.
 *
 * A piece's "Rotation" is from its spot's level (hat-config SPOT_LEVELS, since
 * 2026-10-22): 0° is parallel to the bottom of the hat, as it is made. On a
 * side panel that is not the die's own 0°, so "Rotation on die" gives the turn
 * the proof and the hub's spot crops show it at, and the zone its `level`.
 *
 * Oversize artwork is flagged ("Check size"), not refused: the server cannot
 * measure a line of text without its font, the free mockup comes before
 * anything is made, and a false refusal costs an order.
 *
 * Every measure is the document's OWN die (hatDie(doc.dieId)): a design made
 * on the first No. 7 die (hat-no-7, 1560 x 1296) is described on it, a design
 * made since round E1 (hat-no-7-v2, 3720 x 1808) on that, so an order placed
 * before E1 still reads as it was made. `frame` and each spot's `rect` say
 * which sheet the die px are on.
 */
import { FONT_OPTIONS } from "./coozie-config.js";
import { decorationLabel } from "./decorations.js";
import { hatDie, LABEL_SHAPES, NATURAL_LABEL_GROUND, SPOT_NAMES, spotLevel } from "./hat-config.js";
import { hatStyleOf } from "./hat-style-config.js";
import { pmsByHex } from "./pms-palette.js";
import { SWEATBANDS } from "./sweatband.js";
import { hatPlacements, zoneOfElement } from "./hat-placements.js";
import { areaHome } from "./region.js";

/**
 * @typedef {import("./coozie-spec.js").CoozieElementSpec} CoozieElementSpec
 * @typedef {import("./coozie-spec.js").CoozieSpec} CoozieSpec
 * @typedef {import("./hat-placements.js").HatDie} HatDie
 * @typedef {import("./hat-placements.js").HatPlacement} HatPlacement
 * @typedef {import("./hat-placements.js").HatZone} HatZone
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   rect: { x: number, y: number, w: number, h: number },
 *   maxImprint: { w: number, h: number },
 *   method: string,
 *   methodLabel: string,
 *   primary: boolean,
 *   threads: string[],
 *   shape?: string,
 *   ground?: string,
 *   level?: number,
 * }} HatZoneSpec
 *   `rect`: the spot's island on the die, in native stage pixels: its max
 *   imprint on the first No. 7 die; on round E1's, the bounding box of its area
 *   (both front panels, a whole side panel), bleed included. `maxImprint`: the
 *   most the spot can take, in inches (its cap). `shape` / `ground`: the inside
 *   label's shape and ground colour; only on a label spot. The ground is the
 *   default one the screen showed when none was chosen. `level`: the turn on
 *   the die, degrees clockwise, at which art runs parallel to the bottom of the
 *   hat (hat-config SPOT_LEVELS): only where it is not 0, the side panels. A
 *   piece's "Rotation" is counted from it.
 *
 * @typedef {{ id: string, label: string, color: string, pms?: string, band?: string }} HatPartSpec
 *   `color`: the colour as a hex, for a swatch. `pms`: its PANTONE Solid Coated
 *   code, "PMS 2945 C", when it is one (2026-10-21). `band`: on the sweatband of
 *   an order placed since the band followed the front panels (one with a
 *   `pantone` stamp): which band, "black", "heather grey" or "white". An older
 *   order's sweatband was the customer's own choice.
 *
 * @typedef {CoozieSpec & {
 *   kind: "hat",
 *   dieId: string,
 *   frame: { width: number, height: number, pxPerInch: number },
 *   zones: HatZoneSpec[],
 *   parts: HatPartSpec[],
 *   placements: HatPlacement[],
 *   extraSpots: number,
 *   pictureUrl: string | null,
 * }} HatSpec
 *   `frame`: the die's native frame, what every fraction and rect is measured
 *   in. `zones`: the used spots, in the die's order. `pictureUrl`: the design
 *   in 3D, when one was uploaded with it.
 */

const BAND_NAMES = new Map(Object.values(SWEATBANDS).map((b) => [b.hex.toLowerCase(), b.label.toLowerCase()]));

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** @param {unknown} v @returns {number | null} */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
/** @param {number} n */
const inches = (n) => `${n.toFixed(2)} in`;
/** Degrees to a tenth, -179.9 to 180. */
/** @param {number} n @returns {number} */
function turn(n) {
  const d = Math.round(((((n % 360) + 540) % 360) - 180) * 10) / 10;
  return d === -180 ? 180 : d || 0;
}
/** @param {number} n */
const degrees = (n) => `${turn(n)}°`;
/** A turn from a spot's level as the maker reads it: "0°, parallel to the bottom of the hat", "3° clockwise from …". */
/** @param {number} n @returns {string} */
function fromLevel(n) {
  const d = turn(n);
  if (d === 0) return "0°, parallel to the bottom of the hat";
  return `${Math.abs(d)}° ${d > 0 ? "clockwise" : "counter-clockwise"} from parallel to the bottom of the hat`;
}

/** @param {string | null} stack @returns {string} */
function fontLabel(stack) {
  if (!stack) return "—";
  const preset = FONT_OPTIONS.find((f) => f.value === stack);
  return preset ? preset.label : `${stack} (custom upload)`;
}

/** "0.30 in right", "0.45 in above": an offset from a point, by which way it goes (y down). */
/** @param {number} d @param {[string, string]} words @returns {string} */
function offsetFrom(d, [less, more]) {
  return `${inches(Math.abs(d))} ${d < -0.005 ? less : more}`;
}

/**
 * Where an element's centre sits inside its spot. On a spot that IS its rect
 * (the first No. 7 die), from the spot's top left, as every order before
 * round E1 reads. On a spot with an area (E1), whose rect is only the
 * island's bounds with bleed, a corner nobody can find on the hat: from the
 * spot's middle (hat-confine's areaHome, where a new logo lands; on the front,
 * on the centre seam), which is named with its die px so the hub can find it.
 */
/**
 * @param {Record<string, unknown>} el
 * @param {HatZone} zone
 * @param {HatDie} die
 */
function placeRows(el, zone, die) {
  const x = num(el.x);
  const y = num(el.y);
  if (x === null || y === null) return [{ label: "Centre in spot", value: "—" }];
  const onDie = { label: "Centre on die", value: `${Math.round(x * die.stage.width)}px, ${Math.round(y * die.stage.height)}px` };
  const home = zone.area ? areaHome(zone.area) : null;
  if (home) {
    const right = (x * die.stage.width - home[0]) / die.pxPerInch;
    const below = (y * die.stage.height - home[1]) / die.pxPerInch;
    const seam = zone.id === "front" ? "on the centre seam, " : "";
    return [
      { label: "Centre in spot", value: `${offsetFrom(right, ["left", "right"])} of and ${offsetFrom(below, ["above", "below"])} the spot's middle` },
      { label: "Spot's middle", value: `${seam}${Math.round(home[0])}px, ${Math.round(home[1])}px on the die` },
      onDie,
    ];
  }
  const across = (x * die.stage.width - zone.rect.x) / die.pxPerInch;
  const down = (y * die.stage.height - zone.rect.y) / die.pxPerInch;
  return [{ label: "Centre in spot", value: `${inches(across)} across, ${inches(down)} down` }, onDie];
}

/**
 * @param {number | null} w
 * @param {number | null} h
 * @param {HatZone} zone
 * @returns {{ label: string, value: string }[]}
 */
function checkSize(w, h, zone) {
  const over = (w !== null && w > zone.maxImprint.w + 0.005) || (h !== null && h > zone.maxImprint.h + 0.005);
  if (!over) return [];
  const size = [w, h].map((n) => (n === null ? "?" : n.toFixed(2))).join(" × ");
  return [
    {
      label: "Check size",
      value: `${size} in is past the ${SPOT_NAMES[/** @type {keyof typeof SPOT_NAMES} */ (zone.id)] ?? zone.id}'s ${zone.maxImprint.w} × ${zone.maxImprint.h} in`,
    },
  ];
}

/**
 * @param {Record<string, unknown>} el
 * @param {number} n
 * @param {HatZone} zone
 * @param {HatDie} die
 * @returns {CoozieElementSpec}
 */
function elementSpec(el, n, zone, die) {
  const spot = { label: "Spot", value: zone.label };
  const rotation = num(el.rotation) ?? 0;
  const level = spotLevel(die.id, zone.id);
  const common = [
    { label: "Rotation", value: level ? fromLevel(rotation - level) : degrees(rotation) },
    ...(level ? [{ label: "Rotation on die", value: degrees(rotation) }] : []),
    { label: "Opacity", value: String(num(el.opacity) ?? 1) },
  ];
  if (el.type === "logo") {
    const scale = num(el.scale);
    const nw = num(el.naturalWidth);
    const nh = num(el.naturalHeight);
    const w = scale === null ? null : (scale * die.stage.width) / die.pxPerInch;
    const h = w !== null && nw && nh ? (w * nh) / nw : null;
    return {
      kind: "logo",
      title: `Logo ${n}`,
      rows: [
        spot,
        { label: "File", value: str(el.fileName) ?? "(unnamed)" },
        { label: "Type", value: str(el.mimeType) ?? "—" },
        { label: "Source size", value: nw !== null && nh !== null ? `${nw}×${nh}px` : "—" },
        { label: "Placed size", value: w === null ? "—" : h === null ? `${inches(w)} wide` : `${inches(w)} × ${inches(h)}` },
        ...placeRows(el, zone, die),
        ...common,
        ...checkSize(w, h, zone),
      ],
    };
  }
  const fontScale = num(el.fontScale);
  const cap = fontScale === null ? null : (fontScale * die.stage.width) / die.pxPerInch;
  return {
    kind: "text",
    title: `Text ${n}`,
    rows: [
      spot,
      { label: "Copy", value: str(el.text) ?? "(empty)" },
      { label: "Font", value: fontLabel(str(el.fontFamily)) },
      { label: "Style", value: str(el.fontStyle) ?? "normal" },
      { label: "Colour", value: str(el.fill) ?? "—" },
      { label: "Align", value: str(el.align) ?? "—" },
      { label: "Cap height", value: cap === null ? "—" : inches(cap) },
      ...placeRows(el, zone, die),
      ...common,
      ...checkSize(null, cap, zone),
    ],
  };
}

/**
 * The production spec of a hat design document. Never null for a document:
 * a hat on a die this storefront does not know still says which die it named,
 * so it is chased rather than made on the wrong frame.
 *
 * @param {Record<string, unknown>} doc
 * @returns {HatSpec}
 */
export function describeHatDesign(doc) {
  const dieId = str(doc.dieId) ?? "hat-unknown";
  const die = /** @type {HatDie | null} */ (hatDie(dieId));
  const spots = hatPlacements(doc);
  const chosen = isRecord(doc.zones) ? doc.zones : {};

  /** @type {HatZoneSpec[]} */
  const zones = (spots?.placements ?? []).map((p) => {
    // A placement comes only from a die (hatPlacements is null without one).
    const zone = /** @type {HatZone} */ (/** @type {HatDie} */ (die).zones.find((z) => z.id === p.zone));
    const entry = isRecord(chosen[zone.id]) ? /** @type {Record<string, unknown>} */ (chosen[zone.id]) : {};
    const shape = LABEL_SHAPES[/** @type {keyof typeof LABEL_SHAPES} */ (zone.id)];
    return {
      id: zone.id,
      label: zone.label,
      rect: { ...zone.rect },
      maxImprint: { ...zone.maxImprint },
      method: p.method,
      methodLabel: decorationLabel(p.method),
      primary: p.primary,
      threads: Array.isArray(entry.threads) ? entry.threads.filter((t) => typeof t === "string") : [],
      // The server records the ground on every order (hat-submit.ts); one with
      // none was made before it did, when the screen showed Natural.
      ...(shape ? { shape, ground: str(entry.ground) ?? NATURAL_LABEL_GROUND } : {}),
      ...(spotLevel(dieId, zone.id) ? { level: spotLevel(dieId, zone.id) } : {}),
    };
  });

  /** @type {CoozieElementSpec[]} */
  const elements = [];
  let logoN = 0;
  let textN = 0;
  if (die) {
    for (const el of Array.isArray(doc.elements) ? doc.elements : []) {
      if (!isRecord(el)) continue;
      const zone = zoneOfElement(el, die);
      if (!zone) continue;
      elements.push(elementSpec(el, el.type === "logo" ? ++logoN : ++textN, zone, die));
    }
  }

  // The code stamped on the order when it was placed (hat-submit.ts), or else
  // the palette's for the hex. A colour from before the palette has none.
  // The parts, in order, are those of the die's style.
  const partColors = isRecord(doc.parts) ? doc.parts : {};
  const stamped = isRecord(doc.pantone) ? doc.pantone : null;
  const parts = hatStyleOf(dieId).parts.flatMap(/** @returns {HatPartSpec[]} */ (p) => {
    const color = str(partColors[p.id]);
    if (!color) return [];
    if (p.id === "sweatband") {
      const band = stamped ? BAND_NAMES.get(color.toLowerCase()) : undefined;
      return [{ id: p.id, label: p.label, color, ...(band ? { band } : {}) }];
    }
    const pms = str(stamped?.[p.id]) ?? pmsByHex(color)?.code ?? null;
    return [{ id: p.id, label: p.label, color, ...(pms ? { pms } : {}) }];
  });

  return {
    kind: "hat",
    dieId,
    size: { id: dieId, label: die ? `Hat ${die.label}` : `Unknown hat die (${dieId})` },
    color: null,
    pattern: null,
    elements,
    jsonUrl: str(doc.jsonUrl),
    fontUrls: Array.isArray(doc.fontUrls) ? doc.fontUrls.filter((u) => typeof u === "string") : [],
    artworkFiles: (Array.isArray(doc.artworkFiles) ? doc.artworkFiles : [])
      .filter(
        /** @type {(f: unknown) => f is { url: string, fileName: string }} */
        (f) => isRecord(f) && typeof f.url === "string" && typeof f.fileName === "string",
      )
      .filter((f, i, all) => all.findIndex((g) => g.url === f.url) === i)
      .map(({ url, fileName }) => ({ url, fileName })),
    frame: die
      ? { width: die.stage.width, height: die.stage.height, pxPerInch: die.pxPerInch }
      : { width: 0, height: 0, pxPerInch: 0 },
    zones,
    parts,
    placements: spots?.placements ?? [],
    extraSpots: spots?.extraSpots ?? 0,
    pictureUrl: str(doc.pictureUrl),
  };
}

/** Whether a spec is a hat's. */
/**
 * @param {CoozieSpec | null} spec
 * @returns {spec is HatSpec}
 */
export function isHatSpec(spec) {
  return /** @type {HatSpec | null} */ (spec)?.kind === "hat";
}

/**
 * A part's colour as a line says it: "PMS 2945 C (#0047BB)"; the sweatband
 * "#1C1C1E (black, to suit the front panels)", by what its style's band
 * follows (`frontName`); a hex from before the Pantone palette as itself.
 */
/**
 * @param {HatPartSpec} p
 * @param {string} [frontName]
 * @returns {string}
 */
export function partColourText(p, frontName = "front panels") {
  if (p.pms) return `${p.pms} (${p.color})`;
  return p.band ? `${p.color} (${p.band}, to suit the ${frontName})` : p.color;
}

/**
 * The fixed marks a hat is made with whatever the design (its die's style's:
 * the No. 7's "REEL48 strap tab: standard"), for the team email and
 * /admin/orders.
 */
/**
 * @param {Pick<HatSpec, "dieId">} spec
 * @returns {readonly string[]}
 */
export function hatFixedMarks(spec) {
  return hatStyleOf(spec.dieId).fixedMarks;
}

/** A hat spec as plain-text lines, for the team email (order-email.ts). */
/**
 * @param {HatSpec} spec
 * @param {string} [indent]
 * @returns {string[]}
 */
export function hatSpecToTextLines(spec, indent = "    ") {
  /** @type {string[]} */
  const out = [`${indent}Hat: ${spec.size.label} (die ${spec.dieId})`];
  if (spec.parts.length) {
    out.push(`${indent}Colours:`);
    for (const p of spec.parts) out.push(`${indent}  ${p.label}: ${partColourText(p, hatStyleOf(spec.dieId).frontName)}`);
  }
  out.push(`${indent}Spots (${spec.zones.length}, ${spec.extraSpots} extra):`);
  for (const z of spec.zones) {
    const bits = [
      `${z.methodLabel}${z.primary ? ", primary" : ""}`,
      z.threads.length ? `threads ${z.threads.join(", ")}` : null,
      z.shape ? `${z.shape} label` : null,
      z.ground ? `ground ${z.ground}` : null,
      `up to ${z.maxImprint.w} × ${z.maxImprint.h} in`,
    ].filter(Boolean);
    out.push(`${indent}  ${z.label}: ${bits.join(", ")}`);
  }
  for (const mark of hatFixedMarks(spec)) out.push(`${indent}${mark}`);
  for (const el of spec.elements) {
    out.push(`${indent}${el.title}:`);
    for (const r of el.rows) out.push(`${indent}  ${r.label}: ${r.value}`);
  }
  return out;
}
