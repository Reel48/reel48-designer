// The sides of a koozie, as places artwork is kept inside (v1.7.0).
//
// A phone host shows one side at a time (the front panel, the base disc, the
// back panel), and asks the stage to keep each piece of artwork on the side it
// was put on, so nothing prints across a fold by accident. This file is the
// geometry alone, in NATIVE stage px or display px alike (every function is
// unit-free), so it is tested with no canvas. The stage's `confine` prop uses
// it; see DesignStage.
//
// Artwork is measured by its axis-aligned bounding box, half extents
// `{ hx, hy }` around its centre, which is what a rotated node's client rect
// gives. "Inside" means the whole box is inside.

/**
 * Each side as a region, in native stage px: the front and back panels as
 * the die's own zone rects, the base as its disc. A die without one of them
 * simply lacks that key.
 *
 * The disc reaches a little into each panel's rect (about 60 native px on the
 * koozie dies), and a point there is the base by `faceAt`'s rule. So a panel
 * carries the disc as `exclude`: artwork on a panel may overlap it, but its
 * centre is kept out of it, or a settle at the panel's edge would turn the
 * artwork into base artwork.
 */
export function faceRegions(geom) {
  const regions = {};
  const disc = geom?.r > 0 ? { cx: geom.cx, cy: geom.cy, r: geom.r } : null;
  for (const zone of geom?.zones ?? []) {
    if (zone.id === "front" || zone.id === "back") {
      const { x0, y0, x1, y1 } = zone.bounds;
      regions[zone.id] = { kind: "rect", x0, y0, x1, y1, ...(disc ? { exclude: disc } : {}) };
    }
  }
  if (disc) regions.base = { kind: "circle", ...disc };
  return regions;
}

/**
 * The shape the stage clips one side to when it shows that side alone
 * (v1.8.0 `isolate`), in native stage px: a panel's zone rect, or the base's
 * disc. The same sides as `faceRegions`, without the `exclude` that only
 * confinement needs. `null` for no face, or one this die doesn't have.
 */
export function faceClipRegion(geom, face) {
  const regions = faceRegions(geom);
  if (!face || !Object.prototype.hasOwnProperty.call(regions, face)) return null;
  const region = regions[face];
  if (region.kind === "circle") return { kind: "circle", cx: region.cx, cy: region.cy, r: region.r };
  return { kind: "rect", x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 };
}

/**
 * Add a region's outline to `ctx`'s current path, times `scale`, as a closed
 * subpath of its own. No `beginPath`, so several make one path: a union when
 * clipped to, every outline when stroked. Any canvas-like `ctx` (a 2D
 * context, a Konva context) works.
 */
export function traceRegion(ctx, region, scale = 1) {
  const s = (v) => v * scale;
  if (region.kind === "circle") {
    // Its own subpath: an arc continues from the current point otherwise.
    ctx.moveTo(s(region.cx + region.r), s(region.cy));
    ctx.arc(s(region.cx), s(region.cy), s(region.r), 0, 2 * Math.PI, false);
    ctx.closePath();
  } else {
    ctx.rect(s(region.x0), s(region.y0), s(region.x1 - region.x0), s(region.y1 - region.y0));
  }
}

/**
 * Which side a point is on, `point` in stage FRACTIONS (as the design document
 * stores positions): the base disc if it is inside it, otherwise the panel on
 * that side of the fold. The storefront's `faceOf` is the same rule.
 */
export function faceAt(geom, stage, point) {
  const x = point.x * stage.width;
  const y = point.y * stage.height;
  if (geom.r > 0 && Math.hypot(x - geom.cx, y - geom.cy) <= geom.r) return "base";
  return point.y < geom.bottomPanelStartY ? "front" : "back";
}

/** A region scaled by `k` (native px to display px, say). */
export function scaleRegion(region, k) {
  if (region.kind === "circle") return { kind: "circle", cx: region.cx * k, cy: region.cy * k, r: region.r * k };
  const rect = { kind: "rect", x0: region.x0 * k, y0: region.y0 * k, x1: region.x1 * k, y1: region.y1 * k };
  if (region.exclude) {
    const { cx, cy, r } = region.exclude;
    rect.exclude = { cx: cx * k, cy: cy * k, r: r * k };
  }
  return rect;
}

/**
 * The centre nearest `center` at which a box of half extents `half` lies wholly
 * inside `region`, and whether that is a move. A box too big for the region on
 * an axis (or, for the disc, at all) is centred instead: the best it can do.
 */
export function confineCenter(region, center, half) {
  const { hx, hy } = half;
  let x = center.x;
  let y = center.y;
  if (region.kind === "circle") {
    const room = region.r - Math.hypot(hx, hy);
    const dx = x - region.cx;
    const dy = y - region.cy;
    const d = Math.hypot(dx, dy);
    if (room <= 0) {
      x = region.cx;
      y = region.cy;
    } else if (d > room) {
      x = region.cx + (dx / d) * room;
      y = region.cy + (dy / d) * room;
    }
  } else {
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    x = clamp(x, region.x0 + hx, region.x1 - hx);
    y = clamp(y, region.y0 + hy, region.y1 - hy);
    // Keep the centre off an excluded disc: straight away from it, towards the
    // panel's own middle (up for the front, down for the back), to just past
    // its edge at this x.
    const ex = region.exclude;
    if (ex && Math.hypot(x - ex.cx, y - ex.cy) < ex.r) {
      const dir = Math.sign((region.y0 + region.y1) / 2 - ex.cy) || -1;
      const reach = Math.sqrt(Math.max(0, ex.r * ex.r - (x - ex.cx) ** 2));
      y = ex.cy + dir * (reach + 1e-6 * ex.r + 1e-9);
    }
  }
  const moved = Math.abs(x - center.x) > 1e-9 || Math.abs(y - center.y) > 1e-9;
  return { x, y, moved };
}

/**
 * The largest factor (at most 1) a box of half extents `half` can be scaled by
 * and still fit inside `region`.
 */
export function fitScale(region, half) {
  const { hx, hy } = half;
  if (!(hx > 0) && !(hy > 0)) return 1;
  if (region.kind === "circle") return Math.min(1, region.r / Math.hypot(hx, hy));
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  return Math.min(1, hx > 0 ? w / (2 * hx) : 1, hy > 0 ? h / (2 * hy) : 1);
}

/**
 * Rubber-band resistance past an edge: how far artwork shows past it when the
 * finger is `over` past it. Starts at the finger's own pace and never reaches
 * `limit` (the curve iOS scroll views use). Sign follows `over`.
 */
export function rubberBand(over, limit) {
  if (!(limit > 0) || over === 0) return 0;
  const d = Math.abs(over);
  return Math.sign(over) * limit * (1 - 1 / (d / limit + 1));
}
