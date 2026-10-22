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
//
// v1.11.0: any die, not only a koozie. A die without the koozie's fold (a
// hat's atlas, say) has one side per zone, under the zone's own id, each its
// max imprint; a point between them belongs to the nearest one. The koozie's
// sides and their rules are unchanged.
//
// v1.12.0: a zone with an `area` (hats.js) is a side of a third kind, "area":
// its polygon, holes cut out, and its CAP (`maxImprint`, in px), two limits
// kept apart. Its rules are region.js's, verbatim from the storefront's hat
// placer: where art may sit and how big it may print, a drag that goes round a
// keep-out rather than jumping it, and the overhang a server refuses.

import { isKoozieGeometry, nearestZone } from "./dies.js";
import { cutRings } from "./hats.js";
import { areaBounds, areaHome, confinePose, poseValid } from "./region.js";

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
 *
 * v1.11.0: every zone is a side, keyed by its id (a koozie's zones are just
 * the two panels, so its sides are as before). A zone whose `maxImprint` is
 * smaller than its rect is kept to the imprint, centred in the rect, so
 * confining artwork to its side is confining it to what can be made. A hat's
 * rects are their imprints already.
 *
 * v1.12.0: a zone with an `area` is `{ kind: "area", x0, y0, x1, y1, rings,
 * area, cap }`: the area's bounding box, its rings as the cut traces them,
 * the area itself (for region.js) and the cap in px (null without one). The
 * cap is NOT a box centred in the rect, as it is for a rect zone: art may sit
 * anywhere in the area, at up to the cap's size. The same object for a zone
 * every time, so a side keeps its identity.
 */
export function faceRegions(geom) {
  const regions = {};
  const disc = geom?.r > 0 ? { cx: geom.cx, cy: geom.cy, r: geom.r } : null;
  for (const zone of geom?.zones ?? []) {
    if (zone.area) {
      regions[zone.id] = areaRegion(zone, geom.pxPerInch);
      continue;
    }
    const { x0, y0, x1, y1 } = imprintBounds(zone, geom.pxPerInch);
    regions[zone.id] = { kind: "rect", x0, y0, x1, y1, ...(disc ? { exclude: disc } : {}) };
  }
  if (disc) regions.base = { kind: "circle", ...disc };
  return regions;
}

const areaRegions = new WeakMap();

/** A zone with an area, as a side (faceRegions), built once per zone. */
function areaRegion(zone, pxPerInch) {
  let region = areaRegions.get(zone);
  if (!region) {
    const b = areaBounds(zone.area);
    const max = zone.maxImprint;
    region = {
      kind: "area",
      x0: b.x,
      y0: b.y,
      x1: b.x + b.w,
      y1: b.y + b.h,
      rings: cutRings(zone.area),
      area: zone.area,
      cap: max && pxPerInch > 0 ? { w: max.w * pxPerInch, h: max.h * pxPerInch } : null,
    };
    areaRegions.set(zone, region);
  }
  return region;
}

/** A zone's bounds, narrowed to its `maxImprint` (inches) where that is smaller. */
function imprintBounds(zone, pxPerInch) {
  const b = zone.bounds;
  const max = zone.maxImprint;
  if (!max || !(pxPerInch > 0)) return b;
  const w = Math.min(b.x1 - b.x0, max.w * pxPerInch);
  const h = Math.min(b.y1 - b.y0, max.h * pxPerInch);
  if (w === b.x1 - b.x0 && h === b.y1 - b.y0) return b;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
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
  // v1.12.0: an area is its own clip, holes cut out (it carries no exclude).
  if (region.kind === "area") return region;
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
  } else if (region.kind === "area") {
    // v1.12.0: each ring its own closed subpath, the holes wound against the
    // outline, so a clip or fill by the default rule cuts them out.
    for (const ring of region.rings) {
      ring.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(s(x), s(y)) : ctx.lineTo(s(x), s(y))));
      ctx.closePath();
    }
  } else {
    ctx.rect(s(region.x0), s(region.y0), s(region.x1 - region.x0), s(region.y1 - region.y0));
  }
}

/**
 * Which side a point is on, `point` in stage FRACTIONS (as the design document
 * stores positions): the base disc if it is inside it, otherwise the panel on
 * that side of the fold. The storefront's `faceOf` is the same rule.
 *
 * v1.11.0: on a die with no fold, the zone the point is in, or the nearest
 * zone to it (`nearestZone`), by id. Null only for a die with no zones.
 */
export function faceAt(geom, stage, point) {
  if (!isKoozieGeometry(geom)) return nearestZone(geom, point.x, point.y, stage)?.id ?? null;
  const x = point.x * stage.width;
  const y = point.y * stage.height;
  if (geom.r > 0 && Math.hypot(x - geom.cx, y - geom.cy) <= geom.r) return "base";
  return point.y < geom.bottomPanelStartY ? "front" : "back";
}

/**
 * The side an element belongs to (v1.11.0), by its centre (`faceAt`), or the
 * side it is trimmed to when it carries a `clip`: a trimmed element stays its
 * side's even with its centre at the edge. On a hat that is the zone id, and
 * it is what a host counts spots by. Null for a die with no sides.
 */
export function zoneOfElement(geom, stage, el) {
  if (el?.clip && Object.prototype.hasOwnProperty.call(faceRegions(geom), el.clip)) return el.clip;
  return faceAt(geom, stage, { x: el.x, y: el.y });
}

/**
 * Whether an element lies wholly inside its side's region (v1.11.0), which on
 * a hat is that zone's max imprint. Its box is its drawn size turned by its
 * rotation, in native stage px: a logo's from `scale` and its natural aspect,
 * as the stage draws it. Text has no size without font metrics, so the host
 * passes `size` (`{ width, height }`, native px, unturned), measured; without
 * it the answer for text is null, not known.
 *
 * A trimmed element fits: what lies past its side's edge is not printed.
 *
 * v1.12.0: on an area side, inside the area (clear of its holes) AND within
 * its cap, by region.js's `poseValid`.
 */
export function elementFits(geom, stage, el, size) {
  const side = zoneOfElement(geom, stage, el);
  const region = side ? faceRegions(geom)[side] : null;
  if (!region) return false;
  if (el.clip === side) return true;
  let w = size?.width;
  let h = size?.height;
  if (!(Number.isFinite(w) && Number.isFinite(h))) {
    if (el.type !== "logo") return null;
    w = el.scale * stage.width;
    h = w * (el.naturalHeight / el.naturalWidth || 1);
  }
  const cx = el.x * stage.width;
  const cy = el.y * stage.height;
  if (region.kind === "area") {
    return poseValid({ cx, cy, w, h, rotation: el.rotation || 0 }, { area: region.area, cap: region.cap });
  }
  const a = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const half = { hx: (w * cos + h * sin) / 2, hy: (w * sin + h * cos) / 2 };
  return insideRegion(region, { x: cx, y: cy }, half);
}

/** A region scaled by `k` (native px to display px, say). */
export function scaleRegion(region, k) {
  if (region.kind === "circle") return { kind: "circle", cx: region.cx * k, cy: region.cy * k, r: region.r * k };
  if (region.kind === "area") {
    const ring = (r) => r.map(([x, y]) => [x * k, y * k]);
    return {
      kind: "area",
      x0: region.x0 * k,
      y0: region.y0 * k,
      x1: region.x1 * k,
      y1: region.y1 * k,
      rings: region.rings.map(ring),
      area: { outline: ring(region.area.outline), holes: (region.area.holes ?? []).map(ring) },
      cap: region.cap ? { w: region.cap.w * k, h: region.cap.h * k } : null,
    };
  }
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
  if (region.kind === "area") {
    // v1.12.0: region.js's rule, the box at its size (the cap is fitScale's).
    const r = confinePose({ cx: x, cy: y, w: 2 * hx, h: 2 * hy, rotation: 0 }, { area: region.area });
    return { x: r.cx, y: r.cy, moved: r.moved };
  }
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
 * Whether a box of half extents `half` around `center` lies wholly inside
 * `region` (v1.10.0): nothing of it would be trimmed by `faceClipRegion`. A
 * panel's excluded disc does not count, since artwork may overlap it. For the
 * disc, the box is measured by its corners, as `confineCenter` measures it.
 * Not `!confineCenter(...).moved`: a box too big for the region is centred,
 * and one already centred does not move.
 */
export function insideRegion(region, center, half) {
  const { hx, hy } = half;
  const e = 1e-6;
  // v1.12.0: region.js's own tolerance, so what confinePose leaves is inside.
  if (region.kind === "area") return poseValid({ cx: center.x, cy: center.y, w: 2 * hx, h: 2 * hy, rotation: 0 }, { area: region.area });
  if (region.kind === "circle") {
    return Math.hypot(center.x - region.cx, center.y - region.cy) + Math.hypot(hx, hy) <= region.r + e;
  }
  return (
    center.x - hx >= region.x0 - e &&
    center.x + hx <= region.x1 + e &&
    center.y - hy >= region.y0 - e &&
    center.y + hy <= region.y1 + e
  );
}

/**
 * The largest factor (at most 1) a box of half extents `half` can be scaled by
 * and still fit inside `region`.
 */
export function fitScale(region, half) {
  const { hx, hy } = half;
  if (!(hx > 0) && !(hy > 0)) return 1;
  if (region.kind === "area") {
    // v1.12.0: the cap, and the most the area holds anywhere (region.js).
    const [cx, cy] = areaHome(region.area);
    return confinePose({ cx, cy, w: 2 * hx, h: 2 * hy, rotation: 0 }, { area: region.area, cap: region.cap }).scale;
  }
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
