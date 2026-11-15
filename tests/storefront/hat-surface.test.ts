// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-surface.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted: hat-3d-assets.js names no URLs here (MODEL, SURFACE are gone), so the served model and
// surface are models/hat-no-7.glb and models/hat-no-7-surface.json; the storefront file each was
// copied from is models/MANIFEST.json's `source`. Round E1's die is tests/hat-no-7-v2.golden.json.
// The build's zones (scripts/blender/hat-no7/e1/zones_no7.json) and the lab's extract_surface.mjs
// are byte copies at their storefront paths under tests/storefront/fixtures/viewer/ (the script
// with one note line; on import it reads the storefront's hat-3d-assets.js for its DEFAULT_GLB, so
// a byte copy of that sits at src/components/storefront/hat/ there, as text only). In "is what extract_surface.mjs writes", the surface's model name is checked
// against the manifest's source instead of MODEL, and `DEFAULT_GLB.endsWith(MODEL)` (the lab's
// default path in the storefront's layout) is dropped.
/**
 * The on-hat editor's map between the screen and the die (hat-surface.js,
 * 2026-10-21): it is checked here against three.js itself, in node. A real
 * PerspectiveCamera at orbits round the No. 7 projects points the way
 * model-viewer's queryHotspot does, and a Raycaster on the decoded print
 * overlays says which die pixel each screen pixel truly shows. The surface
 * JSON is checked against the shipped GLB as three.js's GLTFLoader builds it
 * (independent of the extractor), against the extractor's own output, and
 * against the die and the model build's own zone placements. Off the spot,
 * it is walked round at the editor's own camera views (hat-look viewFor).
 *
 * The surface is the one the site serves (hat-3d-assets SURFACE), of the model
 * it serves (round E1, signed off 2026-10-21), on that model's die: round
 * E1's (scripts/blender/hat-no7/e1/die_no7.json), which the designer package
 * ships as "hat-no-7-v2"; read from the build here until hat-config.js names it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error three is plain JS here: @types/three is not a dependency.
import * as THREE from "three";
// @ts-expect-error as above.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// @ts-expect-error as above.
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import PLACEMENTS from "../../src/viewer/hat-no7-placements.js";
import { FIELD_OF_VIEW, viewFor } from "../../src/viewer/hat-look.js";
import {
  createSurface,
  measureProjection,
  probePointsFor,
  project,
  solveProjection,
} from "../../src/viewer/hat-surface.js";
import { areaRings } from "../../src/core/region.js";
import { LABEL_ORBIT_WINDOW, ORBIT_WINDOW } from "../../src/viewer/hat-edit.js";
import { extractSurface, formatSurface } from "./fixtures/viewer/scripts/blender/hat-no7/lab/extract_surface.mjs";

type V3 = [number, number, number];
type Zone = { material: string; positions: number[]; uvs: number[]; indices: number[] };
type Rect = { x: number; y: number; w: number; h: number };
const MODEL_FILE = "models/hat-no-7.glb";
const SURFACE_FILE = "models/hat-no-7-surface.json";
const MANIFEST = JSON.parse(readFileSync("models/MANIFEST.json", "utf8")) as Record<string, { source: string }>;
const SURFACE = JSON.parse(readFileSync(SURFACE_FILE, "utf8")) as { model: string; frame: { width: number; height: number }; zones: Record<string, Zone> };
const DIE = JSON.parse(readFileSync("tests/hat-no-7-v2.golden.json", "utf8")) as {
  stage: { width: number; height: number };
  zones: { id: string; rect: Rect; area: { outline: number[][]; holes?: number[][][] } }[];
};
/** The model build's own placements (round E1), with each zone's chart origin on the die. */
const BUILT = JSON.parse(readFileSync("tests/storefront/fixtures/viewer/scripts/blender/hat-no7/e1/zones_no7.json", "utf8")) as {
  zones: { id: string; centre: number[]; normal: number[]; chartToDie: { x: string; y: string } }[];
};
const ZONES = SURFACE.zones as Record<string, Zone>;
const surface = createSurface(SURFACE);
const IDS = surface.zoneIds;

// ---- Helpers -----------------------------------------------------------------------

/** A seeded generator, so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The parts of a GLTFLoader scene node read here. */
type Attribute = { count: number; getX(i: number): number; getY(i: number): number };
type LoadedNode = {
  isMesh?: boolean;
  material?: { name?: string };
  matrixWorld: { determinant(): number };
  geometry: { attributes: { position: Attribute; uv: Attribute }; index: { array: ArrayLike<number> } | null };
};
type Loaded = { updateMatrixWorld(force: boolean): void; traverse(fn: (o: LoadedNode) => void): void };

type Cam = { camera: InstanceType<typeof THREE.PerspectiveCamera>; width: number; height: number; eye: V3 };
/** The fields of a three.js Raycaster intersection used here. */
type Hit = { object: { userData: { zone: string } }; faceIndex: number; uv: { x: number; y: number } };

function makeCamera(eye: V3, look: V3, { fov = 24, width = 800, height = 600 } = {}): Cam {
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.005, 10);
  camera.position.set(...eye);
  camera.lookAt(new THREE.Vector3(...look));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return { camera, width, height, eye };
}

/** queryHotspot's canvasPosition: CSS px from the element's top-left, y down; z is NDC. */
function toScreen(cam: Cam, X: number[]): V3 {
  const v = new THREE.Vector3(X[0], X[1], X[2]).project(cam.camera);
  return [v.x * (cam.width / 2) + cam.width / 2, -(v.y * (cam.height / 2)) + cam.height / 2, v.z];
}

/** P from points' projections, as measureProjection keeps them: between the near and far planes. */
function solveFor(cam: Cam, points: number[][]) {
  const pairs = points.map((X) => ({ X, s: toScreen(cam, X) })).filter(({ s }) => s[2] >= -1 && s[2] <= 1);
  return solveProjection(pairs.map(({ X, s }) => ({ X, s: [s[0], s[1]] })));
}

const add = (a: number[], b: number[], k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rotateAbout(v: number[], axis: number[], angle: number): V3 {
  const k = Math.hypot(axis[0], axis[1], axis[2]);
  const u = axis.map((x) => x / k);
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(v.map((x) => x * c) as V3, cross(u, v), s), u, dot(u, v) * (1 - c));
}

function vertex(z: Zone, i: number): V3 {
  return [z.positions[3 * i], z.positions[3 * i + 1], z.positions[3 * i + 2]];
}

/** A zone's triangle: its vertex indices, CCW face normal and twice its die area (y down). */
function tri(z: Zone, t: number) {
  const [a, b, c] = [z.indices[3 * t], z.indices[3 * t + 1], z.indices[3 * t + 2]];
  const n = cross(sub(vertex(z, b), vertex(z, a)), sub(vertex(z, c), vertex(z, a)));
  const U = z.uvs;
  const die = (U[2 * b] - U[2 * a]) * (U[2 * c + 1] - U[2 * a + 1]) - (U[2 * b + 1] - U[2 * a + 1]) * (U[2 * c] - U[2 * a]);
  return { a, b, c, n, die };
}

/** Metres from a point to the nearest vertex of a zone. */
function nearestVertex(z: Zone, p: number[]) {
  let best = Infinity;
  for (let i = 0; i < z.positions.length / 3; i++) best = Math.min(best, Math.hypot(...sub(vertex(z, i), p)));
  return best;
}

/** The print faces: die winding negative (the print reads right from the drawn face). */
const printFaces = (id: string) => {
  const z = ZONES[id];
  const out: number[] = [];
  for (let t = 0; t < z.indices.length / 3; t++) if (tri(z, t).die < -1e-6) out.push(t);
  return out;
};

/** The overlays as three.js meshes: the actual decoded geometry, uv in die px. */
function meshFor(id: string, side: number) {
  const z = ZONES[id];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(Float64Array.from(z.positions), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(Float64Array.from(z.uvs), 2));
  g.setIndex(z.indices);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side }));
  mesh.userData.zone = id;
  mesh.updateMatrixWorld(true);
  return mesh;
}
const FRONT_MESHES = IDS.map((id) => meshFor(id, THREE.FrontSide));
const BOTH_MESHES = IDS.map((id) => meshFor(id, THREE.DoubleSide));
const raycaster = new THREE.Raycaster();
const OTHER_LABEL: Record<string, string> = { label_tall: "label_square", label_square: "label_tall" };
/** What a zone can be hidden by: every overlay, bar the other label card (one is shown at a time). */
const occludersOf = (id: string) => FRONT_MESHES.filter((m: Hit["object"]) => m.userData.zone !== OTHER_LABEL[id]);

/** The overlay hits under a screen pixel, nearest first. */
function hitsAt(cam: Cam, px: number, py: number, meshes: unknown[]): Hit[] {
  raycaster.setFromCamera(new THREE.Vector2((px / cam.width) * 2 - 1, -((py / cam.height) * 2 - 1)), cam.camera);
  return raycaster.intersectObjects(meshes, false);
}

/**
 * The zone's drawn print faces under a pixel, nearest first. Two or more is a
 * fold: round E1's whole-panel overlays run down to the bill and round to the
 * side seams, where the fabric, seen from the side, lies over itself.
 */
function ownLayersAt(cam: Cam, id: string, px: number, py: number) {
  return hitsAt(cam, px, py, [FRONT_MESHES[IDS.indexOf(id)]]).filter((h) => tri(ZONES[id], h.faceIndex).die < -1e-6);
}

/** A random point on a random print face (area-weighted by triangle count is fine here). */
function randomOnFace(id: string, faces: number[], r: () => number) {
  const z = ZONES[id];
  const t = faces[Math.floor(r() * faces.length)];
  let l1 = r(), l2 = r();
  if (l1 + l2 > 1) { l1 = 1 - l1; l2 = 1 - l2; }
  const l0 = 1 - l1 - l2;
  const { a, b, c } = tri(z, t);
  const X = [0, 1, 2].map((k) => l0 * z.positions[3 * a + k] + l1 * z.positions[3 * b + k] + l2 * z.positions[3 * c + k]);
  const d = [0, 1].map((k) => l0 * z.uvs[2 * a + k] + l1 * z.uvs[2 * b + k] + l2 * z.uvs[2 * c + k]);
  return { t, X, d };
}

function centreOf(id: string): V3 {
  const b = surface.bounds(id);
  return surface.dieToModel(id, b.x + b.w / 2, b.y + b.h / 2) as V3;
}

/** Three views of a zone from its printed side: square on, and two oblique. */
function viewsOf(id: string): Cam[] {
  const c = centreOf(id);
  const n = surface.normal(id);
  const inside = id.startsWith("label");
  const dist = inside ? 0.11 : 0.45;
  const side = cross(n, [0, 1, 0]);
  const dirs = [n, rotateAbout(n, [0, 1, 0], 0.45), rotateAbout(n, side, -0.35)];
  const sizes = [{ width: 800, height: 600, fov: 24 }, { width: 390, height: 560, fov: 30 }, { width: 1024, height: 700, fov: 40 }];
  return dirs.map((d, i) => makeCamera(add(c, d, dist), c, sizes[i]));
}

/** Points spread through the hat's bounding box. */
/** A zone seen from behind its printed side: through the hat for an overlay, from outside it for a label. */
function behindOf(id: string): Cam {
  const c = centreOf(id);
  return makeCamera(add(c, surface.normal(id), id.startsWith("label") ? -0.3 : -0.25), c);
}

function hatPoints(count: number, seed: number) {
  const r = rng(seed);
  return Array.from({ length: count }, () => [-0.1 + 0.2 * r(), -0.02 + 0.1 * r(), -0.14 + 0.22 * r()]);
}

const ORBIT_CENTRE: V3 = [0, 0.03, -0.035];
function orbit(thetaDeg: number, phiDeg: number, radius: number, opts = {}) {
  const th = (thetaDeg * Math.PI) / 180, ph = (phiDeg * Math.PI) / 180;
  const eye = add(ORBIT_CENTRE, [radius * Math.sin(ph) * Math.sin(th), radius * Math.cos(ph), radius * Math.sin(ph) * Math.cos(th)]);
  return makeCamera(eye, ORBIT_CENTRE, opts);
}
// Round E1's whole-panel overlays carry about three times the triangles: the
// walks over every face at every camera take a few seconds, more beside other
// test files.
const HEAVY_MS = 30_000;

const ORBITS = [orbit(0, 76, 0.6), orbit(70, 60, 0.45, { fov: 40, width: 390, height: 640 }), orbit(160, 80, 0.5), orbit(-110, 45, 0.35, { fov: 30 })];

// ---- The camera ------------------------------------------------------------------------

describe("solveProjection", () => {
  it("recovers a three.js camera from projected points, to a millionth of a pixel", () => {
    const train = hatPoints(24, 1);
    const held = hatPoints(300, 2);
    for (const cam of ORBITS) {
      const { P, residual } = solveFor(cam, train);
      expect(residual).toBeLessThan(1e-6);
      let worst = 0;
      for (const X of held) {
        const [sx, sy, w] = project(P, X);
        const [tx, ty] = toScreen(cam, X);
        worst = Math.max(worst, Math.hypot(sx - tx, sy - ty));
        // Scaled so w is the depth in front of the camera, in metres.
        expect(w).toBeCloseTo(-new THREE.Vector3(...X).applyMatrix4(cam.camera.matrixWorldInverse).z, 9);
      }
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it("is as exact from the probe points of any one zone, flat label cards included", () => {
    const held = hatPoints(400, 3);
    for (const id of IDS) {
      const points = probePointsFor(surface, id);
      expect(points.length, id).toBeGreaterThanOrEqual(8);
      const own = Array.from({ length: ZONES[id].positions.length / 3 }, (_, i) => vertex(ZONES[id], i));
      for (const cam of [...viewsOf(id), ORBITS[0]]) {
        const { P } = solveFor(cam, points);
        let checked = 0;
        // Anywhere on the hat that is on screen (a point a hair from the camera
        // plane lands far off screen, where no pixel is), and the zone itself.
        for (const X of [...held, ...own]) {
          const [tx, ty, tz] = toScreen(cam, X);
          if (tz < -1 || tz > 1 || tx < 0 || ty < 0 || tx > cam.width || ty > cam.height) continue;
          const [sx, sy] = project(P, X);
          expect(Math.hypot(sx - tx, sy - ty), id).toBeLessThan(1e-6);
          checked++;
        }
        expect(checked, id).toBeGreaterThan(100);
      }
    }
  });

  /**
   * A flat 44 x 25 mm card, tilted, as a zone: the worst case for DLT, since
   * the surface probes are then exactly coplanar. Its CCW face and its die
   * winding are the print faces' (die y down, read from the front).
   */
  function flatCard() {
    const O: V3 = [0.02, 0.01, 0.05];
    const U = rotateAbout([1, 0, 0], [0.3, 1, 0.2], 0.4);
    const V0 = rotateAbout([0, -1, 0], [0.3, 1, 0.2], 0.4);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const nx = 6, ny = 4;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      positions.push(...add(add(O, U, (0.044 * i) / nx), V0, (0.025 * j) / ny));
      uvs.push(1020 + (350 * i) / nx, 1055 + (200 * j) / ny);
    }
    const at = (i: number, j: number) => j * (nx + 1) + i;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      indices.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
    return createSurface({ frame: DIE.stage, zones: { card: { positions, uvs, indices } } });
  }

  it("is exact with the camera anywhere on DLT's critical lines for the probes, a flat card included", () => {
    // 2026-10-21 review: the two off-surface probes were centre +- normal, so a
    // square-on camera sat on the line through both, which with the rest on
    // one plane is DLT's critical set: a flat card's solve failed outright.
    const card = flatCard();
    expect(card.normal("card")[2]).toBeGreaterThan(0.5);
    const cases = [...IDS.map((id) => ({ id, s: surface })), { id: "card", s: card }];
    const held = hatPoints(400, 7);
    for (const { id, s } of cases) {
      const points = probePointsFor(s, id);
      const own = points.slice(0, -3), offs = points.slice(-3);
      const n = s.normal(id);
      // The off-surface probes really are off it (a flat card's plane; a hat
      // zone's fabric, which on a whole side panel curves past any one plane),
      // and not on one line.
      const offIt = (p: number[]) => (id === "card" ? Math.abs(dot(sub(p, own[0]), n)) : nearestVertex(ZONES[id], p));
      for (const p of offs) expect(offIt(p), id).toBeGreaterThan(0.002);
      expect(Math.hypot(...cross(sub(offs[1], offs[0]), sub(offs[2], offs[0]))), id).toBeGreaterThan(1e-5);
      const centre = [0, 1, 2].map((k) => own.reduce((acc, p) => acc + p[k], 0) / own.length) as V3;
      const lines: number[][][] = [[centre, n], [offs[0], sub(offs[1], offs[0])], [offs[0], sub(offs[2], offs[0])], [offs[1], sub(offs[2], offs[1])]];
      const dist = id.startsWith("label") || id === "card" ? 0.12 : 0.4;
      for (const [p, dir] of lines) {
        const u = dir.map((x) => x / Math.hypot(...dir));
        const toward = dot(u, n) < 0 ? u.map((x) => -x) : u;
        const cam = makeCamera(add(p, toward, dist), centre);
        const { P } = solveFor(cam, points);
        let checked = 0;
        const plane = id === "card" ? hatPoints(400, 8).map((X) => add(own[0], sub(X, [0, 0.03, -0.03]), 0.2)) : [];
        for (const X of [...held, ...plane, ...own]) {
          const [tx, ty, tz] = toScreen(cam, X);
          if (tz < -1 || tz > 1 || tx < 0 || ty < 0 || tx > cam.width || ty > cam.height) continue;
          const [sx, sy] = project(P, X);
          expect(Math.hypot(sx - tx, sy - ty), `${id} on ${toward.map((x) => x.toFixed(2))}`).toBeLessThan(1e-6);
          checked++;
        }
        expect(checked, id).toBeGreaterThan(5);
      }
    }
  });

  it("refuses fewer than six pairs", () => {
    const cam = ORBITS[0];
    expect(() => solveFor(cam, hatPoints(5, 4))).toThrow(RangeError);
  });
});

describe("measureProjection on model-viewer's hotspot API", () => {
  /**
   * model-viewer 4.2.0's hotspot path, as its sources do it: the hotspot is a
   * child of `target` (offset to centre the model) under `pivot`; updateHotspot
   * parses "x y z" and updates matrixWorld at once; queryHotspot projects it.
   */
  function fakeViewer(cam: Cam) {
    const scene = new THREE.Scene();
    const pivot = new THREE.Object3D();
    const target = new THREE.Object3D();
    scene.add(pivot);
    pivot.add(target);
    pivot.rotation.y = 0.3;
    target.position.set(0.004, -0.031, 0.036);
    scene.updateMatrixWorld(true);
    const hotspot = new THREE.Object3D();
    target.add(hotspot);
    const slots = new Map([["hotspot-probe", hotspot]]);
    const toWorld = (X: number[]) => new THREE.Vector3(X[0], X[1], X[2]).applyMatrix4(target.matrixWorld).toArray();
    return {
      toWorld,
      updateHotspot({ name, position }: { name: string; position: string }) {
        const h = slots.get(name);
        if (!h) return;
        const [x, y, z] = position.trim().split(/\s+/).map((t) => parseFloat(t));
        h.position.set(x, y, z);
        h.updateMatrixWorld();
      },
      queryHotspot(name: string) {
        const h = slots.get(name);
        if (!h) return null;
        const v = new THREE.Vector3().setFromMatrixPosition(h.matrixWorld);
        const [x, y, z] = toScreen(cam, v.toArray());
        return { canvasPosition: { x, y, z } };
      },
    };
  }

  it("solves the camera for points in the model's own frame, synchronously", () => {
    const cam = ORBITS[1];
    const mv = fakeViewer(cam);
    const m = measureProjection(mv, probePointsFor(surface, "front"), { name: "probe" });
    expect(m).not.toBeNull();
    expect(m!.residual).toBeLessThan(1e-6);
    for (const X of hatPoints(100, 5)) {
      const [sx, sy] = project(m!.P, X);
      const [tx, ty] = toScreen(cam, mv.toWorld(X));
      expect(Math.hypot(sx - tx, sy - ty)).toBeLessThan(1e-5);
    }
    expect(measureProjection(mv, probePointsFor(surface, "back"), { name: "hotspot-probe" })).not.toBeNull();
  });

  it("returns null without the hotspot, or without the API", () => {
    const mv = fakeViewer(ORBITS[0]);
    expect(measureProjection(mv, probePointsFor(surface, "front"), { name: "other" })).toBeNull();
    expect(measureProjection({}, probePointsFor(surface, "front"))).toBeNull();
  });
});

// ---- The surface ------------------------------------------------------------------------

describe("screenToDie", () => {
  it("lands on the die pixel a three.js ray hits first, within 0.05 px, at 200+ pixels a zone", { timeout: HEAVY_MS }, () => {
    for (const id of IDS) {
      const faces = printFaces(id);
      const r = rng(id.length * 7919);
      let checked = 0, worst = 0;
      for (const cam of viewsOf(id)) {
        const { P } = solveFor(cam, probePointsFor(surface, id));
        surface.setCamera(P);
        const facing = faces.filter((t) => surface.frontFacing(id, t));
        let here = 0;
        for (let tries = 0; tries < 4000 && here < 100 && facing.length; tries++) {
          const { X } = randomOnFace(id, facing, r);
          const [px0, py0] = toScreen(cam, X);
          const px = px0 + (r() - 0.5), py = py0 + (r() - 0.5);
          if (px < 0 || py < 0 || px > cam.width || py > cam.height) continue;
          const first = hitsAt(cam, px, py, occludersOf(id))[0];
          if (!first || first.object.userData.zone !== id) continue;
          if (tri(ZONES[id], first.faceIndex).die >= -1e-6) continue;
          const got = surface.screenToDie(id, px, py, { extrapolate: false });
          expect(got, `${id} at ${px},${py}`).not.toBeNull();
          expect(got!.inside).toBe(true);
          worst = Math.max(worst, Math.hypot(got!.x - first.uv.x, got!.y - first.uv.y));
          here++;
        }
        expect(here, id).toBeGreaterThan(50);
        checked += here;
      }
      expect(checked, id).toBeGreaterThanOrEqual(200);
      expect(worst, id).toBeLessThan(0.05);
    }
  });

  it("round-trips die to screen to die within 0.25 px", { timeout: HEAVY_MS }, () => {
    for (const id of IDS) {
      const r = rng(id.length * 104729);
      const faces = printFaces(id);
      for (const cam of viewsOf(id)) {
        const { P } = solveFor(cam, probePointsFor(surface, id));
        surface.setCamera(P);
        const facing = faces.filter((t) => surface.frontFacing(id, t));
        let n = 0, worst = 0;
        for (let tries = 0; tries < 3000 && n < 200 && facing.length; tries++) {
          const { d } = randomOnFace(id, facing, r);
          const s = surface.dieToScreen(id, d[0], d[1]);
          expect(s).not.toBeNull();
          // On a fold, a die point on the hidden layer shows behind the near one:
          // it cannot round-trip (the screen point is the near layer's).
          const near = ownLayersAt(cam, id, s![0], s![1])[0];
          if (near && Math.hypot(near.uv.x - d[0], near.uv.y - d[1]) > 1) continue;
          const back = surface.screenToDie(id, s![0], s![1], { extrapolate: false });
          expect(back, id).not.toBeNull();
          worst = Math.max(worst, Math.hypot(back!.x - d[0], back!.y - d[1]));
          n++;
        }
        expect(n, id).toBeGreaterThan(100);
        expect(worst, id).toBeLessThan(0.25);
      }
    }
  });

  // Found 2026-10-21, switching the site to round E1's surface: the
  // whole-panel overlays fold over themselves seen from the side (the front's
  // lower panels by the bill, a side panel by the button). screenToDie takes
  // the containing triangle nearest the camera, so a point there is the layer
  // the customer sees (before the fix: up to 288.7 die px, 1.4 in, off).
  it("lands on the near layer where a zone folds over itself", { timeout: HEAVY_MS }, () => {
    const id = "front";
    const faces = printFaces(id);
    const r = rng(2026);
    let folds = 0, misses = 0, worst = 0;
    for (const { cam } of editorViews(id).slice(0, 3)) {
      surface.setCamera(solveFor(cam, probePointsFor(surface, id)).P);
      const facing = faces.filter((t) => surface.frontFacing(id, t));
      for (let k = 0; k < 1500; k++) {
        const { X } = randomOnFace(id, facing, r);
        const [px, py] = toScreen(cam, X);
        const layers = ownLayersAt(cam, id, px, py);
        if (layers.length < 2) continue;
        folds++;
        const got = surface.screenToDie(id, px, py, { extrapolate: false });
        if (!got) {
          misses++;
          continue;
        }
        worst = Math.max(worst, Math.hypot(got.x - layers[0].uv.x, got.y - layers[0].uv.y));
      }
    }
    expect(folds).toBeGreaterThan(10);
    // every fold point lands somewhere on the zone: the gap is which layer, not none
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(0.05);
  });

  it("flags as editable exactly the print faces three.js draws, and never returns another", { timeout: HEAVY_MS }, () => {
    for (const cam of [...ORBITS, ...IDS.flatMap(viewsOf), ...IDS.map(behindOf)]) {
      surface.setCamera(solveFor(cam, hatPoints(24, 6)).P);
      for (const id of IDS) {
        const z = ZONES[id];
        for (let t = 0; t < z.indices.length / 3; t++) {
          const { a, b, c, n, die } = tri(z, t);
          // Only triangles wholly in front of the camera (the surface drops a clipped one).
          if ([a, b, c].some((v) => toScreen(cam, vertex(z, v))[2] > 1 || toScreen(cam, vertex(z, v))[2] < -1)) continue;
          const toCam = sub(cam.eye, vertex(z, a));
          const cos = dot(toCam, n) / (Math.hypot(...toCam) * Math.hypot(...n) || 1);
          if (Math.abs(cos) < 1e-6) continue;
          // three.js draws the counter-clockwise face: the camera on its side.
          expect(surface.frontFacing(id, t), `${id} tri ${t}`).toBe(cos > 0 && die < -1e-6);
        }
      }
    }
  });

  it("returns nothing for a spot seen from behind, nor for a label card's mirrored back", { timeout: HEAVY_MS }, () => {
    for (const id of IDS) {
      const cam = behindOf(id);
      surface.setCamera(solveFor(cam, probePointsFor(surface, id)).P);
      // All that still faces this way is a label card's curled top hem, its
      // die's top 2 px, and round E1's whole side panels' edges where they
      // curl round under the button (a third of a percent).
      expect(surface.facingFraction(id), id).toBeLessThan(0.005);
      const own = FRONT_MESHES[IDS.indexOf(id)];
      const r = rng(17);
      let seen = 0, refused = 0;
      for (let k = 0; k < 400; k++) {
        const { X } = randomOnFace(id, printFaces(id), r);
        const [px, py] = toScreen(cam, X);
        if (!hitsAt(cam, px, py, BOTH_MESHES).some((h) => h.object.userData.zone === id)) continue;
        seen++;
        // Whether three.js would draw a print face of this zone under the pixel.
        const drawn = hitsAt(cam, px, py, [own]).some((h) => tri(ZONES[id], h.faceIndex).die < -1e-6);
        const got = surface.screenToDie(id, px, py, { extrapolate: false });
        if (drawn) continue;
        expect(got, `${id} at ${px},${py}`).toBeNull();
        if (surface.facingFraction(id) === 0) expect(surface.screenToDie(id, px, py)).toBeNull();
        refused++;
      }
      expect(seen, id).toBeGreaterThan(100);
      expect(refused / seen, id).toBeGreaterThan(0.95);
    }
  });

  it("carries on past the spot's edge, the way the pointer went, when extrapolating", () => {
    // The back: a straight top edge (round E1's front and sides meet at the button).
    const cam = viewsOf("back")[0];
    surface.setCamera(solveFor(cam, probePointsFor(surface, "back")).P);
    const b = surface.bounds("back");
    const edge = surface.dieToScreen("back", b.x + b.w / 2, b.y + 1)!;
    const above = surface.dieToScreen("back", b.x + b.w / 2, b.y + 20)!;
    // Walk off the top edge, away from the inside point.
    const off: V3 = [edge[0] + (edge[0] - above[0]) * 2, edge[1] + (edge[1] - above[1]) * 2, 0];
    expect(surface.screenToDie("back", off[0], off[1], { extrapolate: false })).toBeNull();
    const out = surface.screenToDie("back", off[0], off[1])!;
    expect(out.inside).toBe(false);
    expect(out.y).toBeLessThan(b.y);
    expect(Math.abs(out.x - (b.x + b.w / 2))).toBeLessThan(5);
  });

  /**
   * The cameras the editor really has: hat-look's viewFor for each spot (the
   * label from below, through the opening), orbited off it as far as the
   * editor's window lets a customer turn it (hat-edit ORBIT_WINDOW: since
   * round E1 the camera is the editor's, so the whole-hat view and anything
   * past the window are no longer places a logo is dragged from). Each P is
   * the surface's own, solved from the zone's probes, as the editor solves it.
   */
  function editorViews(id: string) {
    const label = id.startsWith("label");
    // A variable, not a literal: hat-look types its options as the label shape only.
    const options = { zones: PLACEMENTS, labelShape: id === "label_square" ? "square" : "tall" };
    const v = viewFor(label ? "label" : id, options);
    const [theta, phi, r] = v.orbit.split(/\s+/).map((t: string) => parseFloat(t));
    const target = v.target.split(/\s+/).map((t: string) => parseFloat(t)) as V3;
    const at = (dTheta: number, dPhi: number, name: string) => {
      const th = ((theta + dTheta) * Math.PI) / 180, ph = ((phi + dPhi) * Math.PI) / 180;
      const eye = add(target, [r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th)]);
      return { name, cam: makeCamera(eye, target, { fov: FIELD_OF_VIEW }) };
    };
    const w = label ? LABEL_ORBIT_WINDOW : ORBIT_WINDOW;
    return [
      at(0, 0, "own view"),
      at(w.theta, 0, `+${w.theta} deg`),
      at(-w.theta, 0, `-${w.theta} deg`),
      at(0, -w.phi, `${w.phi} deg higher`),
      at(0, w.phi, `${w.phi} deg lower`),
    ];
  }

  /** The zone's drawn print faces on screen, from three.js's own projection. */
  function drawnOnScreen(id: string, cam: Cam) {
    const z = ZONES[id];
    const out: number[][][] = [];
    for (let t = 0; t < z.indices.length / 3; t++) {
      if (!surface.frontFacing(id, t)) continue;
      const { a, b, c } = tri(z, t);
      out.push([a, b, c].map((v) => toScreen(cam, vertex(z, v))));
    }
    return out;
  }

  /** Screen px from a point to the nearest drawn print face (0 on one). */
  function screenDistance(tris: number[][][], x: number, y: number) {
    const seg = (a: number[], b: number[]) => {
      const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
      const s = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L)) : 0;
      return Math.hypot(a[0] + s * vx - x, a[1] + s * vy - y);
    };
    let best = Infinity;
    for (const [a, b, c] of tris) best = Math.min(best, seg(a, b), seg(b, c), seg(c, a));
    return best;
  }

  /** Die px per screen px at the zone's centre: the scale steps are judged by. */
  function centreGain(id: string) {
    const b = surface.bounds(id);
    const J = surface.jacobian(id, b.x + b.w / 2, b.y + b.h / 2)!;
    return 1 / Math.sqrt(Math.abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]));
  }

  it("off the spot, moves smoothly and stays near it, at the editor's views", { timeout: HEAVY_MS }, () => {
    // 2026-10-21 review: the nearest border triangle's own plane, carried on,
    // put a pointer 4 px off a label card 857 die px out, and 50 deg off the
    // front 149,000 px out, and jumped 40 px for a quarter-pixel move.
    const STEP = 0.25;
    for (const id of IDS) {
      for (const { name, cam } of editorViews(id)) {
        surface.setCamera(solveFor(cam, probePointsFor(surface, id)).P);
        if (surface.facingFraction(id) < 0.5) continue;
        const tris = drawnOnScreen(id, cam);
        const gain = centreGain(id);
        const b = surface.bounds(id);
        const xs = tris.flat().map((p) => p[0]), ys = tris.flat().map((p) => p[1]);
        const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        let walked = 0, inside = 0, missing = 0;
        // Round the spot's screen box, d px out: every point is off the spot.
        for (const d of [1, 4, 10, 40]) {
          const [x0, y0, x1, y1] = [box[0] - d, box[1] - d, box[2] + d, box[3] + d];
          const path: number[][] = [];
          for (let x = x0; x < x1; x += STEP) path.push([x, y0]);
          for (let y = y0; y < y1; y += STEP) path.push([x1, y]);
          for (let x = x1; x > x0; x -= STEP) path.push([x, y1]);
          for (let y = y1; y > y0; y -= STEP) path.push([x0, y]);
          let prev: { x: number; y: number } | null = null;
          let step = { v: 0, at: "" }, reach = { v: 0, at: "" };
          path.forEach(([x, y], k) => {
            const got = surface.screenToDie(id, x, y);
            if (!got) { missing++; prev = null; return; }
            if (got.inside) inside++;
            const at = `${x.toFixed(2)},${y.toFixed(2)}`;
            if (prev) {
              const v = Math.hypot(got.x - prev.x, got.y - prev.y) / STEP / gain;
              if (v > step.v) step = { v, at };
            }
            prev = got;
            if (k % 16) return;
            const D = screenDistance(tris, x, y);
            const off = Math.hypot(Math.max(b.x - got.x, 0, got.x - b.x - b.w), Math.max(b.y - got.y, 0, got.y - b.y - b.h));
            if (off / (D * gain) > reach.v) reach = { v: off / (D * gain), at };
            walked++;
          });
          const where = `${id} ${name} d=${d}`;
          // A quarter pixel moves it no more than a few times the spot's own
          // gain (a little more right by the border, where the map itself is
          // as steep as the spot's turned-away side)...
          expect(step.v, `${where}: die px per screen px over the centre's, at ${step.at}`).toBeLessThan(d < 4 ? 6 : 4);
          // ...and it lands within a few gains times the pointer's distance of the spot.
          expect(reach.v, `${where}: die px off the spot per screen px off it, at ${reach.at}`).toBeLessThan(4);
        }
        expect(missing, `${id} ${name}`).toBe(0);
        expect(inside, `${id} ${name}`).toBe(0);
        expect(walked, `${id} ${name}`).toBeGreaterThan(200);
      }
    }
  });

  it("meets the inside map at the spot's border with no step", () => {
    for (const id of IDS) {
      for (const { name, cam } of editorViews(id).slice(0, 2)) {
        surface.setCamera(solveFor(cam, probePointsFor(surface, id)).P);
        const b = surface.bounds(id);
        const c = surface.dieToScreen(id, b.x + b.w / 2, b.y + b.h / 2)!;
        let crossed = 0;
        for (let k = 0; k < 36; k++) {
          const u = [Math.cos((k / 36) * 2 * Math.PI), Math.sin((k / 36) * 2 * Math.PI)];
          const at = (s: number) => surface.screenToDie(id, c[0] + u[0] * s, c[1] + u[1] * s)!;
          if (!at(0)?.inside) continue;
          let lo = 0, hi = 1;
          while (at(hi).inside && hi < 4000) { lo = hi; hi += 1; }
          // Bisect onto the border: the last point in, the first out.
          for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            if (at(mid).inside) lo = mid; else hi = mid;
          }
          const inside = at(lo), outside = at(hi);
          expect(inside.inside && !outside.inside).toBe(true);
          expect(Math.hypot(inside.x - outside.x, inside.y - outside.y), `${id} ${name} ray ${k}`).toBeLessThan(0.01);
          crossed++;
        }
        expect(crossed, `${id} ${name}`).toBeGreaterThan(30);
      }
    }
  });

  it("looks up 10,000 points in well under 200 ms", () => {
    const cam = viewsOf("front")[0];
    surface.setCamera(solveFor(cam, probePointsFor(surface, "front")).P);
    // The front's screen box (round E1's two panels fill only part of their die box).
    const z = ZONES.front;
    const shown = Array.from({ length: z.positions.length / 3 }, (_, i) => toScreen(cam, vertex(z, i)));
    const xs = shown.map((p) => p[0]), ys = shown.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const r = rng(99);
    // A drag's worth of points: across the spot and 20% beyond it on every side.
    const pts = Array.from({ length: 10000 }, () => [x0 - 0.2 * (x1 - x0) + 1.4 * (x1 - x0) * r(), y0 - 0.2 * (y1 - y0) + 1.4 * (y1 - y0) * r()]);
    let inside = 0;
    const start = performance.now();
    for (const [x, y] of pts) if (surface.screenToDie("front", x, y)?.inside) inside++;
    const ms = performance.now() - start;
    console.log(`hat-surface: 10,000 screenToDie lookups in ${ms.toFixed(1)} ms (${inside} inside the spot)`);
    expect(inside).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(200);
  });
});

describe("dieToScreen, dieToModel and jacobian", () => {
  it("print die points where the model build placed each zone, facing the way it said", () => {
    for (const p of PLACEMENTS.zones) {
      if (!IDS.includes(p.id)) continue;
      // Each zone's centre is its chart's origin on the die (round E1's whole
      // panels are not centred in their die boxes).
      const chart = BUILT.zones.find((z) => z.id === p.id)!.chartToDie;
      const X = surface.dieToModel(p.id, parseFloat(chart.x), parseFloat(chart.y))!;
      // F1 mm (+x forward, +y wearer left, +z up) to glTF metres: (y, z, x) / 1000.
      const c = [p.centre[1] / 1000, p.centre[2] / 1000, p.centre[0] / 1000];
      expect(Math.hypot(...sub(X, c)) * 1000, p.id).toBeLessThan(1.5);
      // The zone's mean normal against the build's at its centre: round E1's
      // whole front (two curved panels) leans 13 degrees off it.
      expect(dot(surface.normal(p.id), [p.normal[1], p.normal[2], p.normal[0]]), p.id).toBeGreaterThan(0.97);
    }
  });

  it("gives the projection's exact local derivative", () => {
    const cam = viewsOf("left")[1];
    surface.setCamera(solveFor(cam, probePointsFor(surface, "left")).P);
    const facing = printFaces("left").filter((t) => surface.frontFacing("left", t));
    const r = rng(5);
    for (let k = 0; k < 50; k++) {
      const [dx, dy] = randomOnFace("left", facing, r).d;
      const J = surface.jacobian("left", dx, dy)!;
      const h = 1e-3;
      const fx1 = surface.dieToScreen("left", dx + h, dy)!, fx0 = surface.dieToScreen("left", dx - h, dy)!;
      const fy1 = surface.dieToScreen("left", dx, dy + h)!, fy0 = surface.dieToScreen("left", dx, dy - h)!;
      const num = [[(fx1[0] - fx0[0]) / (2 * h), (fy1[0] - fy0[0]) / (2 * h)], [(fx1[1] - fx0[1]) / (2 * h), (fy1[1] - fy0[1]) / (2 * h)]];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) expect(J[i][j]).toBeCloseTo(num[i][j], 3);
    }
  });

  it("is null without a camera, and off the print faces", () => {
    const s = createSurface(SURFACE);
    // The front's centre seam, on the fabric; its die box's corner, off it.
    expect(s.dieToScreen("front", 875, 957)).toBeNull();
    expect(s.screenToDie("front", 400, 200)).toBeNull();
    expect(s.dieToModel("front", 875, 957)).not.toBeNull();
    expect(s.dieToModel("front", 40, 40)).toBeNull();
    expect(() => s.bounds("nope")).toThrow(RangeError);
  });
});

// ---- The JSON ---------------------------------------------------------------------------

describe("hat-no7-surface.json", () => {
  it("is what three.js's own GLTFLoader builds from the model, node transforms and all", async () => {
    // Independent of the extractor: the GLB as model-viewer loads it, its
    // textures stripped (node has no image decoder) and nothing else changed.
    const glb = readFileSync(MODEL_FILE);
    const jsonLength = glb.readUInt32LE(12);
    const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
    const rest = glb.subarray(20 + jsonLength);
    delete gltf.images; delete gltf.textures; delete gltf.samplers;
    const strip = (o: unknown) => {
      if (!o || typeof o !== "object") return;
      for (const k of Object.keys(o)) {
        if (/Texture$/.test(k)) delete (o as Record<string, unknown>)[k];
        else strip((o as Record<string, unknown>)[k]);
      }
    };
    for (const m of gltf.materials) strip(m);
    const imageExts = ["EXT_texture_webp", "KHR_texture_transform", "KHR_texture_basisu"];
    for (const key of ["extensionsUsed", "extensionsRequired"]) gltf[key] = gltf[key]?.filter((e: string) => !imageExts.includes(e));
    let text = Buffer.from(JSON.stringify(gltf), "utf8");
    text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(20);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
    head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
    const bytes = Buffer.concat([head, text, rest]);
    await MeshoptDecoder.ready;
    const loaded = await new Promise<{ scene: Loaded }>((resolve, reject) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject),
    );
    loaded.scene.updateMatrixWorld(true);
    const { width: W, height: H } = DIE.stage;
    const built: Record<string, Zone> = {};
    loaded.scene.traverse((o) => {
      const name = o.material?.name;
      if (!o.isMesh || !name?.startsWith("print_")) return;
      const z = (built[name.slice("print_".length)] ||= { material: name, positions: [], uvs: [], indices: [] });
      const base = z.positions.length / 3;
      const { position, uv } = o.geometry.attributes;
      const v = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        z.positions.push(v.x, v.y, v.z);
        z.uvs.push(uv.getX(i) * W, uv.getY(i) * H);
      }
      // three keeps a mirroring node's indices and flips the face at draw time.
      const flip = o.matrixWorld.determinant() < 0;
      const idx: number[] = o.geometry.index ? Array.from(o.geometry.index.array) : Array.from({ length: position.count }, (_, i) => i);
      for (let t = 0; t < idx.length; t += 3) z.indices.push(...(flip ? [idx[t], idx[t + 2], idx[t + 1]] : [idx[t], idx[t + 1], idx[t + 2]]).map((i) => base + i));
    });
    expect(Object.keys(built).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const want = ZONES[id], got = built[id];
      expect(got.positions.length, id).toBe(want.positions.length);
      expect(got.indices, id).toEqual(want.indices);
      let dp = 0, du = 0;
      want.positions.forEach((x, i) => { dp = Math.max(dp, Math.abs(x - got.positions[i])); });
      want.uvs.forEach((x, i) => { du = Math.max(du, Math.abs(x - got.uvs[i])); });
      // The JSON rounds to 1e-6 m and 0.01 px.
      expect(dp, id).toBeLessThan(2e-6);
      expect(du, id).toBeLessThan(0.02);
    }
  });

  it("is what extract_surface.mjs writes from the model the site serves (a rebuilt model needs a rerun)", async () => {
    // node scripts/blender/hat-no7/lab/extract_surface.mjs public<MODEL> public<SURFACE> --die scripts/blender/hat-no7/e1/die_no7.json
    expect(MANIFEST["hat-no-7.glb"].source.split("/").pop()).toBe(SURFACE.model);
    const { json } = await extractSurface(readFileSync(MODEL_FILE), { model: SURFACE.model, frame: DIE.stage });
    expect(formatSurface(json)).toBe(readFileSync(SURFACE_FILE, "utf8"));
  });

  it("is on the die's frame, with a zone for every die zone", () => {
    expect(SURFACE.frame).toEqual(DIE.stage);
    const dieIds = DIE.zones.map((z) => z.id);
    // Round E1 has one inside label, the rectangle, and no other print surface.
    expect([...IDS].sort()).toEqual([...dieIds].sort());
    for (const id of IDS) expect(ZONES[id].material).toBe(`print_${id}`);
  });

  it("covers each zone's rect with its UVs, and its whole area with fabric", () => {
    for (const zone of DIE.zones) {
      if (!IDS.includes(zone.id)) continue;
      // Round E1's rects are each panel's die box, to a pixel or so.
      const b = surface.bounds(zone.id);
      const { x, y, w, h } = zone.rect;
      expect(b.x, zone.id).toBeLessThanOrEqual(x + 1.5);
      expect(b.y, zone.id).toBeLessThanOrEqual(y + 1.5);
      expect(b.x + b.w, zone.id).toBeGreaterThanOrEqual(x + w - 1.5);
      expect(b.y + b.h, zone.id).toBeGreaterThanOrEqual(y + h - 1.5);
      // Every point round the area where a logo may sit (its outline, and
      // each eyelet's keep-out) maps onto the model.
      for (const ring of areaRings(zone.area)) {
        for (let i = 0; i < ring.length; i++) {
          const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
          for (const f of [0, 0.25, 0.5, 0.75]) {
            const [cx, cy] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
            expect(surface.dieToModel(zone.id, cx, cy), `${zone.id} ${cx.toFixed(1)},${cy.toFixed(1)}`).not.toBeNull();
          }
        }
      }
    }
  });
});
