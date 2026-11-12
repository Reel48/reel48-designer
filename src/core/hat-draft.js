// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/hat-draft.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The hat designer's draft on this device: the same store as the can
// cooler's (coozie-draft.js createDraftStore, one IndexedDB store, files kept
// apart, swept when a record drops them), under the hat die's own key, with
// the hat's own record: its die, part colours and spots instead of a can's
// size, colour and pattern, and the quantity and express shipping instead of
// the magnet and express production.
//
// A design is opened on the die new designs are made on: one made on the
// first No. 7 die (hat-no-7) before round E1 is moved onto hat-no-7-v2 as it
// is read (onCurrentHatDie, hat-migrate.js), every piece at the same point on
// the hat. A design link is read through parseHatDraft too (hat-import.js), so
// a shared design, and a cart line's Edit design, open the same way.

import { DRAFT_MAX_AGE_MS, parseCheckout, parseFonts, parseLogos, stableFingerprint } from "./coozie-draft.js";
import { HAT_NO_7_DIE, HAT_NO_7_V1_DIE, hatDie } from "./hat-config.js";
import { HAT_NO_7_ANCHORS, migrateHatDoc } from "./hat-migrate.js";
import { DEFAULT_HAT_STYLE, hatStyleOf } from "./hat-style-config.js";
import { nearestPms } from "./pms-palette.js";
import { withSweatband } from "./sweatband.js";

/**
 * One draft per hat style, beside the can cooler's ("can-cooler"): each
 * style's draftKey (hat-style-config.js). This is the No. 7's, the first
 * die's id, and it stays so: a draft saved on it is still found, and opens on
 * the current die.
 */
export const HAT_DRAFT_KEY = DEFAULT_HAT_STYLE.draftKey;
export const HAT_DRAFT_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlob(value) {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

/**
 * The checkout record, as the can cooler's (parseCheckout), with the 3D
 * picture's URL kept: a hat's upload carries one (hat-submit.ts pictureUrl),
 * and a line put back from that upload after a reload or a return from Stripe
 * must carry it to the team's email and the hub too.
 */
function parseHatCheckout(raw) {
  const checkout = parseCheckout(raw);
  if (!checkout) return null;
  const pictureUrl = raw.uploaded.pictureUrl;
  return typeof pictureUrl === "string" && pictureUrl.length > 0
    ? { ...checkout, uploaded: { ...checkout.uploaded, pictureUrl } }
    : checkout;
}

/** A design's printable fields, copied: never `selectedId`. */
function designFields(design) {
  return {
    schemaVersion: 4,
    kind: "hat",
    dieId: design.dieId,
    parts: { ...(design.parts ?? {}) },
    zones: Object.fromEntries(Object.entries(design.zones ?? {}).map(([id, z]) => [id, { ...z }])),
    elements: (design.elements ?? []).map((el) => ({ ...el })),
  };
}

/**
 * The record the store keeps: plain objects plus Blobs, what IndexedDB takes.
 * `logos`, `fonts`, `thumbnail` and `checkout` are the can cooler draft's
 * shapes, so the store splits and joins the files the same way.
 */
export function serializeHatDraft(
  { design, step, quantity, logos, fonts, thumbnail, checkout, shipping },
  now = Date.now(),
) {
  return {
    v: HAT_DRAFT_VERSION,
    kind: "hat",
    savedAt: now,
    design: designFields(design),
    step,
    quantity,
    logos: (logos ?? []).map(({ elId, blob, fileName, mimeType, naturalWidth, naturalHeight, assetId, artwork }) => ({
      elId,
      blob,
      fileName,
      mimeType,
      naturalWidth,
      naturalHeight,
      ...(assetId ? { assetId } : {}),
      ...(artwork ? { artwork: { blob: artwork.blob, fileName: artwork.fileName, mimeType: artwork.mimeType } } : {}),
    })),
    fonts: (fonts ?? []).map(({ family, blob, fileName }) => ({ family, blob, fileName })),
    thumbnail: thumbnail ?? null,
    checkout: checkout ? parseHatCheckout(checkout) : null,
    shipping: { express: shipping?.express === true },
  };
}

/**
 * `design` on the die new designs are made on (HAT_NO_7_DIE): itself when it
 * is already there or on a die with no successor; moved from the first No. 7
 * die by migrateHatDoc (every piece's centre at the same point on the hat, the
 * same size in inches, a square label's art on the rectangle, then each piece
 * confined to its spot's area and cap); null when it cannot be moved.
 *
 * @template T
 * @param {T} design
 * @returns {T | null}
 */
export function onCurrentHatDie(design) {
  const die = hatDie(/** @type {any} */ (design)?.dieId);
  if (!die?.supersededBy) return design;
  if (die.id !== HAT_NO_7_V1_DIE.id || die.supersededBy !== HAT_NO_7_DIE.id) return null;
  try {
    return migrateHatDoc(design, { from: HAT_NO_7_V1_DIE, to: HAT_NO_7_DIE, ...HAT_NO_7_ANCHORS });
  } catch {
    return null;
  }
}

/**
 * The stored record checked, as parseDraft checks the can cooler's: null when
 * it is not a hat draft this file reads, is past DRAFT_MAX_AGE_MS, or is on a
 * die this storefront no longer has; logos without their files are dropped
 * from the design, as a missing file is. A design on a superseded die comes
 * back on the current one (onCurrentHatDie), so its fingerprint is a new one
 * and an upload made for it before is not reused for the moved design.
 */
export function parseHatDraft(record, now = Date.now()) {
  if (!isObject(record) || record.v !== HAT_DRAFT_VERSION || record.kind !== "hat") return null;
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) return null;
  if (now - record.savedAt > DRAFT_MAX_AGE_MS) return null;
  const d = record.design;
  if (!isObject(d) || d.kind !== "hat" || !hatDie(d.dieId)) return null;
  if (!Array.isArray(d.elements) || !d.elements.every(isObject)) return null;
  if (!Number.isInteger(record.quantity) || record.quantity <= 0) return null;

  const logos = parseLogos(record.logos).filter((logo) => d.elements.some((el) => el.type === "logo" && el.id === logo.elId));
  const logoIds = new Set(logos.map((l) => l.elId));
  const parts = isObject(d.parts)
    ? Object.fromEntries(Object.entries(d.parts).filter(([, c]) => typeof c === "string"))
    : {};
  const zones = isObject(d.zones)
    ? Object.fromEntries(Object.entries(d.zones).filter(([, z]) => isObject(z)).map(([id, z]) => [id, { ...z }]))
    : {};
  const design = onCurrentHatDie({
    schemaVersion: 4,
    kind: "hat",
    dieId: d.dieId,
    parts,
    zones,
    elements: d.elements.filter((el) => el.type !== "logo" || logoIds.has(el.id)).map((el) => ({ ...el })),
  });
  if (!design) return null;
  return {
    savedAt: record.savedAt,
    design: onTodaysColours(design),
    step: typeof record.step === "string" ? record.step : null,
    quantity: record.quantity,
    logos,
    fonts: parseFonts(record.fonts),
    thumbnail: isBlob(record.thumbnail) ? record.thumbnail : null,
    checkout: parseHatCheckout(record.checkout),
    shipping: { express: isObject(record.shipping) && record.shipping.express === true },
  };
}

/**
 * A design opened again (a draft on this device, or a design link, which is
 * read through parseHatDraft too), in the colours the designer offers today
 * (2026-10-21), after onCurrentHatDie has put it on the current die (which
 * also moves a square inside label's art to the rectangle, the one label the
 * current die has):
 *   - every part's colour on the Pantone palette: a hex the palette does not
 *     carry is read as the code it used to be (`was`, pms-palette.js), or
 *     else moves to its nearest colour (CIEDE2000), the lab's placeholder
 *     colours among them; the screen then shows what can be made;
 *   - the sweatband its front panels call for (sweatband.js, by the style of
 *     its die), whatever was chosen for it before.
 * The fingerprint changes with it, so an upload made before is not reused
 * for what is now a different hat.
 */
export function onTodaysColours(design) {
  const parts = {};
  for (const [id, colour] of Object.entries(design.parts ?? {})) {
    if (id === "sweatband") continue;
    const pms = nearestPms(colour);
    if (pms) parts[id] = pms.hex;
  }
  return { ...design, parts: withSweatband(parts, hatStyleOf(design.dieId).sweatbandFollows) };
}

/**
 * A stable string for "this exact hat on this exact cart line": the die, the
 * part colours, every spot's choices, every element and the quantity. Equal
 * means the last upload still describes what is on screen.
 */
export function hatFingerprint({ design, quantity }) {
  return stableFingerprint("hat", { ...designFields(design), quantity });
}
