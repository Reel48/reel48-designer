#!/usr/bin/env node
// Copied byte-for-byte from Reel48-Storefront scripts/blender/hat-no7/lab/extract_surface.mjs (origin/main d78d90ee) but for this line; its DEFAULT_GLB reads the hat-3d-assets.js copy under src/ here.
/**
 * The No. 7's print surfaces, out of the shipped GLB, for the on-hat editor
 * (src/components/storefront/hat/hat-surface.js): each print overlay's
 * triangles with their positions in the frame model-viewer gives hotspot
 * positions in, and their die pixels.
 *
 *   node scripts/blender/hat-no7/lab/extract_surface.mjs <glb> <out.json>
 *   node scripts/blender/hat-no7/lab/extract_surface.mjs   (the model the site serves, into src/)
 *
 * Why this frame. A hotspot is a child of model-viewer's `target` object, and
 * so is the loaded glTF scene (ModelScene.setSource adds gltf.scene to target;
 * Hotspot positions and positionAndNormalFromPoint are both in target's local
 * frame). Centring the model on the camera target moves `target` itself, and a
 * turntable turns its parent `pivot`, so neither changes that frame. What does
 * is the element's `orientation` and `scale` attributes, set on gltf.scene
 * (applyTransform); Hat3D sets neither, so the frame is the glTF scene with
 * every node transform composed down the hierarchy (three's GLTFLoader builds
 * the same graph). KHR_mesh_quantization's dequantization lives in those node
 * transforms (gltfpack puts it there), so composing them is the whole decode.
 * If Hat3D ever sets `orientation` or `scale`, apply it to these positions.
 *
 * What it writes, per zone (`print_<zone>` material):
 * - positions: x, y, z in metres, rounded to 1e-6;
 * - uvs: TEXCOORD_0 in die px, (u * W, v * H) rounded to 0.01 (raw glTF has no
 *   flip; the print materials sample texCoord 0 with no transform, checked);
 * - indices: triangles, counter-clockwise from the face the renderer draws (a
 *   node with a mirroring transform has its winding swapped back, as three does).
 * Every primitive of a zone's material, on every node using its mesh, is
 * concatenated. Its printed side is read from the data by hat-surface.js; this
 * script also checks it here, against the GLB's own NORMAL attribute, and
 * fails if the two disagree.
 *
 * It reads only the file it is given and writes only <out.json>: no network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
/** The model the site serves: hat-3d-assets.js's MODEL (read as text; it imports the 3D loader). */
export const DEFAULT_GLB = (() => {
  const src = readFileSync(resolve(REPO, "src/components/storefront/hat/hat-3d-assets.js"), "utf8");
  const m = src.match(/export const MODEL = "(\/[^"]+\.glb)";/);
  if (!m) throw new Error("hat-3d-assets.js: no MODEL");
  return resolve(REPO, `public${m[1]}`);
})();
export const DEFAULT_OUT = resolve(REPO, "src/components/storefront/hat/hat-no7-surface.json");
const PRINT_PREFIX = "print_";

// ---- GLB reading ---------------------------------------------------------------------

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

/** Every mesh-carrying node of the default scene with its world matrix. */
function meshInstances(json) {
  const out = [];
  const sceneIndex = json.scene ?? 0;
  const walk = (i, parent) => {
    const node = json.nodes[i];
    const world = mul(parent, trs(node));
    if (node.mesh != null) out.push({ node: i, mesh: node.mesh, world });
    for (const c of node.children || []) walk(c, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of json.scenes[sceneIndex].nodes) walk(root, identity);
  return out;
}

// ---- Extraction ----------------------------------------------------------------------

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * The surface JSON for a GLB's bytes. `frame` is the die's stage in px.
 * Returns { json, report } where report holds the checks' numbers.
 */
export async function extractSurface(bytes, { model, frame }) {
  await MeshoptDecoder.ready;
  const { json, bin } = parseGlb(Buffer.from(bytes));
  const read = makeReader(json, bin);
  const { width: W, height: H } = frame;
  const zones = {};
  const report = {};
  for (const inst of meshInstances(json)) {
    const m = inst.world;
    const flip = det3(m) < 0;
    for (const prim of json.meshes[inst.mesh].primitives) {
      const material = json.materials?.[prim.material];
      if (!material?.name?.startsWith(PRINT_PREFIX)) continue;
      const zoneId = material.name.slice(PRINT_PREFIX.length);
      if ((prim.mode ?? 4) !== 4) throw new Error(`${material.name}: primitive is not TRIANGLES`);
      const tex = material.pbrMetallicRoughness?.baseColorTexture;
      if (tex && ((tex.texCoord ?? 0) !== 0 || tex.extensions?.KHR_texture_transform)) {
        throw new Error(`${material.name}: art is not on texCoord 0 untransformed; die px would not be (u*W, v*H)`);
      }
      if (prim.attributes.TEXCOORD_0 == null) throw new Error(`${material.name}: no TEXCOORD_0`);
      const pos = read(prim.attributes.POSITION);
      const uv = read(prim.attributes.TEXCOORD_0);
      const nrm = prim.attributes.NORMAL != null ? read(prim.attributes.NORMAL) : null;
      const idx = prim.indices != null ? read(prim.indices).map((v) => v[0]) : pos.map((_, i) => i);
      const z = (zones[zoneId] ||= { material: material.name, positions: [], uvs: [], indices: [], _normals: [] });
      const base = z.positions.length / 3;
      // The normal matrix (inverse transpose of the 3x3) only matters for its
      // sign check below; uniform scale keeps directions, but do it properly.
      const nm = normalMatrix(m);
      for (let i = 0; i < pos.length; i++) {
        const [x, y, zc] = pos[i];
        z.positions.push(
          r6(m[0] * x + m[4] * y + m[8] * zc + m[12]),
          r6(m[1] * x + m[5] * y + m[9] * zc + m[13]),
          r6(m[2] * x + m[6] * y + m[10] * zc + m[14]),
        );
        z.uvs.push(r2(uv[i][0] * W), r2(uv[i][1] * H));
        if (nrm) {
          const [a, b, c] = nrm[i];
          z._normals.push(nm[0] * a + nm[3] * b + nm[6] * c, nm[1] * a + nm[4] * b + nm[7] * c, nm[2] * a + nm[5] * b + nm[8] * c);
        }
      }
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const [a, b, c] = flip ? [idx[t], idx[t + 2], idx[t + 1]] : [idx[t], idx[t + 1], idx[t + 2]];
        z.indices.push(base + a, base + b, base + c);
      }
    }
  }
  for (const [id, z] of Object.entries(zones)) report[id] = checkZone(id, z);
  const out = { model, frame: { width: W, height: H }, zones: {} };
  for (const id of Object.keys(zones).sort(zoneOrder)) {
    const { material, positions, uvs, indices } = zones[id];
    out.zones[id] = { material, positions, uvs, indices };
  }
  return { json: out, report };
}

const ORDER = ["front", "left", "right", "back", "label_tall", "label_square"];
function zoneOrder(a, b) {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
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

/**
 * The checks that keep hat-surface.js's reading of the data honest.
 * - Every triangle's counter-clockwise face agrees with the GLB's own normals,
 *   so the winding is the outward face, the one the renderer draws (the print
 *   materials are single-sided).
 * - Die winding, in y-down die px and index order: a print seen from its
 *   printed side keeps its winding on a y-down screen, where a drawn
 *   (counter-clockwise) face has a negative signed area. So a face whose die
 *   winding is negative carries the print the right way round; hat-surface.js
 *   edits only those. The overlays are all negative. The label cards are
 *   slabs: their inward face is negative, their back face carries a mirrored
 *   copy (positive, the same die area) and their edges collapse in the die
 *   (zero). A zone whose negative faces cover less die area than its positive
 *   ones is mirrored, and fails.
 */
function checkZone(id, z) {
  const P = z.positions, U = z.uvs, N = z._normals, I = z.indices;
  let agree = 0, disagree = 0, slivers = 0, dieNeg = 0, diePos = 0, dieZero = 0, areaNeg = 0, areaPos = 0;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let k = 0; k < U.length; k += 2) {
    umin = Math.min(umin, U[k]); umax = Math.max(umax, U[k]);
    vmin = Math.min(vmin, U[k + 1]); vmax = Math.max(vmax, U[k + 1]);
  }
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
    const e2 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    // Slivers the 1e-6 m rounding collapsed have no face to check.
    if (N.length && Math.hypot(n[0], n[1], n[2]) > 1e-12) {
      const s = [0, 1, 2].reduce((acc, k) => acc + n[k] * (N[3 * a + k] + N[3 * b + k] + N[3 * c + k]), 0);
      if (s > 0) agree++; else disagree++;
    } else slivers++;
    const da = (U[2 * b] - U[2 * a]) * (U[2 * c + 1] - U[2 * a + 1]) - (U[2 * b + 1] - U[2 * a + 1]) * (U[2 * c] - U[2 * a]);
    if (Math.abs(da) < 1e-6) dieZero++;
    else if (da < 0) { dieNeg++; areaNeg -= da / 2; }
    else { diePos++; areaPos += da / 2; }
  }
  return {
    vertices: P.length / 3,
    triangles: I.length / 3,
    normalsAgree: agree,
    normalsDisagree: disagree,
    slivers,
    dieWinding: { negative: dieNeg, positive: diePos, degenerate: dieZero },
    dieArea: { negative: Math.round(areaNeg), positive: Math.round(areaPos) },
    uvRange: [r2(umin), r2(vmin), r2(umax), r2(vmax)],
  };
}

/** The JSON with each array on one line, so a diff of a rebuild stays readable. */
export function formatSurface(json) {
  const zones = Object.entries(json.zones).map(([id, z]) => {
    const lines = Object.entries(z).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `    ${JSON.stringify(id)}: {\n${lines.join(",\n")}\n    }`;
  });
  return `{\n  "model": ${JSON.stringify(json.model)},\n  "frame": ${JSON.stringify(json.frame)},\n  "zones": {\n${zones.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dieAt = argv.indexOf("--die");
  const diePath = dieAt >= 0 ? argv.splice(dieAt, 2)[1] : null;
  const [glbArg, outArg] = argv;
  const glb = resolve(glbArg || DEFAULT_GLB);
  const out = resolve(outArg || DEFAULT_OUT);
  // The die's stage is the one the storefront designs on (the package's die,
  // as src/lib/hat/hat-config.js reads it); the frame is pinned once orders
  // exist, so this only ever confirms 1560 x 1296. A model built on another
  // die (round E1's whole panels, e1/die_no7.json) names it with --die.
  let frame;
  if (diePath) {
    const { stage } = JSON.parse(readFileSync(resolve(diePath), "utf8"));
    frame = { width: stage.width, height: stage.height };
  } else {
    const { HAT_NO_7_DIE } = await import(resolve(REPO, "src/lib/hat/hat-config.js"));
    frame = { width: HAT_NO_7_DIE.stage.width, height: HAT_NO_7_DIE.stage.height };
  }
  const { json, report } = await extractSurface(readFileSync(glb), { model: basename(glb), frame });
  let failed = false;
  for (const [id, r] of Object.entries(report)) {
    const twoSided = r.dieWinding.negative > 0 && r.dieWinding.positive > 0;
    const notDrawn = r.normalsDisagree > 0;
    const mirrored = r.dieArea.negative < r.dieArea.positive * (1 - 1e-3) || r.dieArea.negative === 0;
    console.log(`REPORT surface ${id} ${JSON.stringify(r)}${twoSided ? " two_sided" : ""}${notDrawn ? " NORMALS_DISAGREE" : ""}${mirrored ? " PRINT_MIRRORED" : ""}`);
    if (notDrawn || mirrored) failed = true;
  }
  const text = formatSurface(json);
  writeFileSync(out, text);
  const raw = Buffer.byteLength(text);
  const gz = gzipSync(text, { level: 9 }).length;
  console.log(`REPORT surface_file ${out} raw=${raw} gzip=${gz}`);
  if (failed) {
    console.error("extract_surface: a check failed (see REPORT lines)");
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
