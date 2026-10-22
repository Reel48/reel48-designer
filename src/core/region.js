/**
 * The confine rule for art placed straight on the 3D hat: a logo or a line of
 * text stays inside its own spot's AREA and no bigger than the spot's CAP.
 *
 * Two limits, not one: the AREA is where a logo may sit, the CAP how big it
 * may print (Brayden, 2026-10-21: the front's area is both front panels as one,
 * across the centre seam; a side's is its whole panel; the caps stay 4.5 x 2.25
 * in on the front and 2 x 1.5 in a side). Nothing here assumes the two match.
 *
 * An area is a rect { x, y, w, h }, or a polygon with keep-outs (the eyelets):
 * { outline: [[x, y], ...], holes: [[[x, y], ...], ...] }, the printable region
 * after margins, die px, y down (the die's zone.area). A polygon that is an
 * axis-aligned rect with no holes (the back's, the label's) is a rect here.
 *
 * Everything is measured on the piece's AXIS-ALIGNED box once turned by its
 * rotation (rotatedSize), in die px (the hat die's 200 px/in frame), which is
 * what the print check measures too. A piece too big for the cap shrinks
 * uniformly about its centre (so its aspect, and the customer's artwork, are
 * kept). It is never grown to fill a spot.
 *
 * Then its centre is brought inside. On a rect each axis is clamped. On a
 * polygon the box must lie inside the outline and meet no hole:
 * - with `from` (the last valid pose: a drag's last frame, a nudge's start),
 *   the piece always travels from there toward the asked centre, even when
 *   that centre is valid as it stands: it stops where its box meets an edge,
 *   then slides along that edge with what is left of the move (`slide`, the
 *   default: a drag follows the finger along the edge as the rect's clamp
 *   does), or keeps its slide only when the slide still goes within 45
 *   degrees of the asked way (`slide: "step"`, a key's or button's nudge: Left
 *   follows a gently sloping crease, Down onto it stops where it lands, with
 *   no drift sideways), or does not slide at all (`false`). So
 *   a drag never jumps an eyelet or an outline's notch: it goes round;
 * - when the piece at its new size or turn no longer fits at `from`'s centre
 *   (a turn, a resize beside an eyelet), it is first pushed off what it now
 *   overlaps by about the least it must (the nearest room on rays from there,
 *   drawn back along the edges it meets), then travels as above;
 * - without `from`, an invalid pose moves to the valid centre nearest the
 *   asked one on the line to `home` (by default the polygon's pole of
 *   inaccessibility, found once per outline);
 * - when none of that takes the piece at its size (a logo grown wide, whose
 *   home is the centre of the largest CIRCLE the area holds), toward where a
 *   box of its shape fits best (found once per shape), as far as it must go;
 *   only when it fits nowhere at its size does it shrink, to the largest size
 *   it takes there (or at the asked centre, `from` or `home`, if one takes more).
 *
 * Pure and import-free, so it can move into @reel48/designer's core as it
 * stands, beside core/confine.js (whose rubber band this one follows) and be
 * run on the server to refuse a placement that breaks either limit (overhang).
 */

/**
 * @typedef {{ cx: number, cy: number, w: number, h: number, rotation: number }} Pose
 *   die px; `w` x `h` the unturned size at the current scale, `rotation` degrees.
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect die px
 * @typedef {{ outline: number[][], holes?: number[][][] }} Polygon
 *   die px, y down: one closed simple outline and its keep-outs.
 * @typedef {Rect | Polygon} Area
 * @typedef {{ w: number, h: number }} Size die px
 * @typedef {[number, number] | { cx: number, cy: number } | { x: number, y: number }} Point die px
 * @typedef {{ area?: Area | null, cap?: Size | null, from?: Point | null, home?: Point | null, slide?: boolean | "step" }} Limits
 *   `from`, `home` and `slide` (true, the default; "step"; false) count on a
 *   polygon area only (see above). No size floor:
 *   a floor (a pinch cannot shrink a piece to nothing) belongs to the gesture
 *   that asks for the size, and is applied there. A floor here could only ever
 *   grow art, since the print limits always win over it.
 */

const DEG = Math.PI / 180;
// A shrink this close to 1 is float noise from a piece that already fits
// exactly (a 90 degree turn's cosine is 6e-17, not 0), not a real limit.
const FIT_EPS = 1e-9;
// The iOS scroll view's constant: past the edge, art first moves at a little
// over half the finger's pace, then gives less and less.
const BAND_C = 0.55;
// Polygon areas, die px. A box is clear of an edge that lies up to VALID_EPS
// inside it (float noise, a host rounding what it stores). A sweep stops where
// an edge first lies SWEEP_EPS inside the box and backs off BACKOFF along the
// edge's normal, so the next frame's sweep starts clear of that edge and can
// slide along it.
const VALID_EPS = 1e-4;
const SWEEP_EPS = 1e-6;
const BACKOFF = 2e-6;
// The line to home is read for a box this much bigger, so what it finds is
// that far clear of every edge, with nothing to back off.
const ALONG_MARGIN = 1e-6;
// The contacts a sweep slides through before it stops: a curved edge is a
// polyline (the die's outlines are sampled every ~2 mm), so a slide along one
// meets a new segment every few px; a corner takes two and then converges.
const SLIDES = 32;
// A nudge (`slide: "step"`) keeps its slide along an edge only when that slide
// still goes within 45 degrees of the way it was asked to.
const STEP_COS = Math.SQRT1_2;
// A piece pushed off what it overlaps after a turn or a resize looks for room
// along this many rays round it (every 11.25 degrees), besides straight off
// each edge it overlaps.
const PUSH_RAYS = 32;
// A numerical fallback's precision (die px), and the pole of inaccessibility's.
const BISECT_PX = 0.25;
const POLE_PX = 0.5;

const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

/**
 * The axis-aligned extent of a `w` x `h` box turned by `deg` degrees: how much
 * of the die a rotated piece takes, which is what has to fit.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} deg
 * @returns {Size}
 */
export function rotatedSize(w, h, deg) {
  const a = finite(deg) * DEG;
  // Clean zeros at the right angles, so a piece turned 90 degrees measures
  // exactly h x w and the fit tests see whole numbers.
  let c = Math.abs(Math.cos(a));
  let s = Math.abs(Math.sin(a));
  if (c < 1e-12) c = 0;
  if (s < 1e-12) s = 0;
  return { w: w * c + h * s, h: w * s + h * c };
}

/** A pose with every field finite and the size not negative: never grown. */
function clean(pose) {
  return {
    cx: finite(pose.cx),
    cy: finite(pose.cy),
    w: Math.max(0, finite(pose.w)),
    h: Math.max(0, finite(pose.h)),
    rotation: finite(pose.rotation),
  };
}

/** The largest factor (up to Infinity) a box of extent `ext` takes to fit `room`. */
function room(roomW, roomH, ext) {
  const along = (r, e) => (e > 0 && Number.isFinite(r) ? r / e : Infinity);
  return Math.min(along(roomW, ext.w), along(roomH, ext.h));
}

/** `v` kept in [lo, hi]; centred when the range is inverted (the box is wider than the room). */
function clamp(v, lo, hi) {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

/** A point given as [x, y], { cx, cy } or { x, y }, as [x, y]; null when it is none of them. */
function pointOf(v) {
  if (!v) return null;
  const x = Array.isArray(v) ? v[0] : v.cx ?? v.x;
  const y = Array.isArray(v) ? v[1] : v.cy ?? v.y;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

// ---- Areas -------------------------------------------------------------------------

const isRect = (a) => !!a && [a.x, a.y, a.w, a.h].every(Number.isFinite);

/** [x, y] pairs with finite coordinates, consecutive repeats and a closing repeat dropped. */
function ringOf(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (const q of points) {
    const x = Array.isArray(q) ? q[0] : q?.x;
    const y = Array.isArray(q) ? q[1] : q?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function boundsOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The rect a 4-point ring is, when its sides are all horizontal or vertical; else null. */
function axisRect(ring) {
  if (ring.length !== 4) return null;
  if (new Set(ring.map((p) => p[0])).size !== 2 || new Set(ring.map((p) => p[1])).size !== 2) return null;
  for (let i = 0; i < 4; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % 4];
    if (a[0] !== b[0] && a[1] !== b[1]) return null;
  }
  return boundsOf(ring);
}

/**
 * A polygon area, ready to test: its rings (outline first), its edges flat as
 * [ax, ay, bx, by, nx, ny] (n the unit normal), its bounds and, once asked
 * for, its pole of inaccessibility and, per box shape, where it fits best.
 *
 * @typedef {{ rings: number[][][], edges: Float64Array, end: number, bbox: Rect, home: number[] | null, best: Map<number, number[]> }} Region
 */

/** Areas read, by their outline array: a polygon is built once, however often its object is copied. */
const regions = new WeakMap();

/** An area, read: { rect } for a rect (or a polygon that is one), { poly } for a polygon, null for none. */
function regionOf(area) {
  if (!area || typeof area !== "object") return null;
  if (!Array.isArray(area.outline)) return isRect(area) ? { rect: area } : null;
  const hit = regions.get(area.outline);
  if (hit && hit.holes === area.holes) return hit.region;
  const region = buildRegion(area);
  regions.set(area.outline, { holes: area.holes, region });
  return region;
}

function buildRegion(area) {
  const outline = ringOf(area.outline);
  if (outline.length < 3) return null;
  const holes = (Array.isArray(area.holes) ? area.holes : []).map(ringOf).filter((r) => r.length >= 3);
  if (!holes.length) {
    const r = axisRect(outline);
    if (r) return { rect: r };
  }
  const rings = [outline, ...holes];
  const n = rings.reduce((s, r) => s + r.length, 0);
  const edges = new Float64Array(n * 6);
  let o = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      edges[o] = a[0];
      edges[o + 1] = a[1];
      edges[o + 2] = b[0];
      edges[o + 3] = b[1];
      edges[o + 4] = len > 0 ? -(b[1] - a[1]) / len : 0;
      edges[o + 5] = len > 0 ? (b[0] - a[0]) / len : 0;
      o += 6;
    }
  }
  return { poly: { rings, edges, end: o, bbox: boundsOf(outline), home: null, best: new Map() } };
}

/** Whether (x, y) is inside the outline and outside every hole (even-odd over all rings). */
function inside(P, x, y) {
  const E = P.edges;
  let c = false;
  for (let o = 0; o < P.end; o += 6) {
    const ay = E[o + 1];
    const by = E[o + 3];
    if (ay > y !== by > y && x < E[o] + ((y - ay) * (E[o + 2] - E[o])) / (by - ay)) c = !c;
  }
  return c;
}

/** The distance from (x, y) to the nearest edge of any ring. */
function distToEdges(P, x, y) {
  const E = P.edges;
  let best = Infinity;
  for (let o = 0; o < P.end; o += 6) {
    const ax = E[o];
    const ay = E[o + 1];
    const dx = E[o + 2] - ax;
    const dy = E[o + 3] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** Whether edge `o` passes through the open box of half-size ex x ey round (cx, cy) (the separating axes: x, y, the edge's normal). */
function meets(E, o, cx, cy, ex, ey) {
  const ax = E[o];
  const ay = E[o + 1];
  const bx = E[o + 2];
  const by = E[o + 3];
  if (Math.max(ax, bx) <= cx - ex || Math.min(ax, bx) >= cx + ex) return false;
  if (Math.max(ay, by) <= cy - ey || Math.min(ay, by) >= cy + ey) return false;
  const nx = E[o + 4];
  const ny = E[o + 5];
  return Math.abs(nx * (cx - ax) + ny * (cy - ay)) < ex * Math.abs(nx) + ey * Math.abs(ny);
}

/**
 * Whether a box of half-size hx x hy round (cx, cy) lies in the region: its
 * centre inside, and no edge more than `eps` into it. With no edge in it, the
 * box lies wholly in one face, so its centre says which; an outline notch or a
 * hole wholly inside the box has edges in it.
 */
function clear(P, cx, cy, hx, hy, eps) {
  if (!inside(P, cx, cy)) return false;
  const ex = Math.max(0, hx - eps);
  const ey = Math.max(0, hy - eps);
  for (let o = 0; o < P.end; o += 6) if (meets(P.edges, o, cx, cy, ex, ey)) return false;
  return true;
}

/** The interval `span` writes: when a moving box overlaps an edge. */
const SPAN = { lo: 0, hi: 0, loAxis: 0, hiAxis: 0 };

/**
 * When a box of half-size ex x ey centred on (px + t dx, py + t dy) overlaps
 * edge `o`: the open interval of t (SPAN.lo, SPAN.hi), and the separating axes
 * whose overlap begins and ends it (0 x, 1 y, 2 the edge's normal). False when
 * it never does.
 */
function span(E, o, px, py, dx, dy, ex, ey) {
  const ax = E[o];
  const ay = E[o + 1];
  const bx = E[o + 2];
  const by = E[o + 3];
  const nx = E[o + 4];
  const ny = E[o + 5];
  let lo = -Infinity;
  let hi = Infinity;
  let loAxis = 2;
  let hiAxis = 2;
  for (let axis = 0; axis < 3; axis++) {
    let a, b, L, U;
    if (axis === 0) {
      a = px;
      b = dx;
      L = Math.min(ax, bx) - ex;
      U = Math.max(ax, bx) + ex;
    } else if (axis === 1) {
      a = py;
      b = dy;
      L = Math.min(ay, by) - ey;
      U = Math.max(ay, by) + ey;
    } else {
      const r = ex * Math.abs(nx) + ey * Math.abs(ny);
      a = nx * (px - ax) + ny * (py - ay);
      b = nx * dx + ny * dy;
      L = -r;
      U = r;
    }
    if (b === 0) {
      if (!(a > L && a < U)) return false;
      continue;
    }
    let t1 = (L - a) / b;
    let t2 = (U - a) / b;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > lo) {
      lo = t1;
      loAxis = axis;
    }
    if (t2 < hi) {
      hi = t2;
      hiAxis = axis;
    }
    if (lo >= hi) return false;
  }
  SPAN.lo = lo;
  SPAN.hi = hi;
  SPAN.loAxis = loAxis;
  SPAN.hiAxis = hiAxis;
  return true;
}

/** A separating axis's unit normal: x, y or edge `o`'s own. */
const axisNormal = (E, o, axis) => (axis === 0 ? [1, 0] : axis === 1 ? [0, 1] : [E[o + 4], E[o + 5]]);

/** From `bad` toward `good` (clear), the clear point within BISECT_PX of where the box first comes clear. */
function bisect(P, bad, good, hx, hy) {
  let [bx, by] = bad;
  let [gx, gy] = good;
  for (let i = 0; i < 64 && Math.hypot(bx - gx, by - gy) > BISECT_PX; i++) {
    const mx = (bx + gx) / 2;
    const my = (by + gy) / 2;
    if (clear(P, mx, my, hx, hy, VALID_EPS)) [gx, gy] = [mx, my];
    else [bx, by] = [mx, my];
  }
  return [gx, gy];
}

/**
 * From `S` (clear) toward `T`: the box moves until an edge stops it, backs off
 * that edge, and slides along it with the rest of the move, up to SLIDES
 * contacts. A drag stops at the edge and follows the finger along it. A move
 * that meets nothing ends on `T` exactly.
 */
function sweep(P, S, T, hx, hy, slides = SLIDES) {
  const E = P.edges;
  const ex = Math.max(0, hx - SWEEP_EPS);
  const ey = Math.max(0, hy - SWEEP_EPS);
  let px = S[0];
  let py = S[1];
  let dx = T[0] - px;
  let dy = T[1] - py;
  let met = false;
  for (let slide = 0; slide < slides && Math.hypot(dx, dy) > 1e-9; slide++) {
    let tc = 1;
    let ux = 0;
    let uy = 0;
    for (let o = 0; o < P.end; o += 6) {
      if (!span(E, o, px, py, dx, dy, ex, ey) || SPAN.hi <= 0 || SPAN.lo >= tc) continue;
      const [nx, ny] = axisNormal(E, o, SPAN.loAxis);
      const rate = nx * dx + ny * dy;
      if (SPAN.lo <= 0) {
        // Already this near at the start (within VALID_EPS): it stops only a move further in.
        const side = nx * ((E[o] + E[o + 2]) / 2 - px) + ny * ((E[o + 1] + E[o + 3]) / 2 - py);
        if (rate * side <= 0) continue;
      }
      tc = Math.max(0, SPAN.lo);
      const sgn = rate > 0 ? 1 : -1;
      ux = nx * sgn;
      uy = ny * sgn;
    }
    if (!ux && !uy) {
      // free to the end: on the first leg that is `T` itself, not S + (T - S) in floats
      px = slide === 0 ? T[0] : px + dx;
      py = slide === 0 ? T[1] : py + dy;
      break;
    }
    met = true;
    px += tc * dx - ux * BACKOFF;
    py += tc * dy - uy * BACKOFF;
    const rx = (1 - tc) * dx;
    const ry = (1 - tc) * dy;
    const into = rx * ux + ry * uy;
    dx = rx - into * ux;
    dy = ry - into * uy;
  }
  // no headway but the back-off (pressed straight into an edge): where it was, not a hair off it
  if (met && Math.hypot(px - S[0], py - S[1]) <= 4 * BACKOFF) return [S[0], S[1]];
  return clear(P, px, py, hx, hy, VALID_EPS) ? [px, py] : bisect(P, [px, py], S, hx, hy);
}

/** On the segment from `Q` to `T`: the clear centre nearest `Q`, or null when none of it is clear. */
function firstClear(P, Q, T, hx, hy) {
  const E = P.edges;
  const ex = hx + ALONG_MARGIN;
  const ey = hy + ALONG_MARGIN;
  const dx = T[0] - Q[0];
  const dy = T[1] - Q[1];
  const spans = [];
  for (let o = 0; o < P.end; o += 6) {
    if (span(E, o, Q[0], Q[1], dx, dy, ex, ey) && SPAN.hi > 0 && SPAN.lo < 1) spans.push({ lo: SPAN.lo, hi: SPAN.hi });
  }
  spans.sort((a, b) => a.lo - b.lo);
  const at = (t) => [Q[0] + t * dx, Q[1] + t * dy];
  // A stretch of the line no edge overlaps is wholly inside or wholly outside: its middle says which.
  const opens = (a, b) => {
    const m = at((a + b) / 2);
    return inside(P, m[0], m[1]);
  };
  // the stretch's start, or (float noise) the clear point nearest it toward the stretch's middle
  const take = (a, b) => {
    const p = at(a);
    return clear(P, p[0], p[1], hx, hy, VALID_EPS) ? p : bisect(P, p, at((a + b) / 2), hx, hy);
  };
  let t = 0;
  for (const s of spans) {
    if (s.lo > t && opens(t, s.lo)) return take(t, s.lo);
    if (s.hi > t) t = s.hi;
  }
  if (t < 1 && opens(t, 1)) return take(t, 1);
  return null;
}

/** On the line from `Q` to `T` (clear): the clear centre nearest `Q`. */
function along(P, Q, T, hx, hy) {
  return firstClear(P, Q, T, hx, hy) ?? [T[0], T[1]];
}

/**
 * Where a box of half-size hx x hy that no longer fits at `Q` (it was turned
 * or resized there) is pushed to: the nearest clear centre on rays from `Q`
 * (PUSH_RAYS round it, and straight off each edge the box overlaps), then
 * drawn back toward `Q` along the edges it meets. About the least push there
 * is, as the rect's clamp gives, rather than the way to home past an eyelet.
 * Null when no ray finds room.
 */
function pushOut(P, Q, hx, hy) {
  const E = P.edges;
  const dirs = [];
  for (let i = 0; i < PUSH_RAYS; i++) {
    const a = (2 * Math.PI * i) / PUSH_RAYS;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  // straight off each edge it overlaps (to Q's side), one ray per 2 degrees
  const seen = new Set();
  const ex = Math.max(0, hx - VALID_EPS);
  const ey = Math.max(0, hy - VALID_EPS);
  for (let o = 0; o < P.end; o += 6) {
    if (!meets(E, o, Q[0], Q[1], ex, ey)) continue;
    const nx = E[o + 4];
    const ny = E[o + 5];
    const side = nx * (Q[0] - E[o]) + ny * (Q[1] - E[o + 1]);
    for (const s of side > 0 ? [1] : side < 0 ? [-1] : [1, -1]) {
      const key = Math.round((Math.atan2(s * ny, s * nx) * 90) / Math.PI);
      if (seen.has(key)) continue;
      seen.add(key);
      dirs.push([s * nx, s * ny]);
    }
  }
  let best = null;
  let most = Math.hypot(P.bbox.w, P.bbox.h) + 2 * (hx + hy);
  for (const [ux, uy] of dirs) {
    // no ray further than the nearest room found so far
    const c = firstClear(P, Q, [Q[0] + ux * most, Q[1] + uy * most], hx, hy);
    if (!c) continue;
    const d = Math.hypot(c[0] - Q[0], c[1] - Q[1]);
    if (d < most) {
      most = d;
      best = c;
    }
  }
  return best && sweep(P, best, Q, hx, hy, SLIDES);
}

/**
 * From `S` (clear) toward `T`, by the `slide` rule the header gives. A step
 * keeps what it slides after meeting an edge only when that slide still goes
 * within 45 degrees of the asked way; else it stops where it met the edge.
 */
function travel(P, S, T, hx, hy, slide) {
  if (slide !== "step") return sweep(P, S, T, hx, hy, slide ? SLIDES : 1);
  const met = sweep(P, S, T, hx, hy, 1);
  const r = sweep(P, S, T, hx, hy, SLIDES);
  const dx = r[0] - met[0];
  const dy = r[1] - met[1];
  const d = Math.hypot(dx, dy);
  if (d <= 1e-9) return r;
  return dx * (T[0] - S[0]) + dy * (T[1] - S[1]) >= STEP_COS * d * Math.hypot(T[0] - S[0], T[1] - S[1]) ? r : met;
}

/** The L-infinity distance from the origin to the segment (ax, ay)-(bx, by). */
function linf(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  let best = Math.min(Math.max(Math.abs(ax), Math.abs(ay)), Math.max(Math.abs(bx), Math.abs(by)));
  // The max of two |linear|s is convex: its least is at a kink, where one is 0 or the two are equal.
  for (let k = 0; k < 4; k++) {
    let t;
    if (k === 0) {
      if (!dx) continue;
      t = -ax / dx;
    } else if (k === 1) {
      if (!dy) continue;
      t = -ay / dy;
    } else if (k === 2) {
      if (dx === dy) continue;
      t = (ay - ax) / (dx - dy);
    } else {
      if (dx === -dy) continue;
      t = (-ay - ax) / (dx + dy);
    }
    if (t > 0 && t < 1) {
      const v = Math.max(Math.abs(ax + t * dx), Math.abs(ay + t * dy));
      if (v < best) best = v;
    }
  }
  return best;
}

/**
 * The largest factor a box of half-size hx x hy, centred on `c`, can be scaled
 * by and stay in the region (0 off it): the least L-infinity distance, in its
 * own half-sizes, from `c` to any edge. Stops early once it is at most `floor`.
 */
function maxScaleAt(P, c, hx, hy, floor = -Infinity) {
  if (!inside(P, c[0], c[1])) return 0;
  const E = P.edges;
  const sx = Math.max(hx, 1e-9);
  const sy = Math.max(hy, 1e-9);
  let s = Infinity;
  for (let o = 0; o < P.end; o += 6) {
    s = Math.min(s, linf((E[o] - c[0]) / sx, (E[o + 1] - c[1]) / sy, (E[o + 2] - c[0]) / sx, (E[o + 3] - c[1]) / sy));
    if (s <= floor) return s;
  }
  return s;
}

/**
 * Where a box of half-size hx x hy fits best (scaled up or down: only its
 * shape counts): the most of a 16 x 16 grid over the bounds and the pole, then
 * climbed to within a fraction of a px. Once per shape (0.5% steps of aspect).
 */
function bestFor(P, hx, hy) {
  const key = Math.round(Math.log(Math.max(hx, 1e-9) / Math.max(hy, 1e-9)) * 200);
  const hit = P.best.get(key);
  if (hit) return hit;
  const { x, y, w, h } = P.bbox;
  const N = 16;
  let at = poleOf(P);
  let most = maxScaleAt(P, at, hx, hy);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const c = [x + (w * (i + 0.5)) / N, y + (h * (j + 0.5)) / N];
      const s = maxScaleAt(P, c, hx, hy, most);
      if (s > most) {
        most = s;
        at = c;
      }
    }
  }
  let sx = w / N / 2;
  let sy = h / N / 2;
  while (sx > BISECT_PX / 4 || sy > BISECT_PX / 4) {
    let moved = false;
    for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = [at[0] + u * sx, at[1] + v * sy];
      const s = maxScaleAt(P, c, hx, hy, most);
      if (s > most) {
        most = s;
        at = c;
        moved = true;
      }
    }
    if (!moved) {
      sx /= 2;
      sy /= 2;
    }
  }
  if (P.best.size > 64) P.best.clear();
  P.best.set(key, at);
  return at;
}

/**
 * The centre a box of half-size hx x hy takes, asked for at `want`, as the
 * header says: with `from`, always travelled to from there (pushed off first
 * when it no longer fits there), so it never jumps a hole; else `want` when
 * clear, else the nearest clear centre on the line to `goal`. Null when none
 * of them takes it.
 */
function placeAt(P, want, from, goal, hx, hy, slide) {
  if (from) {
    const start = clear(P, from[0], from[1], hx, hy, VALID_EPS) ? from : pushOut(P, from, hx, hy);
    if (start) return travel(P, start, want, hx, hy, slide);
  }
  if (clear(P, want[0], want[1], hx, hy, VALID_EPS)) return want;
  if (goal && clear(P, goal[0], goal[1], hx, hy, VALID_EPS)) return along(P, want, goal, hx, hy);
  return null;
}

// ---- The pole of inaccessibility (polylabel) ------------------------------------------

function heapPush(heap, c) {
  heap.push(c);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].max >= c.max) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = c;
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      let mv = last.max;
      if (l < heap.length && heap[l].max > mv) {
        m = l;
        mv = heap[l].max;
      }
      if (r < heap.length && heap[r].max > mv) m = r;
      if (m === i) break;
      heap[i] = heap[m];
      i = m;
    }
    heap[i] = last;
  }
  return top;
}

/**
 * The point of the region farthest from every edge (holes included), within
 * POLE_PX: polylabel's search (Mapbox), on a grid of cells refined best first.
 * On the vertical centre line when that is as good, so a symmetric outline's
 * home is on its axis exactly. Once per region.
 */
function poleOf(P) {
  if (P.home) return P.home;
  const { x, y, w, h } = P.bbox;
  const size = Math.min(w, h);
  const cell = (cx, cy, half) => {
    const d = (inside(P, cx, cy) ? 1 : -1) * distToEdges(P, cx, cy);
    return { x: cx, y: cy, h: half, d, max: d + half * Math.SQRT2 };
  };
  let best = cell(x + w / 2, y + h / 2, 0);
  if (size > 0) {
    // the outline's own centroid is often the answer, and a good first bound
    const ring = P.rings[0];
    let a = 0, gx = 0, gy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f;
      gx += (ring[j][0] + ring[i][0]) * f;
      gy += (ring[j][1] + ring[i][1]) * f;
    }
    if (a) {
      const c = cell(gx / (3 * a), gy / (3 * a), 0);
      if (c.d > best.d) best = c;
    }
    const heap = [];
    const half = size / 2;
    for (let cx = x; cx < x + w; cx += size) for (let cy = y; cy < y + h; cy += size) heapPush(heap, cell(cx + half, cy + half, half));
    while (heap.length) {
      const c = heapPop(heap);
      if (c.d > best.d) best = c;
      if (c.max - best.d <= POLE_PX) break;
      const q = c.h / 2;
      heapPush(heap, cell(c.x - q, c.y - q, q));
      heapPush(heap, cell(c.x + q, c.y - q, q));
      heapPush(heap, cell(c.x - q, c.y + q, q));
      heapPush(heap, cell(c.x + q, c.y + q, q));
    }
    const mid = cell(x + w / 2, best.y, 0);
    if (mid.d >= best.d - POLE_PX) best = mid;
  }
  P.home = [best.x, best.y];
  return P.home;
}

// ---- Reading an area ------------------------------------------------------------------

/** The rect an area is (a rect, or a polygon that is one), else null. */
export function areaRect(area) {
  return regionOf(area)?.rect ?? null;
}

/**
 * An area's rings, die px: a polygon's outline first, then its holes (as
 * read: repeats dropped); a rect's four corners. Empty for no area. Read only.
 *
 * @param {Area | null | undefined} area
 * @returns {number[][][]}
 */
export function areaRings(area) {
  const r = regionOf(area);
  if (r?.poly) return r.poly.rings;
  if (!r?.rect) return [];
  const { x, y, w, h } = r.rect;
  return [[[x, y], [x, y + h], [x + w, y + h], [x + w, y]]];
}

/** An area's bounding rect (a polygon's outline's), die px, or null. */
export function areaBounds(area) {
  const r = regionOf(area);
  return r?.poly ? { ...r.poly.bbox } : r?.rect ? { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h } : null;
}

/**
 * Where a new piece goes, and where confinePose moves one toward when it has
 * no `from`: a rect's centre, a polygon's pole of inaccessibility (the point
 * farthest from its edges and holes; on its vertical centre line when that is
 * as good). Die px, or null for no area.
 *
 * @param {Area | null | undefined} area
 * @returns {[number, number] | null}
 */
export function areaHome(area) {
  const r = regionOf(area);
  if (r?.poly) {
    const [x, y] = poleOf(r.poly);
    return [x, y];
  }
  return r?.rect ? [r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2] : null;
}

/** Whether a die point is in an area (inside a polygon's outline and outside its holes). */
export function pointInArea(area, x, y) {
  const r = regionOf(area);
  if (r?.poly) return inside(r.poly, x, y);
  if (!r?.rect) return false;
  const q = r.rect;
  return x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
}

// ---- The rule --------------------------------------------------------------------------

/**
 * `pose` brought inside its spot.
 *
 * @param {{ cx: number, cy: number, w: number, h: number, rotation?: number }} pose
 *   die px; `w` x `h` is the unturned size at the current scale, `rotation` degrees.
 * @param {Limits} [limits]
 *   die px. Either limit may be absent (no limit). `from` (the last valid
 *   pose; its centre counts), `slide` and `home` (default: areaHome) steer a
 *   move on a polygon area, as the header says; a rect ignores them.
 * @returns {{ cx: number, cy: number, w: number, h: number, rotation: number,
 *   moved: boolean, capped: boolean, shrunk: boolean, scale: number }}
 *   `scale` is the factor the size was shrunk by (1 when it fit); `shrunk`
 *   says it was shrunk at all, `capped` that the CAP was the limit that did it
 *   (what "That's the largest this spot takes" is said for), `moved` that the
 *   centre had to move to be inside the area.
 */
export function confinePose(pose, { area = null, cap = null, from = null, home = null, slide = true } = {}) {
  const p = clean(pose);
  const region = regionOf(area);
  if (region?.poly) return confinePolygon(p, region.poly, cap, pointOf(from), pointOf(home), slide === "step" ? "step" : slide !== false);
  const rect = region?.rect ?? null;
  const ext = rotatedSize(p.w, p.h, p.rotation);
  const kCap = cap ? room(cap.w, cap.h, ext) : Infinity;
  const kArea = rect ? room(rect.w, rect.h, ext) : Infinity;
  let k = Math.min(1, kCap, kArea);
  if (k > 1 - FIT_EPS) k = 1;
  const shrunk = k < 1;
  const w = p.w * k;
  const h = p.h * k;
  let { cx, cy } = p;
  if (rect) {
    const e = rotatedSize(w, h, p.rotation);
    cx = clamp(cx, rect.x + e.w / 2, rect.x + rect.w - e.w / 2);
    cy = clamp(cy, rect.y + e.h / 2, rect.y + rect.h - e.h / 2);
  }
  const moved = Math.abs(cx - p.cx) > 1e-9 || Math.abs(cy - p.cy) > 1e-9;
  return { cx, cy, w, h, rotation: p.rotation, moved, capped: shrunk && kCap <= kArea + 1e-12, shrunk, scale: k };
}

function confinePolygon(p, P, cap, from, home, slide) {
  const e = rotatedSize(p.w, p.h, p.rotation);
  const kCap = cap ? room(cap.w, cap.h, e) : Infinity;
  // Nothing bigger than the outline's bounds fits anywhere in it.
  const kBox = room(P.bbox.w, P.bbox.h, e);
  let k = Math.min(1, kCap, kBox);
  if (k > 1 - FIT_EPS) k = 1;
  let capped = k < 1 && kCap <= kBox + 1e-12;
  const want = [p.cx, p.cy];
  const goal = home ?? poleOf(P);
  let hx = (e.w / 2) * k;
  let hy = (e.h / 2) * k;
  let at = placeAt(P, want, from, goal, hx, hy, slide);
  if (!at) {
    // Neither takes it at this size: toward where its shape fits best, as far as it must go.
    const fits = bestFor(P, hx, hy);
    if (clear(P, fits[0], fits[1], hx, hy, VALID_EPS)) at = along(P, want, fits, hx, hy);
  }
  if (!at) {
    // It fits nowhere at this size: the largest it takes there, or at one of the others if more.
    let best = 0;
    let bestAt = goal;
    for (const c of [bestFor(P, hx, hy), want, from, goal]) {
      if (!c) continue;
      const s = Math.min(1, maxScaleAt(P, c, hx, hy));
      if (s > best) {
        best = s;
        bestAt = c;
      }
    }
    // a hair under touching, so the sweeps from there have room
    const s = best * (1 - 1e-6);
    k *= s;
    hx *= s;
    hy *= s;
    capped = false;
    at = (s > 0 && placeAt(P, want, from, goal, hx, hy, slide)) || (s > 0 && clear(P, bestAt[0], bestAt[1], hx, hy, VALID_EPS) && along(P, want, bestAt, hx, hy)) || bestAt;
  }
  const moved = Math.abs(at[0] - p.cx) > 1e-9 || Math.abs(at[1] - p.cy) > 1e-9;
  return { cx: at[0], cy: at[1], w: p.w * k, h: p.h * k, rotation: p.rotation, moved, capped, shrunk: k < 1, scale: k };
}

/**
 * Whether a pose keeps both limits: its turned box within the cap, and inside
 * the area (a polygon's outline, clear of its holes), each to `tol` die px.
 *
 * @param {{ cx: number, cy: number, w: number, h: number, rotation?: number }} pose
 * @param {{ area?: Area | null, cap?: Size | null }} [limits]
 * @param {number} [tol]
 * @returns {boolean}
 */
export function poseValid(pose, { area = null, cap = null } = {}, tol = VALID_EPS) {
  const p = clean(pose);
  const e = rotatedSize(p.w, p.h, p.rotation);
  if (cap && (e.w > cap.w + tol || e.h > cap.h + tol)) return false;
  const region = regionOf(area);
  if (region?.poly) return clear(region.poly, p.cx, p.cy, e.w / 2, e.h / 2, tol);
  const r = region?.rect;
  if (!r) return true;
  return p.cx - e.w / 2 >= r.x - tol && p.cx + e.w / 2 <= r.x + r.w + tol && p.cy - e.h / 2 >= r.y - tol && p.cy + e.h / 2 <= r.y + r.h + tol;
}

/**
 * Rubber-band resistance past an edge: how far art shows past it when the
 * finger is `over` past it. Starts at BAND_C of the finger's pace and never
 * reaches `limit` (the curve iOS scroll views use). Sign follows `over`.
 *
 * @param {number} over
 * @param {number} limit
 * @returns {number}
 */
export function rubberBand(over, limit) {
  if (!(limit > 0) || !over || !Number.isFinite(over)) return 0;
  const d = Math.abs(over);
  return Math.sign(over) * limit * (1 - 1 / ((d / limit) * BAND_C + 1));
}

/**
 * The pose to SHOW while a gesture holds a piece past a limit: the confined
 * pose, plus a rubber-banded share of what the finger asked for beyond it, on
 * position (past the area's edge: each axis on a rect, along the overshoot on
 * a polygon) and on size (past the cap or the area). `limit` is the most it
 * may show past either, in die px (the placer turns a fixed 24 screen px into
 * die px where the piece is). Release commits `confinePose` of the same pose
 * and limits, not this.
 *
 * @param {{ cx: number, cy: number, w: number, h: number, rotation?: number }} pose
 * @param {Limits} [limits]
 * @param {number} [limit]
 * @returns {{ cx: number, cy: number, w: number, h: number, rotation: number,
 *   pushed: boolean, fit: ReturnType<typeof confinePose> }}
 *   `pushed`: the finger is past a limit (the area outline turns to its edge
 *   colour), and `fit` is where it settles if let go now.
 */
export function bandPose(pose, limits = {}, limit = 0) {
  const base = clean(pose);
  const fit = confinePose(base, limits ?? {});
  let k = 1;
  if (fit.shrunk) {
    // Band the axis that was over by most, then scale both sides by it, so the
    // piece keeps its aspect while it strains.
    const rb = rotatedSize(base.w, base.h, base.rotation);
    const rf = rotatedSize(fit.w, fit.h, base.rotation);
    const axis = rb.w - rf.w >= rb.h - rf.h ? "w" : "h";
    k = rb[axis] > 0 ? (rf[axis] + rubberBand(rb[axis] - rf[axis], limit)) / rb[axis] : 1;
  }
  let cx;
  let cy;
  if (regionOf(limits?.area)?.poly) {
    const vx = base.cx - fit.cx;
    const vy = base.cy - fit.cy;
    const d = Math.hypot(vx, vy);
    const b = d > 0 ? rubberBand(d, limit) / d : 0;
    cx = fit.cx + vx * b;
    cy = fit.cy + vy * b;
  } else {
    cx = fit.cx + rubberBand(base.cx - fit.cx, limit);
    cy = fit.cy + rubberBand(base.cy - fit.cy, limit);
  }
  return { cx, cy, w: base.w * k, h: base.h * k, rotation: base.rotation, pushed: fit.moved || fit.shrunk, fit };
}

/**
 * How deep a segment lies in the box [x0, x1] x [y0, y1]: the most any point
 * of it is from the box's sides (0 when it misses the box). The depth is the
 * least of four linear functions along the segment, so its most is at an end
 * of the part inside or where two of them meet.
 */
function chordDepth(ax, ay, bx, by, x0, y0, x1, y1) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  // Liang-Barsky: the part of the segment inside the box
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q <= 0) return 0;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return 0;
  }
  // depth(t) = min(x - x0, x1 - x, y - y0, y1 - y), each a + b t
  const fs = [[ax - x0, dx], [x1 - ax, -dx], [ay - y0, dy], [y1 - ay, -dy]];
  const depth = (t) => Math.max(0, Math.min(...fs.map(([a, b]) => a + b * t)));
  let best = Math.max(depth(t0), depth(t1));
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const db = fs[i][1] - fs[j][1];
      if (!db) continue;
      const t = (fs[j][0] - fs[i][0]) / db;
      if (t > t0 && t < t1) best = Math.max(best, depth(t));
    }
  }
  return best;
}

/** A turned box's overhang from a polygon area (overhang says how it is measured). */
function polygonOverhang(P, cx, cy, hx, hy) {
  let out = 0;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + sx * hx;
    const y = cy + sy * hy;
    if (!inside(P, x, y)) out = Math.max(out, distToEdges(P, x, y));
  }
  const E = P.edges;
  for (let o = 0; o < P.end; o += 6) out = Math.max(out, chordDepth(E[o], E[o + 1], E[o + 2], E[o + 3], cx - hx, cy - hy, cx + hx, cy + hy));
  return out;
}

/**
 * How far a pose breaks its spot's limits, for the server to refuse it on:
 * `area`, in die px: on a rect, the most of its turned box lying past any
 * edge of the area; on a polygon, the farthest any corner of its turned box
 * lies outside the outline or inside a hole, or the deepest any edge (an
 * outline's notch, a hole wholly under the box) lies inside the box; 0 inside.
 * `cap`, how far its turned box is over the cap as a fraction of the cap (0
 * within it, 0.25 a quarter too big on its worse side). The server picks its
 * own tolerance; float noise from a client's confinePose is well under a
 * thousandth of a px.
 *
 * @param {{ cx: number, cy: number, w: number, h: number, rotation?: number }} pose
 * @param {{ area?: Area | null, cap?: Size | null }} [limits]
 * @returns {{ area: number, cap: number }}
 */
export function overhang(pose, { area = null, cap = null } = {}) {
  const p = clean(pose);
  const ext = rotatedSize(p.w, p.h, p.rotation);
  const region = regionOf(area);
  let outside = 0;
  if (region?.poly) {
    outside = polygonOverhang(region.poly, p.cx, p.cy, ext.w / 2, ext.h / 2);
  } else if (region?.rect) {
    const r = region.rect;
    outside = Math.max(
      0,
      r.x - (p.cx - ext.w / 2),
      p.cx + ext.w / 2 - (r.x + r.w),
      r.y - (p.cy - ext.h / 2),
      p.cy + ext.h / 2 - (r.y + r.h),
    );
  }
  let over = 0;
  if (cap) {
    const ratio = (e, c) => (c > 0 ? e / c : e > 0 ? Infinity : 0);
    over = Math.max(0, ratio(ext.w, cap.w) - 1, ratio(ext.h, cap.h) - 1);
  }
  return { area: outside, cap: over };
}
