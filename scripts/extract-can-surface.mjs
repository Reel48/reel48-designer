#!/usr/bin/env node
/**
 * The can cooler's print surface, out of its GLB, for editing on the 3D can
 * (src/viewer/can-edit.js, with hat-surface.js's createSurface): the sleeve's
 * print triangles with their positions in the frame model-viewer gives
 * hotspot positions in, and their die pixels, split into the die's three
 * sides. Forked (v1.16.0) from the storefront's hat extractor,
 * scripts/blender/hat-no6/lab/extract_surface.mjs (origin/main): the GLB
 * reading, the meshopt decode, the node transforms and the winding checks are
 * its; what is new is the split by side.
 *
 *   npm run extract:can-surface
 *   (node scripts/extract-can-surface.mjs)
 *
 * It reads models/can-cooler-standard.glb and models/can-cooler-slim.glb and
 * writes models/can-cooler-standard-surface.json and
 * models/can-cooler-slim-surface.json, nothing else, with no network. Two
 * runs write the same bytes. A rebuilt model needs a rerun, and new sha256s in
 * models/MANIFEST.json (tests/can-surface.test.js says so).
 *
 * Why this frame. A hotspot is a child of model-viewer's `target`, and so is
 * the loaded glTF scene, so hotspot positions are in the scene's own frame:
 * every node transform composed down the hierarchy, which is also where
 * KHR_mesh_quantization's dequantization lives (gltfpack puts it there). The
 * can's host sets no `orientation` or `scale` on the element, which would
 * change it.
 *
 * The die px. The sleeve's `print` and `print_seam` materials sample
 * TEXCOORD_0 untransformed, and TEXCOORD_0 is the die's stage frame
 * (the storefront's scripts/blender/can-cooler/README.md). The model build
 * writes Blender UVs as (x / W, 1 - y / H); the glTF exporter flips v, so in
 * the GLB a die pixel is (u * W, v * H), as the hats' are. Checked against the
 * data on every run (checkWrap): the front panel's top edge (die y0) is the
 * rim on the model's +z side, the back panel's (y3) the rim on its -z side,
 * the front's right half (die x > cx) is +x, and the base is at the bottom.
 *
 * What it writes, per side (`front`, `back`, `base`, confine.js faceRegions'
 * regions of the die: the panels' rects and the base's disc):
 * - positions: x, y, z in metres, rounded to 1e-6;
 * - uvs: die px, rounded to 0.01;
 * - indices: triangles, counter-clockwise from the outward face (checked
 *   against the GLB's NORMAL; a mirroring node would have its winding swapped
 *   back, as three does).
 * A triangle joins every side its die triangle touches, within MARGIN_PX,
 * but the base only where it faces down (v1.16.1): its outward normal within
 * BASE_FACING_DEG of straight down. The disc's caps lie inside the panels'
 * rects, and on the model they are the bottom roll and the bottom of each
 * panel's wall, so the caps stay the panels' (as in v1.16.0) and the base is
 * the bottom and the roll's lower rings. Where a drag leaves the base, the
 * placer carries the die point on along the last true hit's local map
 * (hat-place.js), and from the roll's upper rings and the wall, seen from
 * below nearly edge-on, that map turns a sideways drag into one up or down
 * the die. Only print faces are written (a negative die winding, y down,
 * which is what hat-surface.js edits): the triangles the model build collapsed in the die
 * (the folds round the bottom edge, about one in eight) map no die pixel, and
 * hat-surface.js would skip them. Each side's vertices are the ones its
 * triangles use, numbered in the order they are first used.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { dieGeometry, resolveDie } from "../src/core/dies.js";
import { faceRegions } from "../src/core/confine.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The two can coolers: the die, the model, and the surface written for it. */
export const CAN_SURFACES = Object.freeze([
  Object.freeze({ die: "koozie-standard", glb: "models/can-cooler-standard.glb", out: "models/can-cooler-standard-surface.json" }),
  Object.freeze({ die: "koozie-slim", glb: "models/can-cooler-slim.glb", out: "models/can-cooler-slim-surface.json" }),
]);
/** The sleeve's materials that carry the design. */
export const PRINT_MATERIALS = Object.freeze(["print", "print_seam"]);
/** The sides, in the order they are written. */
export const SIDES = Object.freeze(["front", "back", "base"]);
/** Die px round a side within which a triangle still joins it. */
export const MARGIN_PX = 2;
/**
 * The base holds only print faces whose outward normal is within this many
 * degrees of straight down (v1.16.1). From the data: the bottom is flat (0
 * degrees), and the roll from it to the wall is rings of faces at about 8, 22,
 * 37, 49, 58, 67, 76 and 85 degrees, then the wall at 90, on both models, with
 * nothing between 59 and 67. The cut is in that gap, about 60 degrees as
 * judged, at its middle so a rebuild's float noise cannot move a ring across
 * (tests/can-surface.test.js keeps the gap empty).
 */
export const BASE_FACING_DEG = 63;
const BASE_FACING_COS = Math.cos((BASE_FACING_DEG * Math.PI) / 180);
/** A die triangle this small (twice its area, px^2) is collapsed: hat-surface.js's own DIE_EPS. */
const DIE_EPS = 1e-6;

// ---- GLB reading (the hat extractor's) ---------------------------------------------------

/** The JSON and BIN chunks of a .glb (version 2). */
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (magic)");
  if (buf.readUInt32LE(4) !== 2) throw new Error("GLB version is not 2");
  let json = null;
  let bin = null;
  for (let off = 12; off + 8 <= buf.length; ) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function makeReader(json, bin) {
  const views = new Map();
  /** A bufferView's bytes, meshopt-decoded when it is compressed. */
  function view(i) {
    if (views.has(i)) return views.get(i);
    const bv = json.bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression;
    let out;
    if (ext) {
      if ((ext.buffer ?? 0) !== 0) throw new Error(`bufferView ${i}: meshopt source is not the BIN chunk`);
      const src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
      const dst = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(dst, ext.count, ext.byteStride, src, ext.mode, ext.filter || "NONE");
      out = { data: Buffer.from(dst.buffer, dst.byteOffset, dst.byteLength), stride: ext.byteStride };
    } else {
      if ((bv.buffer ?? 0) !== 0) throw new Error(`bufferView ${i}: not the BIN chunk`);
      out = { data: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), stride: bv.byteStride || 0 };
    }
    views.set(i, out);
    return out;
  }
  /** An accessor as an array of number arrays, normalized ints mapped as glTF says. */
  return function read(index) {
    const a = json.accessors[index];
    if (a.sparse) throw new Error(`accessor ${index} is sparse (not handled)`);
    if (a.bufferView == null) throw new Error(`accessor ${index} has no bufferView`);
    const { data, stride } = view(a.bufferView);
    const comps = COMPONENTS[a.type];
    const size = BYTES[a.componentType];
    if (!comps || !size) throw new Error(`accessor ${index}: unsupported ${a.type}/${a.componentType}`);
    const st = stride || comps * size;
    const res = new Array(a.count);
    for (let i = 0; i < a.count; i++) {
      const v = new Array(comps);
      for (let c = 0; c < comps; c++) {
        const o = (a.byteOffset || 0) + i * st + c * size;
        let x;
        switch (a.componentType) {
          case 5126: x = data.readFloatLE(o); break;
          case 5125: x = data.readUInt32LE(o); break;
          case 5123: x = data.readUInt16LE(o); if (a.normalized) x /= 65535; break;
          case 5122: x = data.readInt16LE(o); if (a.normalized) x = Math.max(x / 32767, -1); break;
          case 5121: x = data.readUInt8(o); if (a.normalized) x /= 255; break;
          case 5120: x = data.readInt8(o); if (a.normalized) x = Math.max(x / 127, -1); break;
        }
        v[c] = x;
      }
      res[i] = v;
    }
    return res;
  };
}

// ---- Node transforms (column-major 4x4, as glTF) -----------------------------------

function trs(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

function normalMatrix(m) {
  // Inverse transpose of the upper 3x3 (column-major in, column-major out).
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, Hh / det, I / det];
}

/** Every mesh-carrying node of the default scene with its world matrix. */
function meshInstances(json) {
  const out = [];
  const walk = (i, parent) => {
    const node = json.nodes[i];
    const world = mul(parent, trs(node));
    if (node.mesh != null) out.push({ node: i, mesh: node.mesh, world });
    for (const c of node.children || []) walk(c, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, identity);
  return out;
}

// ---- Which side a die triangle is on ------------------------------------------------------

/** Whether a die triangle touches a rect grown by `m` (separating axes: x, y, each edge's normal). */
function touchesRect(t, { x0, y0, x1, y1 }, m) {
  const X0 = x0 - m, Y0 = y0 - m, X1 = x1 + m, Y1 = y1 + m;
  const xs = [t[0], t[2], t[4]], ys = [t[1], t[3], t[5]];
  if (Math.max(...xs) < X0 || Math.min(...xs) > X1 || Math.max(...ys) < Y0 || Math.min(...ys) > Y1) return false;
  const corners = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
  for (let k = 0; k < 3; k++) {
    const ax = t[2 * k], ay = t[2 * k + 1];
    const bx = t[(2 * k + 2) % 6], by = t[(2 * k + 3) % 6];
    const cx = t[(2 * k + 4) % 6], cy = t[(2 * k + 5) % 6];
    const nx = -(by - ay), ny = bx - ax;
    const side = Math.sign(nx * (cx - ax) + ny * (cy - ay));
    if (side === 0) continue; // a collapsed triangle: the box test above is its test
    if (corners.every(([px, py]) => side * (nx * (px - ax) + ny * (py - ay)) < 0)) return false;
  }
  return true;
}

/** Whether a die triangle comes within `m` of a disc. */
function touchesCircle(t, { cx, cy, r }, m) {
  const [ax, ay, bx, by, qx, qy] = t;
  return Math.sqrt(triDistance2(cx, cy, ax, ay, bx, by, qx, qy)) <= r + m;
}

/** Squared distance from (x, y) to a triangle (0 inside it). */
function triDistance2(x, y, x0, y0, x1, y1, x2, y2) {
  const e1x = x1 - x0, e1y = y1 - y0, e2x = x2 - x0, e2y = y2 - y0;
  const det = e1x * e2y - e1y * e2x;
  if (det !== 0) {
    const px = x - x0, py = y - y0;
    const l1 = (e2y * px - e2x * py) / det, l2 = (-e1y * px + e1x * py) / det;
    if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return 0;
  }
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

/**
 * The sides a die triangle [ax, ay, bx, by, cx, cy] joins: each side whose
 * region it touches, the base only when `down` (facesDown) is true.
 */
export function sidesOf(t, regions, down, margin = MARGIN_PX) {
  return SIDES.filter((id) => {
    const region = regions[id];
    if (!region || (id === "base" && !down)) return false;
    return region.kind === "circle" ? touchesCircle(t, region, margin) : touchesRect(t, region, margin);
  });
}

/** Whether a triangle's outward face (counter-clockwise, metres) is within BASE_FACING_DEG of straight down. */
export function facesDown(A, B, C) {
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 0 && -n[1] / len >= BASE_FACING_COS;
}

// ---- Extraction ----------------------------------------------------------------------

const r6 = (x) => Math.round(x * 1e6) / 1e6 || 0;
const r2 = (x) => Math.round(x * 100) / 100 || 0;

/**
 * The surface JSON for a can cooler GLB's bytes, on die `dieId`'s frame.
 * Returns { json, report }: report holds the checks' numbers, and `failures`
 * the checks that failed (a non-empty list fails the script).
 *
 * @param {Uint8Array} bytes
 * @param {{ dieId: string, model: string }} o
 */
export async function extractCanSurface(bytes, { dieId, model }) {
  await MeshoptDecoder.ready;
  const { json, bin } = parseGlb(Buffer.from(bytes));
  const read = makeReader(json, bin);
  const die = dieGeometry(dieId, { kind: "koozie" });
  const { width: W, height: H } = resolveDie(dieId, { kind: "koozie" }).stage;
  const regions = faceRegions(die);
  // Every print triangle of the sleeve: world positions (unrounded) and die px.
  const tris = [];
  let agree = 0, disagree = 0, collapsed = 0, mirrored = 0;
  for (const inst of meshInstances(json)) {
    const m = inst.world;
    const flip = det3(m) < 0;
    const nm = normalMatrix(m);
    for (const prim of json.meshes[inst.mesh].primitives) {
      const material = json.materials?.[prim.material];
      if (!PRINT_MATERIALS.includes(material?.name)) continue;
      if ((prim.mode ?? 4) !== 4) throw new Error(`${material.name}: primitive is not TRIANGLES`);
      const tex = material.pbrMetallicRoughness?.baseColorTexture;
      if (tex && ((tex.texCoord ?? 0) !== 0 || tex.extensions?.KHR_texture_transform)) {
        throw new Error(`${material.name}: art is not on texCoord 0 untransformed; die px would not be (u*W, v*H)`);
      }
      if (prim.attributes.TEXCOORD_0 == null) throw new Error(`${material.name}: no TEXCOORD_0`);
      const pos = read(prim.attributes.POSITION).map(([x, y, z]) => [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ]);
      // die px as written (0.01 px), so the checks below are of what the file holds
      const uv = read(prim.attributes.TEXCOORD_0).map(([u, v]) => [r2(u * W), r2(v * H)]);
      const nrm = prim.attributes.NORMAL != null
        ? read(prim.attributes.NORMAL).map(([a, b, c]) => [nm[0] * a + nm[3] * b + nm[6] * c, nm[1] * a + nm[4] * b + nm[7] * c, nm[2] * a + nm[5] * b + nm[8] * c])
        : null;
      const idx = prim.indices != null ? read(prim.indices).map((v) => v[0]) : pos.map((_, i) => i);
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const [a, b, c] = flip ? [idx[t], idx[t + 2], idx[t + 1]] : [idx[t], idx[t + 1], idx[t + 2]];
        const e1 = [0, 1, 2].map((k) => pos[b][k] - pos[a][k]);
        const e2 = [0, 1, 2].map((k) => pos[c][k] - pos[a][k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (nrm && Math.hypot(n[0], n[1], n[2]) > 1e-14) {
          const s = [0, 1, 2].reduce((acc, k) => acc + n[k] * (nrm[a][k] + nrm[b][k] + nrm[c][k]), 0);
          if (s > 0) agree++;
          else disagree++;
        }
        const die2 = (uv[b][0] - uv[a][0]) * (uv[c][1] - uv[a][1]) - (uv[b][1] - uv[a][1]) * (uv[c][0] - uv[a][0]);
        if (Math.abs(die2) <= DIE_EPS) {
          collapsed++;
          continue;
        }
        if (die2 > 0) {
          mirrored++;
          continue;
        }
        tris.push({ p: [pos[a], pos[b], pos[c]], d: [uv[a], uv[b], uv[c]] });
      }
    }
  }

  // Each side: the triangles that touch it, their vertices numbered by first use.
  const out = { model, frame: { width: W, height: H }, zones: {} };
  const report = { triangles: tris.length, collapsed, mirrored, normalsAgree: agree, normalsDisagree: disagree, sides: {} };
  const zones = Object.fromEntries(SIDES.map((id) => [id, { positions: [], uvs: [], indices: [], keys: new Map() }]));
  let orphans = 0;
  let notDown = 0;
  for (const { p, d } of tris) {
    const t = [d[0][0], d[0][1], d[1][0], d[1][1], d[2][0], d[2][1]];
    const down = facesDown(p[0], p[1], p[2]);
    const sides = sidesOf(t, regions, down);
    if (!down && sidesOf(t, regions, true).includes("base")) notDown++;
    if (!sides.length) orphans++;
    for (const id of sides) {
      const z = zones[id];
      for (let k = 0; k < 3; k++) {
        const P = p[k].map(r6);
        const D = d[k];
        const key = `${P.join(",")}|${D.join(",")}`;
        let v = z.keys.get(key);
        if (v === undefined) {
          v = z.keys.size;
          z.keys.set(key, v);
          z.positions.push(...P);
          z.uvs.push(...D);
        }
        z.indices.push(v);
      }
    }
  }
  report.orphans = orphans;
  // the disc's faces left to the panels: the roll's upper rings and the wall
  report.baseNotDown = notDown;
  for (const id of SIDES) {
    const { positions, uvs, indices } = zones[id];
    out.zones[id] = { positions, uvs, indices };
    report.sides[id] = sideReport(uvs, indices, regions[id]);
  }
  report.wrap = checkWrap(tris, die);
  report.failures = failuresOf(report);
  return { json: out, report };
}

/** A side's numbers: its size, its die bounds, and how far they reach past the region's box (a triangle that touches it may reach past it). */
function sideReport(uvs, indices, region) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < uvs.length; k += 2) {
    x0 = Math.min(x0, uvs[k]); x1 = Math.max(x1, uvs[k]);
    y0 = Math.min(y0, uvs[k + 1]); y1 = Math.max(y1, uvs[k + 1]);
  }
  const box = region.kind === "circle" ? { x0: region.cx - region.r, y0: region.cy - region.r, x1: region.cx + region.r, y1: region.cy + region.r } : region;
  const past = Math.max(box.x0 - x0, box.y0 - y0, x1 - box.x1, y1 - box.y1, 0);
  return { vertices: uvs.length / 2, triangles: indices.length / 3, uvBounds: [x0, y0, x1, y1].map(r2), pastRegionBox: r2(past) };
}

/**
 * The wrap as the model build's contract says it is (and so the v flip):
 * the rim's print on the +z side is the front panel's top edge (die y0), on
 * the -z side the back panel's (y3); the front's +x half is the die's right
 * half; the bottom is the band between the folds, the front fold toward +z.
 */
function checkWrap(tris, die) {
  const verts = tris.flatMap(({ p, d }) => p.map((P, k) => ({ P, D: d[k] })));
  const top = Math.max(...verts.map((v) => v.P[1]));
  const bottom = Math.min(...verts.map((v) => v.P[1]));
  const mean = (vs, f) => vs.reduce((s, v) => s + f(v), 0) / vs.length;
  const rim = verts.filter((v) => v.P[1] > top - 5e-4);
  const floor = verts.filter((v) => v.P[1] < bottom + 1e-4);
  const front = verts.filter((v) => v.P[2] > 0 && v.D[1] > die.y0 && v.D[1] < die.y1);
  const right = front.filter((v) => v.P[0] > 0.01);
  const left = front.filter((v) => v.P[0] < -0.01);
  return {
    frontRimDieY: r2(mean(rim.filter((v) => v.P[2] > 0.01), (v) => v.D[1])),
    backRimDieY: r2(mean(rim.filter((v) => v.P[2] < -0.01), (v) => v.D[1])),
    y0: r2(die.y0),
    y3: r2(die.y3),
    frontRightDieX: r2(mean(right, (v) => v.D[0])),
    frontLeftDieX: r2(mean(left, (v) => v.D[0])),
    cx: r2(die.cx),
    floorFrontDieY: r2(mean(floor.filter((v) => v.P[2] > 0.01), (v) => v.D[1])),
    floorBackDieY: r2(mean(floor.filter((v) => v.P[2] < -0.01), (v) => v.D[1])),
    cy: r2(die.cy),
    floorInBand: floor.every((v) => v.D[1] >= die.y1 - 2 && v.D[1] <= die.y2 + 2),
  };
}

function failuresOf(r) {
  const f = [];
  if (r.normalsDisagree) f.push(`${r.normalsDisagree} print triangles wound against their normals`);
  if (r.mirrored) f.push(`${r.mirrored} print triangles carry the print mirrored`);
  if (r.orphans) f.push(`${r.orphans} print triangles are on no side`);
  const w = r.wrap;
  if (!(Math.abs(w.frontRimDieY - w.y0) < 10)) f.push(`the +z rim is die y ${w.frontRimDieY}, not the front's top edge ${w.y0}`);
  if (!(Math.abs(w.backRimDieY - w.y3) < 10)) f.push(`the -z rim is die y ${w.backRimDieY}, not the back's top edge ${w.y3}`);
  if (!(w.frontRightDieX > w.cx && w.frontLeftDieX < w.cx)) f.push("the front panel is mirrored across the can");
  if (!(w.floorFrontDieY < w.cy && w.floorBackDieY > w.cy && w.floorInBand)) f.push("the base is not the band between the folds, the front fold forward");
  for (const id of SIDES) if (!r.sides[id].triangles) f.push(`${id}: no triangles`);
  return f;
}

/** The JSON with each array on one line, so a diff of a rebuild stays readable (the hat extractor's format). */
export function formatSurface(json) {
  const zones = Object.entries(json.zones).map(([id, z]) => {
    const lines = Object.entries(z).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `    ${JSON.stringify(id)}: {\n${lines.join(",\n")}\n    }`;
  });
  return `{\n  "model": ${JSON.stringify(json.model)},\n  "frame": ${JSON.stringify(json.frame)},\n  "zones": {\n${zones.join(",\n")}\n  }\n}\n`;
}

async function main() {
  let failed = false;
  for (const { die, glb, out } of CAN_SURFACES) {
    const model = glb.split("/").pop();
    const { json, report } = await extractCanSurface(readFileSync(resolve(ROOT, glb)), { dieId: die, model });
    const text = formatSurface(json);
    writeFileSync(resolve(ROOT, out), text);
    const { failures, ...numbers } = report;
    console.log(`REPORT ${die} ${JSON.stringify(numbers)}`);
    console.log(`REPORT ${out} raw=${Buffer.byteLength(text)} gzip=${gzipSync(text, { level: 9 }).length}`);
    for (const f of failures) console.error(`FAIL ${die}: ${f}`);
    if (failures.length) failed = true;
  }
  if (failed) {
    console.error("extract-can-surface: a check failed (see FAIL lines)");
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
