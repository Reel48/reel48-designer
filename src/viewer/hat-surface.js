// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/components/storefront/hat/hat-surface.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
/**
 * The No. 7's print spots as a map between the screen and the die, so a logo
 * can be dragged on the 3D hat itself. Pure maths: it imports nothing, touches
 * no DOM and runs in node, so tests/hat-surface.test.ts checks it against a
 * three.js camera and raycaster.
 *
 * How (the judged design): no raycast per pointer move. The camera is a 3x4
 * projection matrix P, solved once per camera change by DLT from a handful of
 * model points projected by model-viewer itself (measureProjection, one hidden
 * hotspot). setCamera(P) then projects every vertex of every print overlay
 * once and buckets the triangles that face the camera, so screenToDie is a
 * grid lookup, a point-in-triangle test and a perspective-correct barycentric:
 * a few microseconds (off the spot, a pass over the border's edges). The
 * overlays and their die pixels come from the model
 * (hat-no7-surface.json, written by scripts/blender/hat-no7/lab/extract_surface.mjs).
 *
 * Frames:
 * - Model: model-viewer's hotspot frame, which is the glTF scene with every
 *   node transform applied (the extractor says why), in metres.
 * - Die: the stage's px, 1560 x 1296 at 200 px/in, y down.
 * - Screen: CSS px from the model-viewer element's top-left, y down: what
 *   queryHotspot's canvasPosition is, and pointer clientX/Y minus the
 *   element's getBoundingClientRect() left/top.
 *
 * Which triangles count. A print material is single-sided, so the renderer
 * draws a triangle only from its counter-clockwise face (glTF; the extractor
 * checks that face against the GLB's normals). On a y-down screen that face
 * shows with a negative signed area. Separately, a face carries the print the
 * right way round only when its die winding is negative too (y-down die, so a
 * print seen from its printed side keeps its winding). The overlays are all
 * such faces; a label card is a slab whose back face carries a mirrored copy
 * and whose edges collapse in the die. A triangle is editable when it is both:
 * drawn, and a print face. Nothing else is ever returned.
 *
 * A spot's AREA and its CAP are not this module's: it maps points, and the
 * placement logic keeps a logo's box inside the area and under the cap.
 */

// ---- Settings ----------------------------------------------------------------------
// A print face's die winding: twice its signed area, y down, in index order.
const PRINT_WINDING = -1;
// Twice a triangle's area below which it is a sliver (die px^2, screen px^2).
const DIE_EPS = 1e-6;
const SCREEN_EPS = 1e-9;
// A barycentric this far below 0 still counts as inside, so a point on a shared
// edge is never lost between its two triangles.
const INSIDE_EPS = 1e-9;
// A vertex nearer the camera plane than this (metres) is treated as clipped.
const MIN_DEPTH = 1e-6;
// Die px a die point may sit outside the mesh and still map, on its nearest
// triangle's plane: the label cards' UVs stop about 0.2 px inside their rect.
const DIE_REACH = 1;
// Off the spot, the border edges within (1 + SOFT) times the nearest one's
// distance share the answer (offSpot says why).
const SOFT = 1;
// Bucket grid: about this many triangles a cell, at most GRID_MAX cells a side.
const PER_CELL = 2;
const GRID_MAX = 128;

// ---- The camera: DLT -----------------------------------------------------------------

/**
 * A 3x4 projection (row-major) from >= 6 model/screen pairs, by the normalized
 * direct linear transform (Hartley): both point sets are centred and scaled
 * before the solve, which is what keeps it exact to float precision. The null
 * vector comes from a one-sided Jacobi SVD of the design matrix itself (not
 * its normal matrix, which would square the conditioning). P is scaled so its
 * third row's first three entries are a unit vector and the left 3x3 has a
 * positive determinant: on a y-down screen w is then the depth in front of the
 * camera, in model units. The points must not all lie on one plane (a planar
 * set fixes only a homography); probePointsFor adds two off the surface.
 * `residual` is the largest reprojection error over the pairs, in screen px.
 *
 * @param {{ X: number[], s: number[] }[]} pairs
 * @returns {{ P: number[], residual: number }}
 */
export function solveProjection(pairs) {
  const n = pairs?.length ?? 0;
  if (n < 6) throw new RangeError(`solveProjection: needs at least 6 pairs, got ${n}`);
  let mx = 0, my = 0, cx = 0, cy = 0, cz = 0;
  for (const { X, s } of pairs) {
    mx += s[0]; my += s[1];
    cx += X[0]; cy += X[1]; cz += X[2];
  }
  mx /= n; my /= n; cx /= n; cy /= n; cz /= n;
  let d2 = 0, d3 = 0;
  for (const { X, s } of pairs) {
    d2 += Math.hypot(s[0] - mx, s[1] - my);
    d3 += Math.hypot(X[0] - cx, X[1] - cy, X[2] - cz);
  }
  const k2 = d2 > 0 ? (Math.SQRT2 * n) / d2 : 1;
  const k3 = d3 > 0 ? (Math.sqrt(3) * n) / d3 : 1;

  const rows = 2 * n;
  const A = new Float64Array(rows * 12);
  pairs.forEach(({ X, s }, i) => {
    const x = (X[0] - cx) * k3, y = (X[1] - cy) * k3, z = (X[2] - cz) * k3;
    const u = (s[0] - mx) * k2, v = (s[1] - my) * k2;
    const r1 = 2 * i * 12, r2 = r1 + 12;
    A[r1] = x; A[r1 + 1] = y; A[r1 + 2] = z; A[r1 + 3] = 1;
    A[r1 + 8] = -u * x; A[r1 + 9] = -u * y; A[r1 + 10] = -u * z; A[r1 + 11] = -u;
    A[r2 + 4] = x; A[r2 + 5] = y; A[r2 + 6] = z; A[r2 + 7] = 1;
    A[r2 + 8] = -v * x; A[r2 + 9] = -v * y; A[r2 + 10] = -v * z; A[r2 + 11] = -v;
  });
  const p = nullVector(A, rows, 12);

  // Undo the normalizations: P = T^-1 * Pn * U.
  const P = new Array(12);
  for (let r = 0; r < 3; r++) {
    const a = p[r * 4], b = p[r * 4 + 1], c = p[r * 4 + 2], d = p[r * 4 + 3];
    P[r * 4] = a * k3;
    P[r * 4 + 1] = b * k3;
    P[r * 4 + 2] = c * k3;
    P[r * 4 + 3] = d - k3 * (a * cx + b * cy + c * cz);
  }
  for (let col = 0; col < 4; col++) {
    const w = P[8 + col];
    P[col] = P[col] / k2 + mx * w;
    P[4 + col] = P[4 + col] / k2 + my * w;
  }
  const scale = Math.hypot(P[8], P[9], P[10]) * (det3(P) < 0 ? -1 : 1);
  if (!(Math.abs(scale) > 0)) throw new RangeError("solveProjection: degenerate pairs");
  for (let i = 0; i < 12; i++) P[i] /= scale;

  let residual = 0;
  for (const { X, s } of pairs) {
    const [sx, sy] = project(P, X);
    residual = Math.max(residual, Math.hypot(sx - s[0], sy - s[1]));
  }
  if (!Number.isFinite(residual)) throw new RangeError("solveProjection: degenerate pairs");
  return { P, residual };
}

/**
 * A model point on the screen: [sx, sy, w], w the homogeneous depth.
 * @param {number[]} P @param {number[]} X @returns {number[]}
 */
export function project(P, X) {
  const x = X[0], y = X[1], z = X[2];
  const w = P[8] * x + P[9] * y + P[10] * z + P[11];
  return [
    (P[0] * x + P[1] * y + P[2] * z + P[3]) / w,
    (P[4] * x + P[5] * y + P[6] * z + P[7]) / w,
    w,
  ];
}

/** The left 3x3's determinant of a row-major 3x4. */
function det3(P) {
  return (
    P[0] * (P[5] * P[10] - P[6] * P[9]) -
    P[1] * (P[4] * P[10] - P[6] * P[8]) +
    P[2] * (P[4] * P[9] - P[5] * P[8])
  );
}

/**
 * The right singular vector of the smallest singular value of A (rows x cols,
 * row-major), by one-sided Jacobi: rotate column pairs until all are
 * orthogonal; the shortest column then marks the null direction.
 */
function nullVector(A, rows, cols) {
  const U = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) U[j * rows + i] = A[i * cols + j];
  const V = new Float64Array(cols * cols);
  for (let j = 0; j < cols; j++) V[j * cols + j] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < cols - 1; p++) {
      for (let q = p + 1; q < cols; q++) {
        const op = p * rows, oq = q * rows;
        let a = 0, b = 0, g = 0;
        for (let i = 0; i < rows; i++) {
          const x = U[op + i], y = U[oq + i];
          a += x * x; b += y * y; g += x * y;
        }
        if (Math.abs(g) <= 1e-15 * Math.sqrt(a * b)) continue;
        rotated = true;
        const zeta = (b - a) / (2 * g);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < rows; i++) {
          const x = U[op + i], y = U[oq + i];
          U[op + i] = c * x - s * y;
          U[oq + i] = s * x + c * y;
        }
        const vp = p * cols, vq = q * cols;
        for (let i = 0; i < cols; i++) {
          const x = V[vp + i], y = V[vq + i];
          V[vp + i] = c * x - s * y;
          V[vq + i] = s * x + c * y;
        }
      }
    }
    if (!rotated) break;
  }
  let best = 0, bestNorm = Infinity;
  for (let j = 0; j < cols; j++) {
    let s = 0;
    for (let i = 0; i < rows; i++) s += U[j * rows + i] ** 2;
    if (s < bestNorm) { bestNorm = s; best = j; }
  }
  return Array.from(V.subarray(best * cols, best * cols + cols));
}

// ---- The surface ---------------------------------------------------------------------

/**
 * The map for a surface JSON (hat-no7-surface.json). Every method takes a zone
 * id of `zoneIds` (an unknown one throws). Until setCamera, the screen methods
 * return null; the die-to-model ones work from the start.
 *
 * @param {{ model?: string, frame: { width: number, height: number },
 *   zones: Record<string, { material?: string, positions: number[], uvs: number[], indices: number[] }> }} json
 */
export function createSurface(json) {
  if (!json || !json.frame || !json.zones) throw new TypeError("createSurface: not a surface JSON");
  /** @type {Map<string, any>} */
  const zones = new Map();
  for (const [id, z] of Object.entries(json.zones)) zones.set(id, buildZone(z));
  /** @type {number[] | null} */
  let camera = null;

  const zoneOf = (id) => {
    const z = zones.get(id);
    if (!z) throw new RangeError(`hat-surface: no zone "${id}"`);
    return z;
  };

  return {
    model: json.model ?? null,
    frame: { width: json.frame.width, height: json.frame.height },
    zoneIds: Object.freeze([...zones.keys()]),

    /**
     * Takes the camera (a P from solveProjection or measureProjection; any
     * nonzero multiple of it is the same camera), or null to drop it. Projects
     * every vertex once and buckets each zone's editable triangles.
     * @param {number[] | null} P
     */
    setCamera(P) {
      if (P == null) {
        camera = null;
        for (const z of zones.values()) z.cam = null;
        return;
      }
      if (P.length !== 12 || !P.every(Number.isFinite)) throw new TypeError("setCamera: P is 12 finite numbers");
      // solveProjection's scale: w in metres, and the sign that puts the scene
      // in front of the camera on a y-down screen.
      const norm = Math.hypot(P[8], P[9], P[10]);
      if (!(norm > 0)) throw new RangeError("setCamera: P is not a perspective camera");
      const k = (det3(P) < 0 ? -1 : 1) / norm;
      camera = P.map((v) => v * k);
      for (const z of zones.values()) z.cam = projectZone(z, camera);
    },

    /**
     * The die point under a screen point: { x, y, inside, tri }, `tri` the
     * zone's triangle. Inside an editable triangle the barycentrics are
     * perspective-correct (exact on the triangle). Off the zone, with
     * `extrapolate` (the default), `inside` is false and the answer carries on
     * from the border: the die point of the border's nearest point, plus the
     * rest of the way at the spot's average die px per screen px (offSpot).
     * It is continuous, meets the inside map at the border, and stays within
     * about that average gain times the distance off the spot, so a drag that
     * leaves the spot keeps moving smoothly and the placement clamps it to the
     * area. Null with no camera, no editable triangle, or off the zone without
     * `extrapolate`.
     * @param {string} zoneId @param {number} sx @param {number} sy
     * @param {{ extrapolate?: boolean }} [options]
     */
    screenToDie(zoneId, sx, sy, { extrapolate = true } = {}) {
      const z = zoneOf(zoneId);
      const cam = z.cam;
      if (!cam || !cam.count) return null;
      // The containing triangle nearest the camera: a whole panel seen from the
      // side folds over itself (round E1's front by the bill, a side by the
      // button), and the first triangle found can be the hidden layer.
      let t = -1;
      let near = -Infinity;
      const g = cam.grid;
      const cell = cellAt(g, sx, sy);
      if (cell >= 0) {
        for (let k = g.start[cell], end = g.start[cell + 1]; k < end; k++) {
          const c = g.items[k];
          if (!screenInside(cam, c, sx, sy)) continue;
          const n = nearnessAt(z, cam, c, sx, sy);
          if (n > near) {
            near = n;
            t = c;
          }
        }
      }
      if (t >= 0) {
        cam.last = t;
        const [x, y] = dieAtScreen(z, cam, t, sx, sy);
        return { x, y, inside: true, tri: t };
      }
      if (!extrapolate) return null;
      const off = offSpot(z, cam, sx, sy);
      return off && { x: off[0], y: off[1], inside: false, tri: off[2] };
    },

    /**
     * Where a die point shows on the screen: [sx, sy], or null with no camera,
     * off the zone's print faces (beyond `reach` die px), or behind the camera.
     * It does not say whether that face is turned to the camera: frontFacing
     * on the triangle does, or a screenToDie round trip.
     * @param {string} zoneId @param {number} dx @param {number} dy
     * @param {{ reach?: number }} [options]
     */
    dieToScreen(zoneId, dx, dy, { reach = DIE_REACH } = {}) {
      if (!camera) return null;
      const X = modelAtDie(zoneOf(zoneId), dx, dy, reach);
      if (!X) return null;
      const [sx, sy, w] = project(camera, X);
      return w > MIN_DEPTH ? [sx, sy] : null;
    },

    /**
     * The model point (metres, hotspot frame) a die point is printed at, or null
     * off the zone's print faces (beyond `reach` die px).
     * @param {string} zoneId @param {number} dx @param {number} dy
     * @param {{ reach?: number }} [options]
     */
    dieToModel(zoneId, dx, dy, { reach = DIE_REACH } = {}) {
      return modelAtDie(zoneOf(zoneId), dx, dy, reach);
    },

    /**
     * Screen px per die px at a die point: [[dsx/ddx, dsx/ddy], [dsy/ddx, dsy/ddy]].
     * Exact (the die-to-model map is affine on a triangle, then the projection's
     * own derivative), so a dragged sprite can be drawn with this local affine.
     * Null where dieToScreen is.
     * @param {string} zoneId @param {number} dx @param {number} dy
     */
    jacobian(zoneId, dx, dy) {
      if (!camera) return null;
      const z = zoneOf(zoneId);
      const hit = locateDie(z, dx, dy, DIE_REACH);
      if (!hit) return null;
      const X = modelAt(z, hit);
      const P = camera;
      const w = P[8] * X[0] + P[9] * X[1] + P[10] * X[2] + P[11];
      if (!(w > MIN_DEPTH)) return null;
      const sx = (P[0] * X[0] + P[1] * X[1] + P[2] * X[2] + P[3]) / w;
      const sy = (P[4] * X[0] + P[5] * X[1] + P[6] * X[2] + P[7]) / w;
      // dX/d(die) on the triangle: (X1 - X0) * dl1/d(die) + (X2 - X0) * dl2/d(die).
      const t = hit.t, inv = z.dieInv, o = t * 6;
      const [a, b, c] = triVerts(z, t);
      const E = [[0, 0], [0, 0], [0, 0]];
      for (let k = 0; k < 3; k++) {
        const e1 = z.pos[3 * b + k] - z.pos[3 * a + k];
        const e2 = z.pos[3 * c + k] - z.pos[3 * a + k];
        E[k][0] = e1 * inv[o + 2] + e2 * inv[o + 4];
        E[k][1] = e1 * inv[o + 3] + e2 * inv[o + 5];
      }
      const gx = [(P[0] - sx * P[8]) / w, (P[1] - sx * P[9]) / w, (P[2] - sx * P[10]) / w];
      const gy = [(P[4] - sy * P[8]) / w, (P[5] - sy * P[9]) / w, (P[6] - sy * P[10]) / w];
      const dot = (g, j) => g[0] * E[0][j] + g[1] * E[1][j] + g[2] * E[2][j];
      return [[dot(gx, 0), dot(gx, 1)], [dot(gy, 0), dot(gy, 1)]];
    },

    /**
     * The zone's print faces' extent in die px, { x, y, w, h } like a die rect.
     * The overlays carry about 5 mm of bleed past their rect; the label cards
     * stop about 0.2 px inside theirs.
     * @param {string} zoneId
     */
    bounds(zoneId) {
      const { bounds } = zoneOf(zoneId);
      return { ...bounds };
    },

    /** The zone's outward unit normal (area-weighted over its print faces), model frame. */
    normal(zoneId) {
      return zoneOf(zoneId).normal.slice();
    },

    /** Whether a triangle is editable under the current camera: a print face, drawn. */
    frontFacing(zoneId, tri) {
      const cam = zoneOf(zoneId).cam;
      return !!(cam && cam.front[tri]);
    },

    /**
     * The share of the zone's print area (in die px) on triangles that face the
     * camera, 0..1: 0 with no camera or a spot turned away. Ignores what else on
     * the hat might hide it.
     */
    facingFraction(zoneId) {
      const cam = zoneOf(zoneId).cam;
      return cam ? cam.facing : 0;
    },
  };
}

/** A zone's typed arrays, its print faces' die maps, its bounds and its edges. */
function buildZone(src) {
  const pos = Float64Array.from(src.positions);
  const uv = Float64Array.from(src.uvs);
  const idx = Uint32Array.from(src.indices);
  const nV = pos.length / 3, nT = idx.length / 3;
  if (uv.length !== nV * 2 || !Number.isInteger(nT)) throw new TypeError("hat-surface: zone arrays do not match");

  const print = new Uint8Array(nT);
  const dieArea = new Float64Array(nT);
  // Per print face: u0, v0, then the inverse of [e1 e2] (die), row-major.
  const dieInv = new Float64Array(nT * 6);
  const dieBox = new Float64Array(nT * 4);
  const printIds = [];
  const normal = [0, 0, 0];
  let printArea = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let t = 0; t < nT; t++) {
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    const u0 = uv[2 * a], v0 = uv[2 * a + 1];
    const e1u = uv[2 * b] - u0, e1v = uv[2 * b + 1] - v0;
    const e2u = uv[2 * c] - u0, e2v = uv[2 * c + 1] - v0;
    const det = e1u * e2v - e1v * e2u;
    if (det * PRINT_WINDING <= DIE_EPS) continue;
    print[t] = 1;
    printIds.push(t);
    dieArea[t] = Math.abs(det) / 2;
    printArea += dieArea[t];
    const o = t * 6;
    dieInv[o] = u0; dieInv[o + 1] = v0;
    dieInv[o + 2] = e2v / det; dieInv[o + 3] = -e2u / det;
    dieInv[o + 4] = -e1v / det; dieInv[o + 5] = e1u / det;
    const us = [uv[2 * a], uv[2 * b], uv[2 * c]], vs = [uv[2 * a + 1], uv[2 * b + 1], uv[2 * c + 1]];
    dieBox[4 * t] = Math.min(...us); dieBox[4 * t + 1] = Math.min(...vs);
    dieBox[4 * t + 2] = Math.max(...us); dieBox[4 * t + 3] = Math.max(...vs);
    minX = Math.min(minX, dieBox[4 * t]); minY = Math.min(minY, dieBox[4 * t + 1]);
    maxX = Math.max(maxX, dieBox[4 * t + 2]); maxY = Math.max(maxY, dieBox[4 * t + 3]);
    // The counter-clockwise face is the outward one; its edges' cross product
    // (twice its area) sums to an area-weighted normal.
    const f1 = [0, 1, 2].map((k) => pos[3 * b + k] - pos[3 * a + k]);
    const f2 = [0, 1, 2].map((k) => pos[3 * c + k] - pos[3 * a + k]);
    normal[0] += f1[1] * f2[2] - f1[2] * f2[1];
    normal[1] += f1[2] * f2[0] - f1[0] * f2[2];
    normal[2] += f1[0] * f2[1] - f1[1] * f2[0];
  }
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;

  // Edges between welded vertices (the overlays split vertices along hard
  // edges), so the editable set's border is known for extrapolation.
  const weld = new Int32Array(nV);
  const keys = new Map();
  for (let v = 0; v < nV; v++) {
    const key = `${pos[3 * v]},${pos[3 * v + 1]},${pos[3 * v + 2]}`;
    let w = keys.get(key);
    if (w === undefined) { w = keys.size; keys.set(key, w); }
    weld[v] = w;
  }
  const nW = keys.size;
  const edgeIds = new Map();
  /** @type {number[][]} */
  const edgeTris = [];
  const triEdge = new Int32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const a = weld[idx[3 * t + k]], b = weld[idx[3 * t + ((k + 1) % 3)]];
      const key = a < b ? a * nW + b : b * nW + a;
      let e = edgeIds.get(key);
      if (e === undefined) { e = edgeTris.length; edgeIds.set(key, e); edgeTris.push([]); }
      edgeTris[e].push(t);
      triEdge[3 * t + k] = e;
    }
  }

  return {
    pos, uv, idx, nV, nT, print, dieArea, dieInv, dieBox, printArea, triEdge, edgeTris,
    printIds: Int32Array.from(printIds),
    normal: normal.map((v) => v / len),
    bounds: printIds.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 },
    dieGrid: null,
    dieLast: -1,
    cam: null,
  };
}

function triVerts(z, t) {
  return [z.idx[3 * t], z.idx[3 * t + 1], z.idx[3 * t + 2]];
}

/** A zone under a camera: projected vertices and the editable triangles' screen maps. */
function projectZone(z, P) {
  const { pos, nV, nT, idx, print } = z;
  const sx = new Float64Array(nV), sy = new Float64Array(nV), iw = new Float64Array(nV);
  for (let v = 0; v < nV; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], zc = pos[3 * v + 2];
    const w = P[8] * x + P[9] * y + P[10] * zc + P[11];
    if (!(w > MIN_DEPTH)) continue; // iw stays 0: clipped
    iw[v] = 1 / w;
    sx[v] = (P[0] * x + P[1] * y + P[2] * zc + P[3]) * iw[v];
    sy[v] = (P[4] * x + P[5] * y + P[6] * zc + P[7]) * iw[v];
  }
  const front = new Uint8Array(nT);
  // Per editable triangle: x0, y0, then the inverse of [e1 e2] (screen), row-major.
  const inv = new Float64Array(nT * 6);
  const box = new Float64Array(nT * 4);
  const ids = [];
  const uv = z.uv;
  let facing = 0;
  // The editable triangles' screen-to-die maps, summed by screen area (below).
  let m0 = 0, m1 = 0, m2 = 0, m3 = 0, seen = 0;
  for (let t = 0; t < nT; t++) {
    if (!print[t]) continue;
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    if (!iw[a] || !iw[b] || !iw[c]) continue;
    const x0 = sx[a], y0 = sy[a];
    const e1x = sx[b] - x0, e1y = sy[b] - y0, e2x = sx[c] - x0, e2y = sy[c] - y0;
    const det = e1x * e2y - e1y * e2x;
    // Drawn: its counter-clockwise face toward the camera, a negative area on a
    // y-down screen. An edge-on sliver covers nothing and is skipped.
    if (!(det < -SCREEN_EPS)) continue;
    front[t] = 1;
    ids.push(t);
    facing += z.dieArea[t];
    const o = t * 6;
    inv[o] = x0; inv[o + 1] = y0;
    inv[o + 2] = e2y / det; inv[o + 3] = -e2x / det;
    inv[o + 4] = -e1y / det; inv[o + 5] = e1x / det;
    box[4 * t] = Math.min(x0, sx[b], sx[c]); box[4 * t + 1] = Math.min(y0, sy[b], sy[c]);
    box[4 * t + 2] = Math.max(x0, sx[b], sx[c]); box[4 * t + 3] = Math.max(y0, sy[b], sy[c]);
    // die = die0 + l1 * f1 + l2 * f2 with l = inv * (screen - screen0); times
    // the screen area (-det / 2) the 1 / det cancels, so a near edge-on sliver
    // adds no more than its length's worth, however steep its own map is.
    const f1u = uv[2 * b] - uv[2 * a], f1v = uv[2 * b + 1] - uv[2 * a + 1];
    const f2u = uv[2 * c] - uv[2 * a], f2v = uv[2 * c + 1] - uv[2 * a + 1];
    m0 += (f2u * e1y - f1u * e2y) / 2; m1 += (f1u * e2x - f2u * e1x) / 2;
    m2 += (f2v * e1y - f1v * e2y) / 2; m3 += (f1v * e2x - f2v * e1x) / 2;
    seen -= det / 2;
  }
  // The border of the editable set: the edges no other editable triangle
  // shares, as (triangle, vertex, vertex). The point of the set nearest a
  // point off it is always on one of these.
  const border = [];
  for (const t of ids) {
    for (let k = 0; k < 3; k++) {
      const others = z.edgeTris[z.triEdge[3 * t + k]];
      if (!others.some((o) => o !== t && front[o])) border.push(t, idx[3 * t + k], idx[3 * t + ((k + 1) % 3)]);
    }
  }
  return {
    sx, sy, iw, front, inv, box,
    count: ids.length,
    grid: makeGrid(box, ids),
    border: Int32Array.from(border),
    facing: z.printArea > 0 ? facing / z.printArea : 0,
    // Die px per screen px, the spot's average as seen ([ddx/dsx, ddx/dsy,
    // ddy/dsx, ddy/dsy]): one fixed map for motion off the spot, so it never
    // takes on a single border triangle's steepness.
    drift: seen > 0 ? [m0 / seen, m1 / seen, m2 / seen, m3 / seen] : [0, 0, 0, 0],
    last: -1,
    lastNear: -1,
  };
}

function screenInside(cam, t, x, y) {
  const o = t * 6, inv = cam.inv;
  const dx = x - inv[o], dy = y - inv[o + 1];
  const l1 = inv[o + 2] * dx + inv[o + 3] * dy;
  const l2 = inv[o + 4] * dx + inv[o + 5] * dy;
  return l1 >= -INSIDE_EPS && l2 >= -INSIDE_EPS && 1 - l1 - l2 >= -INSIDE_EPS;
}

/** 1/w at a screen point on triangle t (perspective-correct): larger is nearer the camera. */
function nearnessAt(z, cam, t, x, y) {
  const o = t * 6, inv = cam.inv;
  const dx = x - inv[o], dy = y - inv[o + 1];
  const l1 = inv[o + 2] * dx + inv[o + 3] * dy;
  const l2 = inv[o + 4] * dx + inv[o + 5] * dy;
  const [a, b, c] = triVerts(z, t);
  return (1 - l1 - l2) * cam.iw[a] + l1 * cam.iw[b] + l2 * cam.iw[c];
}

/**
 * The die point at a screen point on triangle t: the screen barycentrics
 * weighted by 1/w (perspective-correct, exact for a true projection).
 */
function dieAtScreen(z, cam, t, x, y) {
  const o = t * 6, inv = cam.inv;
  const dx = x - inv[o], dy = y - inv[o + 1];
  const l1 = inv[o + 2] * dx + inv[o + 3] * dy;
  const l2 = inv[o + 4] * dx + inv[o + 5] * dy;
  const [a, b, c] = triVerts(z, t);
  const q0 = (1 - l1 - l2) * cam.iw[a], q1 = l1 * cam.iw[b], q2 = l2 * cam.iw[c];
  const sum = q0 + q1 + q2;
  const uv = z.uv;
  return [
    (q0 * uv[2 * a] + q1 * uv[2 * b] + q2 * uv[2 * c]) / sum,
    (q0 * uv[2 * a + 1] + q1 * uv[2 * b + 1] + q2 * uv[2 * c + 1]) / sum,
  ];
}

/**
 * The die point for a screen point off the editable set: [x, y, tri].
 *
 * Each border edge gives one answer: the die point of the edge's point q
 * nearest the pointer (perspective-correct along the edge, so exact and
 * continuous on the border), carried on by the spot's average map (`drift`)
 * for the rest of the way, pointer - q. So the answer is never farther from
 * the spot's die extent than |drift| times (1 + SOFT) times the pointer's
 * distance from it, however thin or steep a border triangle is.
 *
 * One edge alone, the nearest, would jump wherever two edges are equally
 * near: past every notch of a border that wobbles in screen px, which a
 * curved card's does. So every edge within (1 + SOFT) times the nearest
 * distance counts, weighted down to 0 at that limit; the weights change
 * smoothly with the pointer, and so does the answer. On the border itself
 * only the edges through the point count, all of which give its own die
 * point, so it meets the inside map with no step.
 */
function offSpot(z, cam, x, y) {
  const { border, sx, sy, iw, drift: m } = cam;
  const uv = z.uv;
  const n = border.length / 3;
  if (!n) return null;
  /** Squared distance to an edge's box: a lower bound on its distance. */
  const boxD2 = (e) => {
    const a = border[3 * e + 1], b = border[3 * e + 2];
    const bx = Math.max(Math.min(sx[a], sx[b]) - x, 0, x - Math.max(sx[a], sx[b]));
    const by = Math.max(Math.min(sy[a], sy[b]) - y, 0, y - Math.max(sy[a], sy[b]));
    return bx * bx + by * by;
  };
  /** The edge's nearest point as its parameter s from its first vertex, and the squared distance. */
  let s = 0;
  const edgeD2 = (e) => {
    const a = border[3 * e + 1], b = border[3 * e + 2];
    const vx = sx[b] - sx[a], vy = sy[b] - sy[a];
    const L = vx * vx + vy * vy;
    s = L > 0 ? ((x - sx[a]) * vx + (y - sy[a]) * vy) / L : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const qx = sx[a] + s * vx - x, qy = sy[a] + s * vy - y;
    return qx * qx + qy * qy;
  };

  // The nearest edge: the last one first (a drag moves a little at a time),
  // then every edge whose box is not already farther.
  let near = cam.lastNear < n ? cam.lastNear : -1;
  let best = near >= 0 ? edgeD2(near) : Infinity;
  for (let e = 0; e < n; e++) {
    if (boxD2(e) >= best) continue;
    const d = edgeD2(e);
    if (d < best) { best = d; near = e; }
  }
  cam.lastNear = near;
  const d0 = Math.sqrt(best);
  const reach = d0 * (1 + SOFT);

  let W = 0, ox = 0, oy = 0;
  const add = (e, w) => {
    const a = border[3 * e + 1], b = border[3 * e + 2];
    const qx = sx[a] + s * (sx[b] - sx[a]), qy = sy[a] + s * (sy[b] - sy[a]);
    const wa = (1 - s) * iw[a], wb = s * iw[b];
    const dx = (wa * uv[2 * a] + wb * uv[2 * b]) / (wa + wb);
    const dy = (wa * uv[2 * a + 1] + wb * uv[2 * b + 1]) / (wa + wb);
    // die(q) + drift (p - q), less drift p (added once, below).
    ox += w * (dx - m[0] * qx - m[1] * qy);
    oy += w * (dy - m[2] * qx - m[3] * qy);
    W += w;
  };
  if (d0 > 1e-9) {
    for (let e = 0; e < n; e++) {
      if (boxD2(e) >= reach * reach) continue;
      const d = Math.sqrt(edgeD2(e));
      if (d >= reach) continue;
      const f = 1 - (d - d0) / (reach - d0);
      add(e, f * f);
    }
  }
  if (!(W > 0)) {
    edgeD2(near);
    add(near, 1);
  }
  return [m[0] * x + m[1] * y + ox / W, m[2] * x + m[3] * y + oy / W, border[3 * near]];
}

/** Squared distance from (x, y) to the triangle (x0, y0), (x1, y1), (x2, y2). */
function triDistance2(x, y, x0, y0, x1, y1, x2, y2) {
  const e1x = x1 - x0, e1y = y1 - y0, e2x = x2 - x0, e2y = y2 - y0;
  const det = e1x * e2y - e1y * e2x;
  const px = x - x0, py = y - y0;
  const l1 = (e2y * px - e2x * py) / det, l2 = (-e1y * px + e1x * py) / det;
  if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return 0;
  return Math.min(seg2(x, y, x0, y0, x1, y1), seg2(x, y, x1, y1, x2, y2), seg2(x, y, x2, y2, x0, y0));
}

function seg2(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? ((x - ax) * vx + (y - ay) * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * vx - x, qy = ay + t * vy - y;
  return qx * qx + qy * qy;
}

// ---- Die lookups -----------------------------------------------------------------------

/** The print face holding a die point (or the nearest within `reach`), with its barycentrics. */
function locateDie(z, dx, dy, reach) {
  if (!z.printIds.length) return null;
  if (!z.dieGrid) z.dieGrid = makeGrid(z.dieBox, z.printIds);
  if (z.dieLast >= 0) {
    const hit = dieBary(z, z.dieLast, dx, dy);
    if (hit.inside) return hit;
  }
  const g = z.dieGrid;
  const cell = cellAt(g, dx, dy);
  if (cell >= 0) {
    for (let k = g.start[cell], end = g.start[cell + 1]; k < end; k++) {
      const hit = dieBary(z, g.items[k], dx, dy);
      if (hit.inside) { z.dieLast = hit.t; return hit; }
    }
  }
  if (!(reach > 0)) return null;
  let best = null, bestD = reach * reach;
  forCells(g, dx - reach, dy - reach, dx + reach, dy + reach, (t) => {
    const [a, b, c] = triVerts(z, t);
    const uv = z.uv;
    const d = triDistance2(dx, dy, uv[2 * a], uv[2 * a + 1], uv[2 * b], uv[2 * b + 1], uv[2 * c], uv[2 * c + 1]);
    if (d <= bestD) { bestD = d; best = t; }
  });
  return best === null ? null : dieBary(z, best, dx, dy);
}

function dieBary(z, t, dx, dy) {
  const o = t * 6, inv = z.dieInv;
  const px = dx - inv[o], py = dy - inv[o + 1];
  const l1 = inv[o + 2] * px + inv[o + 3] * py;
  const l2 = inv[o + 4] * px + inv[o + 5] * py;
  const l0 = 1 - l1 - l2;
  return { t, l0, l1, l2, inside: l0 >= -INSIDE_EPS && l1 >= -INSIDE_EPS && l2 >= -INSIDE_EPS };
}

/** UV is linear over each triangle in 3D, so die barycentrics are model barycentrics. */
function modelAt(z, hit) {
  const [a, b, c] = triVerts(z, hit.t);
  const p = z.pos;
  return [0, 1, 2].map((k) => hit.l0 * p[3 * a + k] + hit.l1 * p[3 * b + k] + hit.l2 * p[3 * c + k]);
}

function modelAtDie(z, dx, dy, reach) {
  const hit = locateDie(z, dx, dy, reach);
  return hit ? modelAt(z, hit) : null;
}

// ---- Bucket grid ------------------------------------------------------------------------

/**
 * A uniform grid over the boxes of `ids` (4 numbers a triangle in `boxes`),
 * each cell listing the triangles whose box touches it (CSR: start, items).
 */
function makeGrid(boxes, ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of ids) {
    minX = Math.min(minX, boxes[4 * t]); minY = Math.min(minY, boxes[4 * t + 1]);
    maxX = Math.max(maxX, boxes[4 * t + 2]); maxY = Math.max(maxY, boxes[4 * t + 3]);
  }
  if (!ids.length) return { minX: 0, minY: 0, kx: 0, ky: 0, nx: 0, ny: 0, start: new Int32Array(1), items: new Int32Array(0) };
  const spanX = Math.max(maxX - minX, 1e-9), spanY = Math.max(maxY - minY, 1e-9);
  const cells = Math.max(1, ids.length / PER_CELL);
  const nx = Math.min(GRID_MAX, Math.max(1, Math.round(Math.sqrt((cells * spanX) / spanY))));
  const ny = Math.min(GRID_MAX, Math.max(1, Math.round(cells / nx)));
  const grid = { minX, minY, kx: nx / spanX, ky: ny / spanY, nx, ny, start: new Int32Array(nx * ny + 1), items: null };
  const counts = grid.start;
  for (const t of ids) forBox(grid, boxes, t, (cell) => { counts[cell + 1]++; });
  for (let i = 0; i < nx * ny; i++) counts[i + 1] += counts[i];
  const fill = counts.slice(0, nx * ny);
  const items = new Int32Array(counts[nx * ny]);
  for (const t of ids) forBox(grid, boxes, t, (cell) => { items[fill[cell]++] = t; });
  grid.items = items;
  return grid;
}

function clampCell(v, n) {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

function forBox(g, boxes, t, fn) {
  const x0 = clampCell(Math.floor((boxes[4 * t] - g.minX) * g.kx), g.nx);
  const y0 = clampCell(Math.floor((boxes[4 * t + 1] - g.minY) * g.ky), g.ny);
  const x1 = clampCell(Math.floor((boxes[4 * t + 2] - g.minX) * g.kx), g.nx);
  const y1 = clampCell(Math.floor((boxes[4 * t + 3] - g.minY) * g.ky), g.ny);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) fn(j * g.nx + i);
}

/** The cell holding a point, or -1 outside the grid. */
function cellAt(g, x, y) {
  const i = Math.floor((x - g.minX) * g.kx), j = Math.floor((y - g.minY) * g.ky);
  if (i < 0 || j < 0 || i > g.nx || j > g.ny) return -1;
  // A point exactly on the far edge belongs to the last cell.
  return clampCell(j, g.ny) * g.nx + clampCell(i, g.nx);
}

/** Every triangle listed in the cells a box touches (a triangle may come twice). */
function forCells(g, x0, y0, x1, y1, fn) {
  if (x1 < g.minX || y1 < g.minY || x0 > g.minX + g.nx / g.kx || y0 > g.minY + g.ny / g.ky) return;
  const i0 = clampCell(Math.floor((x0 - g.minX) * g.kx), g.nx), i1 = clampCell(Math.floor((x1 - g.minX) * g.kx), g.nx);
  const j0 = clampCell(Math.floor((y0 - g.minY) * g.ky), g.ny), j1 = clampCell(Math.floor((y1 - g.minY) * g.ky), g.ny);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cell = j * g.nx + i;
      for (let k = g.start[cell], end = g.start[cell + 1]; k < end; k++) fn(g.items[k]);
    }
  }
}

// ---- Measuring model-viewer's camera ----------------------------------------------------

/**
 * Solves model-viewer's current camera by moving one hidden hotspot through
 * model points and reading back where it projects. The host renders a child of
 * the element, once, before it is needed:
 *   <div slot="hotspot-probe" data-position="0m 0m 0m" hidden></div>
 * (model-viewer registers hotspots from a MutationObserver, so a child added in
 * the same task is not there yet; a missing hotspot returns null here).
 *
 * What model-viewer 4.2.0 does (lib/features/annotation.js, Hotspot.js,
 * ModelScene.js):
 * - updateHotspot({ name, position }) parses "x y z" (metres) and calls the
 *   hotspot's updateMatrixWorld() at once, from its parent's matrixWorld; then
 *   queryHotspot(name) projects matrixWorld with the camera. Both are
 *   synchronous, so this whole measurement runs in one call, with no frame in
 *   between. `name` is the full slot name, "hotspot-probe" (a bare "probe" is
 *   accepted here and prefixed).
 * - The hotspot is a child of the scene's `target`, beside the model, so
 *   `position` is in the model's own glTF frame (the surface JSON's frame).
 * - canvasPosition is CSS px from the element's top-left (scene width/height
 *   are the element's CSS size), y down; its z is NDC depth, kept in -1..1
 *   for a point between the near and far planes.
 * - The camera's matrices are refreshed when a frame renders. camera-change
 *   fires inside model-viewer's tick, before that frame renders, so a probe
 *   right then reads the previous frame. Measure in a requestAnimationFrame
 *   callback after camera-change (or once the camera rests): it then matches
 *   the frame on screen.
 * - Each updateHotspot asks for one more render (cheap, but not free), and the
 *   hotspot stays at the last point.
 *
 * Returns { P, residual } (solveProjection), or null when the element has no
 * hotspot API or hotspot, or fewer than 6 points project between the planes.
 *
 * @param {any} mv the <model-viewer> element
 * @param {number[][]} points model points (metres), not all on one plane
 * @param {{ name?: string }} [options]
 */
export function measureProjection(mv, points, { name = "probe" } = {}) {
  if (!mv || typeof mv.updateHotspot !== "function" || typeof mv.queryHotspot !== "function") return null;
  const slot = name.startsWith("hotspot") ? name : `hotspot-${name}`;
  const pairs = [];
  for (const point of points) {
    // Written at 0.1 um, and the pair uses exactly the numbers written, so the
    // solve sees what model-viewer parsed.
    const X = point.map((v) => Number(v.toFixed(7)));
    mv.updateHotspot({ name: slot, position: `${X[0].toFixed(7)}m ${X[1].toFixed(7)}m ${X[2].toFixed(7)}m` });
    const hit = mv.queryHotspot(slot);
    const c = hit?.canvasPosition;
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !(c.z >= -1 && c.z <= 1)) continue;
    pairs.push({ X, s: [c.x, c.y] });
  }
  if (pairs.length < 6) return null;
  try {
    return solveProjection(pairs);
  } catch {
    return null;
  }
}

/**
 * About ten model points to measure the camera by, spread over a zone: the
 * centre, the corners and the long edges' midpoints of its print extent (12%
 * in, so they land on the mesh), then, last, three points off the surface
 * along its normal, a quarter of its size away.
 *
 * Why three, at three different surface points. DLT has critical sets, where
 * many cameras fit the pairs equally and the solve fails: points on one plane
 * plus points on one line through the camera centre (Hartley & Zisserman
 * 22.1.2). A label card is all but flat, and any two points lie on one line,
 * which a camera can sit on: centre +- normal, the old pair, was the very line
 * a square-on view looks down. Three points not on one line cannot all lie on
 * a line through the camera, so no view is critical. They sit over three
 * spread surface points, one of them on the far side, which keeps them off
 * one line even on a flat card.
 * @param {ReturnType<typeof createSurface>} surface @param {string} zoneId
 * @returns {number[][]}
 */
export function probePointsFor(surface, zoneId) {
  const b = surface.bounds(zoneId);
  const at = (fx, fy) => surface.dieToModel(zoneId, b.x + fx * b.w, b.y + fy * b.h);
  const spots = [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88], [0.5, 0.12], [0.5, 0.88]];
  let points = spots.map(([fx, fy]) => at(fx, fy)).filter(Boolean);
  if (points.length < 5) {
    // A zone with holes or an odd outline: scan a grid instead.
    points = [];
    for (let j = 1; j < 8; j++) for (let i = 1; i < 8; i++) {
      const p = at(i / 8, j / 8);
      if (p) points.push(p);
    }
    points = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 7)) === 0).slice(0, 7);
  }
  if (!points.length) return [];
  const centre = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k], 0) / points.length);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const farthest = (score) => points.reduce((best, p) => (score(p) > score(best) ? p : best), points[0]);
  // Three spread surface points: the one farthest from the centre, the one
  // farthest from it, and the one farthest from the line through both.
  const p1 = farthest((p) => dist(p, centre));
  const p2 = farthest((p) => dist(p, p1));
  const span = dist(p1, p2) || 1;
  const u = [0, 1, 2].map((k) => (p2[k] - p1[k]) / span);
  const p3 = farthest((p) => {
    const t = [0, 1, 2].map((k) => p[k] - p1[k]);
    const along = t[0] * u[0] + t[1] * u[1] + t[2] * u[2];
    return Math.hypot(t[0] - along * u[0], t[1] - along * u[1], t[2] - along * u[2]);
  });
  const n = surface.normal(zoneId);
  const off = 0.25 * span;
  points.push(
    p1.map((v, k) => v + n[k] * off),
    p3.map((v, k) => v - n[k] * off),
    p2.map((v, k) => v + n[k] * off),
  );
  return points;
}
