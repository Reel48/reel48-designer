// Hat dies (v1.11.0): one atlas sheet per hat style.
//
// A hat is not cut from one flat piece the way a koozie is. Its print spots sit
// on different panels of a sewn crown (the front across the centre seam, each
// side, the back above the strap) and on a woven label inside. Each spot is
// flattened on its own, and the flat pieces are laid out on ONE sheet: one
// rectangle island per spot, with gutters between them. One sheet keeps one
// design document, one undo history, one art texture and one proof, as the
// koozie has. The 3D model's print UVs are this frame (u = x/W, v = 1 - y/H),
// so an island here is exactly where its spot's artwork lands on the hat.
//
// Each island's rect IS that spot's maximum imprint, so keeping artwork inside
// its rect (the stage's `confine`) is keeping it inside the imprint. Bleed lives
// in the gutters (at least `gutterIn` between any two rects).
//
// THE FRAME IS PINNED like a koozie's, the moment an order exists against it.
// `reserved` holds rects for spots not offered yet (the bill top, under the
// bill), so adding them later never moves the frame. See dies.js's header.

/**
 * The No. 7 (unstructured 6-panel strap-back dad hat), as the model build's
 * step 05z wrote it: Reel48-Storefront `scripts/blender/hat-no7/die_no7.json`.
 *
 * A verbatim transcription of that file, in native stage px and inches, so a
 * consumer needs no JSON import. `tests/hat-no-7.golden.json` is a byte copy of
 * the file and `tests/hat.test.js` asserts the die rebuilt from this equals it.
 * Change both together, from a new 05z run, and only before the first order.
 *
 * `status` is the lab's own: the zone sizes are proposed until the physical fit
 * test confirms them.
 */
const HAT_NO_7 = deepFreeze({
  status: "proposed: pending the physical fit test",
  pxPerInch: 200,
  stage: { width: 1560, height: 1296 },
  zones: [
    {
      id: "front",
      label: "Front",
      rect: { x: 40, y: 40, w: 900, h: 450 },
      maxImprint: { w: 4.5, h: 2.25 },
      methods: ["embroidery", "pvc_patch", "silicon_patch", "woven_patch"],
    },
    {
      id: "left",
      label: "Left side",
      rect: { x: 1020, y: 40, w: 400, h: 300 },
      maxImprint: { w: 2.0, h: 1.5 },
      methods: ["embroidery"],
    },
    {
      id: "right",
      label: "Right side",
      rect: { x: 1020, y: 420, w: 400, h: 300 },
      maxImprint: { w: 2.0, h: 1.5 },
      methods: ["embroidery"],
    },
    {
      id: "back",
      label: "Back",
      rect: { x: 1020, y: 800, w: 500, h: 175 },
      maxImprint: { w: 2.5, h: 0.875 },
      methods: ["embroidery"],
    },
    {
      id: "label_tall",
      label: "Inside label, rectangle",
      rect: { x: 1020, y: 1055, w: 350, h: 200 },
      maxImprint: { w: 1.75, h: 1.0 },
      methods: ["woven_label"],
    },
    {
      id: "label_square",
      label: "Inside label, square",
      rect: { x: 720, y: 1000, w: 200, h: 200 },
      maxImprint: { w: 1.0, h: 1.0 },
      methods: ["woven_label"],
    },
  ],
  reserved: [
    {
      id: "bill_top",
      label: "Bill top (reserved)",
      rect: { x: 40, y: 1000, w: 600, h: 200 },
      maxImprint: { w: 3.0, h: 1.0 },
    },
    {
      id: "under_bill",
      label: "Under the bill (reserved)",
      rect: { x: 40, y: 570, w: 900, h: 350 },
      maxImprint: { w: 4.5, h: 1.75 },
    },
  ],
  gutterIn: 0.4,
});

/**
 * The inside label is one spot that comes in two shapes, one at a time
 * (Brayden, 2026-10-19). Each shape is a zone of its own, so each has its own
 * island and its own max imprint. Both are centred on the same point inside
 * the hat (05z `sharedCentreWith`), which is what lets `moveToZone` carry the
 * artwork across when the shape switches. Zones with a `shape` are the
 * alternatives of one another; see `SET_ZONE` in design.js.
 */
const LABEL_SHAPES = Object.freeze({ label_tall: "tall", label_square: "square" });

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** A die-JSON rect `{x, y, w, h}` as zone bounds, in the koozie zones' key order. */
function boundsOf({ x, y, w, h }) {
  return { x0: x, x1: x + w, y0: y, y1: y + h };
}

/**
 * Hat geometry: one rect island per zone.
 *
 * Returns what `koozieOutline` returns, minus the fold and the disc a hat does
 * not have: `pxPerInch` (fixed, not derived), `cmds` (one closed rect subpath
 * per zone, so the art layer is masked to the islands and the die line strokes
 * each one), `zones`, plus `reserved` (rects kept free, not printable, not in
 * `cmds`) and `gutterIn`.
 *
 * Every zone carries `maxImprint` (inches, equal to its rect) and `methods`,
 * the decoration methods the spot can be made with. A label zone also carries
 * its `shape`.
 */
export function hatOutline(layout) {
  const zones = layout.zones.map((z) => {
    const bounds = boundsOf(z.rect);
    return {
      id: z.id,
      label: z.label,
      bounds,
      // A hat has no fold: nothing on it prints upside down.
      flipped: false,
      snapLines: { x: [(bounds.x0 + bounds.x1) / 2], y: [(bounds.y0 + bounds.y1) / 2] },
      maxImprint: { ...z.maxImprint },
      methods: [...z.methods],
      ...(LABEL_SHAPES[z.id] ? { shape: LABEL_SHAPES[z.id] } : {}),
    };
  });
  const cmds = [];
  for (const { bounds: b } of zones) {
    cmds.push(["M", b.x0, b.y0], ["L", b.x1, b.y0], ["L", b.x1, b.y1], ["L", b.x0, b.y1], ["Z"]);
  }
  return {
    pxPerInch: layout.pxPerInch,
    cmds,
    zones,
    reserved: layout.reserved.map((r) => ({
      id: r.id,
      label: r.label,
      bounds: boundsOf(r.rect),
      maxImprint: { ...r.maxImprint },
    })),
    gutterIn: layout.gutterIn,
  };
}

/** The hat entries of `DIES` (dies.js spreads them in). */
export const HAT_DIES = {
  "hat-no-7": {
    id: "hat-no-7",
    kind: "hat",
    label: "No. 7",
    blurb: "Unstructured 6-panel dad hat, strap back",
    productHandle: "no-7",
    status: HAT_NO_7.status,
    measurements: HAT_NO_7,
    stage: { width: HAT_NO_7.stage.width, height: HAT_NO_7.stage.height },
    outline: hatOutline,
  },
};
