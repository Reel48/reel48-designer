// The can cooler's print surfaces (v1.16.0): models/can-cooler-<size>-surface.json,
// made from the GLBs beside them by scripts/extract-can-surface.mjs, read by
// hat-surface.js createSurface for editing on the 3D can (can-edit.js).
//
// Checked: the files are what the script writes from the shipped models (so a
// rebuilt model needs a rerun), byte for byte, twice; each side holds exactly
// the print faces that touch its region of the die (confine.js faceRegions)
// within the script's margin; and, at the can's own 13 degree field of view,
// the map round-trips through a three.js camera the way model-viewer projects:
// the camera solved by DLT from hotspot probes, die to screen to die within a
// pixel (in fact a millionth), and each screen pixel's die point what a
// three.js ray hits.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { CAN_SURFACES, MARGIN_PX, extractCanSurface, facesDown, formatSurface, sidesOf } from "../scripts/extract-can-surface.mjs";
import { dieGeometry, faceRegions, resolveDie } from "../src/core/index.js";
import { createSurface, measureProjection, probePointsFor, project, solveProjection } from "../src/viewer/hat-surface.js";
import { CAN_EDIT_VIEWS, createCanLook } from "../src/viewer/can-edit.js";
import { CAN_COOLER_VIEW } from "../src/viewer/can-cooler.js";
import { MAX_RESIDUAL_PX } from "../src/viewer/hat-edit.js";

const RAD = Math.PI / 180;
const FOV = parseFloat(CAN_COOLER_VIEW["field-of-view"]);
const SIDES = ["front", "back", "base"];
const HEAVY_MS = 30_000;

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const CANS = CAN_SURFACES.map(({ die, glb, out }) => {
  const json = JSON.parse(read(out).toString("utf8"));
  return { die, glb, out, json, surface: createSurface(json), geom: dieGeometry(die), stage: resolveDie(die).stage };
});

/** A side's triangle t: its die px corners and twice its signed die area (y down). */
function dieTri(z, t) {
  const [a, b, c] = [z.indices[3 * t], z.indices[3 * t + 1], z.indices[3 * t + 2]];
  const U = z.uvs;
  const d = [U[2 * a], U[2 * a + 1], U[2 * b], U[2 * b + 1], U[2 * c], U[2 * c + 1]];
  const area2 = (d[2] - d[0]) * (d[5] - d[1]) - (d[3] - d[1]) * (d[4] - d[0]);
  return { a, b, c, d, area2 };
}

const vertex = (z, i) => [z.positions[3 * i], z.positions[3 * i + 1], z.positions[3 * i + 2]];

/** A seeded generator, so a failure reproduces. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the can coolers' surface files", () => {
  it("are what scripts/extract-can-surface.mjs writes from the shipped models, the same bytes every run", async () => {
    for (const can of CANS) {
      const model = can.glb.split("/").pop();
      const first = await extractCanSurface(read(can.glb), { dieId: can.die, model });
      const again = await extractCanSurface(read(can.glb), { dieId: can.die, model });
      expect(first.report.failures, can.die).toEqual([]);
      expect(formatSurface(first.json)).toBe(read(can.out).toString("utf8"));
      expect(formatSurface(again.json)).toBe(formatSurface(first.json));
      // The wrap the script checks, as numbers: the rims are the panels' top edges.
      const w = first.report.wrap;
      expect(Math.abs(w.frontRimDieY - can.geom.y0)).toBeLessThan(5);
      expect(Math.abs(w.backRimDieY - can.geom.y3)).toBeLessThan(5);
      // Every print triangle of the sleeve is on a side, and none is mirrored.
      expect(first.report.orphans).toBe(0);
      expect(first.report.mirrored).toBe(0);
      expect(first.report.normalsDisagree).toBe(0);
    }
  });

  it("are on their die's frame, with exactly the three sides, and read", () => {
    for (const can of CANS) {
      expect(can.json.frame).toEqual(can.stage);
      expect(Object.keys(can.json.zones)).toEqual(SIDES);
      expect(can.surface.zoneIds).toEqual(SIDES);
      for (const id of SIDES) {
        const z = can.json.zones[id];
        expect(Object.keys(z)).toEqual(["positions", "uvs", "indices"]);
        expect(z.uvs.length / 2).toBe(z.positions.length / 3);
        expect(z.indices.length % 3).toBe(0);
        expect(Math.max(...z.indices)).toBe(z.positions.length / 3 - 1);
      }
    }
  });

  it("hold, per side, exactly the print faces that touch its region within the margin, each a print face", () => {
    // v1.17.0: by which way the face points too. A face on the disc that faces
    // down is the bottom, the base's alone; every other face is the panels'.
    for (const can of CANS) {
      const regions = faceRegions(can.geom);
      // Every triangle of the sleeve's print, by its die corners, with the sides it is listed on.
      const listed = new Map();
      for (const id of SIDES) {
        const z = can.json.zones[id];
        for (let t = 0; t < z.indices.length / 3; t++) {
          const { a, b, c, d, area2 } = dieTri(z, t);
          // A print face: hat-surface.js's PRINT_WINDING (negative, y down) and not a sliver.
          expect(area2).toBeLessThan(-1e-6);
          const key = d.join(",");
          if (!listed.has(key)) listed.set(key, { d, down: facesDown(vertex(z, a), vertex(z, b), vertex(z, c)), on: [] });
          listed.get(key).on.push(id);
        }
      }
      for (const { d, down, on } of listed.values()) {
        expect(on.sort()).toEqual([...sidesOf(d, regions, down)].sort());
        expect(on.length).toBeGreaterThan(0);
      }
      for (const id of SIDES) {
        // Its die bounds are its region's box, out by no more than the margin
        // and the longest die edge of a triangle that touches it.
        const z = can.json.zones[id];
        let longest = 0;
        for (let t = 0; t < z.indices.length / 3; t++) {
          const { d } = dieTri(z, t);
          longest = Math.max(longest, Math.hypot(d[2] - d[0], d[3] - d[1]), Math.hypot(d[4] - d[2], d[5] - d[3]), Math.hypot(d[0] - d[4], d[1] - d[5]));
        }
        const r = regions[id];
        const box = r.kind === "circle" ? { x0: r.cx - r.r, y0: r.cy - r.r, x1: r.cx + r.r, y1: r.cy + r.r } : r;
        const b = can.surface.bounds(id);
        const reach = MARGIN_PX + longest;
        expect(b.x).toBeGreaterThanOrEqual(box.x0 - reach);
        expect(b.y).toBeGreaterThanOrEqual(box.y0 - reach);
        expect(b.x + b.w).toBeLessThanOrEqual(box.x1 + reach);
        expect(b.y + b.h).toBeLessThanOrEqual(box.y1 + reach);
        // (the model's bottom disc is six rings, about a fifth of its radius apart)
        expect(longest).toBeLessThan(60);
      }
      // The panels: the whole rect, but for the rim's thin unprinted lip (the print stops 2 * 0.5 mm below it).
      for (const id of ["front", "back"]) {
        const r = regions[id];
        const b = can.surface.bounds(id);
        expect(b.x).toBeLessThan(r.x0 + 1);
        expect(b.x + b.w).toBeGreaterThan(r.x1 - 1);
        expect(b.h).toBeGreaterThan(r.y1 - r.y0 - 5);
      }
      // The base: the band between the folds (the model's bottom disc) and the
      // disc's caps past each fold (the bottom of each panel's wall).
      const base = can.surface.bounds("base");
      expect(base.y).toBeLessThan(can.geom.y1 - (can.geom.r - (can.geom.y2 - can.geom.y1) / 2) + 10);
      expect(base.y + base.h).toBeGreaterThan(can.geom.y2 + (can.geom.r - (can.geom.y2 - can.geom.y1) / 2) - 10);
    }
  });

  it("put the base's caps on the bottom of each panel's wall, and the band on the bottom of the can", () => {
    for (const can of CANS) {
      const z = can.json.zones.base;
      const { cy, y1, y2 } = can.geom;
      let wallFront = 0, wallBack = 0, bottom = 0;
      for (let i = 0; i < z.positions.length / 3; i++) {
        const [, y, zc] = vertex(z, i);
        const dy = z.uvs[2 * i + 1];
        if (dy < y1 - 3) {
          wallFront++;
          expect(zc, "a front cap point is on the front (+z)").toBeGreaterThan(0);
        } else if (dy > y2 + 3) {
          wallBack++;
          expect(zc, "a back cap point is on the back (-z)").toBeLessThan(0);
        } else if (y < 1e-4) {
          bottom++;
          // the front fold is toward +z
          if (Math.abs(dy - cy) > 50) expect(Math.sign(zc)).toBe(dy < cy ? 1 : -1);
        }
      }
      expect(wallFront).toBeGreaterThan(20);
      expect(wallBack).toBeGreaterThan(20);
      expect(bottom).toBeGreaterThan(100);
    }
  });
});

// ---- At the can's own view ----------------------------------------------------------------

function makeCamera(eye, look, { fov = FOV, width = 800, height = 600 } = {}) {
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.005, 10);
  camera.position.set(...eye);
  camera.lookAt(new THREE.Vector3(...look));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return { camera, width, height };
}

/** queryHotspot's canvasPosition: CSS px from the element's top-left, y down; z is NDC. */
function toScreen(cam, X) {
  const v = new THREE.Vector3(X[0], X[1], X[2]).project(cam.camera);
  return [v.x * (cam.width / 2) + cam.width / 2, -(v.y * (cam.height / 2)) + cam.height / 2, v.z];
}

/**
 * The camera a CAN_EDIT_VIEWS spot puts model-viewer at: createCanLook's own
 * view() on a stand-in element on the approved view, whose auto radius is
 * `radius`; it records the orbit and target view() sets.
 */
function viewCamera(can, spot, radius, size) {
  const mv = { cameraOrbit: "0deg 80deg auto", cameraTarget: "", addEventListener() {}, removeEventListener() {}, getCameraOrbit: () => ({ theta: 0, phi: 80 * RAD, radius }) };
  createCanLook(mv, { stage: can.stage }).view(spot);
  const [theta, phi, r] = mv.cameraOrbit.split(/\s+/).map((s) => parseFloat(s));
  expect(r).toBeCloseTo(radius, 6);
  const target = mv.cameraTarget.split(/\s+/).map((s) => parseFloat(s));
  expect(target.every(Number.isFinite)).toBe(true);
  const th = theta * RAD, ph = phi * RAD;
  const eye = [target[0] + r * Math.sin(ph) * Math.sin(th), target[1] + r * Math.cos(ph), target[2] + r * Math.sin(ph) * Math.cos(th)];
  return makeCamera(eye, target, size);
}

/** A hotspot API over a three.js camera, as model-viewer 4.2.0's (tests/storefront/hat-surface.test.ts's). */
function hotspots(cam) {
  let probe = [0, 0, 0];
  return {
    updateHotspot({ name, position }) {
      if (name === "hotspot-probe") probe = position.trim().split(/\s+/).map((s) => parseFloat(s));
    },
    queryHotspot(name) {
      if (name !== "hotspot-probe") return null;
      const [x, y, z] = toScreen(cam, probe);
      return { canvasPosition: { x, y, z } };
    },
  };
}

const PHONE = { width: 390, height: 640 };
const LAPTOP = { width: 1200, height: 800 };
// Near and far: about the fits the editor makes, and the approved view's distance.
const VIEWS = [
  [0.42, LAPTOP],
  [0.65, PHONE],
];

/**
 * Random points on a side's print faces that face the camera at more than a
 * grazing angle. Nearer the silhouette (the side seams seen from the front,
 * the bottom roll) the sleeve's soft relief folds over itself on screen, and
 * a point there can be hidden behind a nearer fold: screenToDie rightly gives
 * the fold in front.
 */
function facingPoints(can, id, count, seed, eye) {
  const z = can.json.zones[id];
  const r = rng(seed);
  const tris = [];
  for (let t = 0; t < z.indices.length / 3; t++) {
    if (!can.surface.frontFacing(id, t)) continue;
    const { a, b, c } = dieTri(z, t);
    const [A, B, C] = [vertex(z, a), vertex(z, b), vertex(z, c)];
    const e1 = [0, 1, 2].map((k) => B[k] - A[k]), e2 = [0, 1, 2].map((k) => C[k] - A[k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const v = [0, 1, 2].map((k) => eye[k] - (A[k] + B[k] + C[k]) / 3);
    const cos = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / (Math.hypot(...n) * Math.hypot(...v) || 1);
    if (cos > 0.3) tris.push(t);
  }
  const out = [];
  for (let k = 0; k < count && tris.length; k++) {
    const t = tris[Math.floor(r() * tris.length)];
    let l1 = r(), l2 = r();
    if (l1 + l2 > 1) { l1 = 1 - l1; l2 = 1 - l2; }
    const { a, b, c } = dieTri(z, t);
    const l0 = 1 - l1 - l2;
    const d = [0, 1].map((q) => l0 * z.uvs[2 * a + q] + l1 * z.uvs[2 * b + q] + l2 * z.uvs[2 * c + q]);
    out.push(d);
  }
  return out;
}

describe("the map at the can's 13 degree field of view", () => {
  it("solves model-viewer's camera from each side's probes, exactly (narrow is near-affine, but not degenerate)", () => {
    for (const can of CANS) {
      for (const spot of SIDES) {
        for (const [radius, size] of VIEWS) {
          const cam = viewCamera(can, spot, radius, size);
          const points = probePointsFor(can.surface, spot);
          expect(points.length, `${can.die} ${spot}`).toBeGreaterThanOrEqual(8);
          const res = measureProjection(hotspots(cam), points, { name: "probe" });
          expect(res, `${can.die} ${spot}`).not.toBeNull();
          expect(res.residual).toBeLessThan(1e-4);
          expect(res.residual).toBeLessThan(MAX_RESIDUAL_PX);
          // and it is the camera, not just a fit to the probes: anywhere on the can
          const z = can.json.zones[spot];
          let worst = 0;
          for (let i = 0; i < z.positions.length / 3; i += 37) {
            const X = vertex(z, i);
            const [sx, sy] = project(res.P, X);
            const [tx, ty] = toScreen(cam, X);
            worst = Math.max(worst, Math.hypot(sx - tx, sy - ty));
          }
          expect(worst, `${can.die} ${spot} ${radius}`).toBeLessThan(1e-3);
          // the hats' own solve from the same pairs
          const pairs = points.map((X) => ({ X, s: toScreen(cam, X).slice(0, 2) }));
          expect(solveProjection(pairs).residual).toBeLessThan(1e-4);
        }
      }
    }
  });

  it("round-trips die to screen to die within a pixel on every side, from its own view", { timeout: HEAVY_MS }, () => {
    for (const can of CANS) {
      for (const spot of SIDES) {
        for (const [radius, size] of VIEWS) {
          const cam = viewCamera(can, spot, radius, size);
          const res = measureProjection(hotspots(cam), probePointsFor(can.surface, spot), { name: "probe" });
          can.surface.setCamera(res.P);
          expect(can.surface.facingFraction(spot)).toBeGreaterThan(spot === "base" ? 0.4 : 0.45);
          let worst = 0;
          for (const [dx, dy] of facingPoints(can, spot, 300, 7, cam.camera.position.toArray())) {
            const s = can.surface.dieToScreen(spot, dx, dy);
            expect(s).not.toBeNull();
            const back = can.surface.screenToDie(spot, s[0], s[1]);
            expect(back.inside).toBe(true);
            worst = Math.max(worst, Math.hypot(back.x - dx, back.y - dy));
          }
          expect(worst, `${can.die} ${spot} ${radius}`).toBeLessThan(1);
          expect(worst).toBeLessThan(1e-3);
        }
      }
      can.surface.setCamera(null);
    }
  });

  it("lands each screen pixel on the die point a three.js ray hits on that side", { timeout: HEAVY_MS }, () => {
    const raycaster = new THREE.Raycaster();
    for (const can of CANS) {
      for (const spot of SIDES) {
        const z = can.json.zones[spot];
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(Float64Array.from(z.positions), 3));
        g.setAttribute("uv", new THREE.BufferAttribute(Float64Array.from(z.uvs), 2));
        g.setIndex(z.indices);
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
        mesh.updateMatrixWorld(true);
        const cam = viewCamera(can, spot, 0.42, LAPTOP);
        const res = measureProjection(hotspots(cam), probePointsFor(can.surface, spot), { name: "probe" });
        can.surface.setCamera(res.P);
        let hits = 0, worst = 0;
        for (let py = 5; py < LAPTOP.height; py += 13) {
          for (let px = 5; px < LAPTOP.width; px += 13) {
            raycaster.setFromCamera(new THREE.Vector2((px / LAPTOP.width) * 2 - 1, -((py / LAPTOP.height) * 2 - 1)), cam.camera);
            const hit = raycaster.intersectObject(mesh, false)[0];
            const got = can.surface.screenToDie(spot, px, py, { extrapolate: false });
            if (!hit) continue;
            hits++;
            expect(got, `${can.die} ${spot} ${px},${py}`).not.toBeNull();
            worst = Math.max(worst, Math.hypot(got.x - hit.uv.x, got.y - hit.uv.y));
          }
        }
        expect(hits, `${can.die} ${spot}`).toBeGreaterThan(300);
        expect(worst, `${can.die} ${spot}`).toBeLessThan(0.05);
      }
      can.surface.setCamera(null);
    }
  });

  it("aims the side views where the side is: on screen, round the middle", () => {
    for (const can of CANS) {
      for (const spot of SIDES) {
        const cam = viewCamera(can, spot, 0.42, LAPTOP);
        const res = measureProjection(hotspots(cam), probePointsFor(can.surface, spot), { name: "probe" });
        can.surface.setCamera(res.P);
        const b = can.surface.bounds(spot);
        const home = spot === "base" ? [can.geom.cx, can.geom.cy] : [b.x + b.w / 2, b.y + b.h / 2];
        const s = can.surface.dieToScreen(spot, home[0], home[1]);
        expect(Math.abs(s[0] - LAPTOP.width / 2), `${can.die} ${spot}`).toBeLessThan(LAPTOP.width * 0.05);
        expect(Math.abs(s[1] - LAPTOP.height / 2), `${can.die} ${spot}`).toBeLessThan(LAPTOP.height * 0.12);
        // and upright: the front's top edge above its middle; the back's (turned in the die) too
        if (spot !== "base") {
          const top = can.surface.dieToScreen(spot, home[0], spot === "front" ? b.y + 5 : b.y + b.h - 5);
          expect(top[1]).toBeLessThan(s[1] - 50);
        } else {
          // the base from below, front: the die's front fold (upper chord) toward the top of the screen
          const fold = can.surface.dieToScreen(spot, can.geom.cx, can.geom.y1 + 10);
          expect(fold[1]).toBeLessThan(s[1]);
          // and its right (die x) to the right
          const right = can.surface.dieToScreen(spot, can.geom.cx + 150, can.geom.cy);
          expect(right[0]).toBeGreaterThan(s[0]);
        }
      }
      can.surface.setCamera(null);
    }
  });
});

// Keep the view table honest: the base view is at the viewer's limit, the panels at the approved height.
it("CAN_EDIT_VIEWS sits inside the viewer's own orbit limits", () => {
  const phiMin = parseFloat(CAN_COOLER_VIEW["min-camera-orbit"].split(/\s+/)[1]);
  const phiMax = parseFloat(CAN_COOLER_VIEW["max-camera-orbit"].split(/\s+/)[1]);
  for (const v of Object.values(CAN_EDIT_VIEWS)) {
    expect(v.phi).toBeGreaterThanOrEqual(phiMin);
    expect(v.phi).toBeLessThanOrEqual(phiMax);
  }
  expect(CAN_EDIT_VIEWS.base.phi).toBe(phiMax);
});
