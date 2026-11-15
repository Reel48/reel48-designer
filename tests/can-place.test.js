// Placing on the 3D can's base (v1.16.1): the real placer (hat-place.js
// createPlacer) on the real can surfaces (models/can-cooler-<size>-surface.json)
// under the base side's own camera (createCanLook view("base"), solved from
// hotspot probes as the editor solves it), with the base's limits as the editor
// passes them (canSpotLimits: its disc as a 96-gon), driven by pointer events
// on a minimal fake host.
//
// The glitch it pins (account.reel48.com, v1.16.0): a logo dragged on the base
// past the can's outline slid toward a fold instead of stopping at the base's
// edge. Past the outline the placer carries the finger on along the last true
// hit's local map, so the asked pose runs far outside the disc, and
// region.js's sweep slid the piece round the 96-gon with what was left of
// each frame's long move, past the point nearest the finger, back and forth,
// farther each frame. Now it stops at that point and stays.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { CAN_SURFACES } from "../scripts/extract-can-surface.mjs";
import { confinePose, dieGeometry, poseValid, resolveDie } from "../src/core/index.js";
import { createSurface, measureProjection, probePointsFor } from "../src/viewer/hat-surface.js";
import { createPlacer } from "../src/viewer/hat-place.js";
import { canSpotLimits, createCanLook } from "../src/viewer/can-edit.js";
import { CAN_COOLER_VIEW } from "../src/viewer/can-cooler.js";

const RAD = Math.PI / 180;
const FOV = parseFloat(CAN_COOLER_VIEW["field-of-view"]);
const SIZE = { width: 1200, height: 800 };
const RADIUS = 0.42;
const PIECE = { id: "logo", w: 120, h: 80, rotation: 0 };
const STEPS = 100;
const STEP_PX = 5;

const CANS = CAN_SURFACES.map(({ die, out }) => ({
  die,
  geom: dieGeometry(die),
  surface: createSurface(JSON.parse(readFileSync(new URL(`../${out}`, import.meta.url), "utf8"))),
}));

// ---- A minimal DOM: what the placer touches ----------------------------------------
class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  hasAttribute(k) {
    return k in this.attrs;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    this.children = this.children.filter((n) => n !== c);
    c.parentNode = null;
    return c;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}

class FakeHost extends FakeNode {
  constructor(doc) {
    super("div");
    this.ownerDocument = doc;
    this.listeners = [];
    this.captured = new Set();
    this.clientHeight = SIZE.height;
    this.tabIndex = -1;
  }
  addEventListener(type, fn) {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, ...SIZE };
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  focus() {}
  fire(type, init) {
    const e = { type, target: this, ...init, preventDefault() {}, stopPropagation() {} };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
  }
}

// ---- The base side's camera ---------------------------------------------------------
/** The camera createCanLook's view("base") puts model-viewer at, as a three.js camera. */
function baseCamera(die) {
  const mv = {
    cameraOrbit: "0deg 80deg auto",
    cameraTarget: "",
    addEventListener() {},
    removeEventListener() {},
    getCameraOrbit: () => ({ theta: 0, phi: 80 * RAD, radius: RADIUS }),
  };
  createCanLook(mv, { stage: resolveDie(die).stage }).view("base");
  const [theta, phi, r] = mv.cameraOrbit.split(/\s+/).map((s) => parseFloat(s));
  const target = mv.cameraTarget.split(/\s+/).map((s) => parseFloat(s));
  const th = theta * RAD;
  const ph = phi * RAD;
  const camera = new THREE.PerspectiveCamera(FOV, SIZE.width / SIZE.height, 0.005, 10);
  camera.position.set(target[0] + r * Math.sin(ph) * Math.sin(th), target[1] + r * Math.cos(ph), target[2] + r * Math.sin(ph) * Math.cos(th));
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** model-viewer's hotspot API over a three.js camera (tests/can-surface.test.js's). */
function hotspots(camera) {
  let probe = [0, 0, 0];
  return {
    updateHotspot({ name, position }) {
      if (name === "hotspot-probe") probe = position.trim().split(/\s+/).map((s) => parseFloat(s));
    },
    queryHotspot(name) {
      if (name !== "hotspot-probe") return null;
      const v = new THREE.Vector3(...probe).project(camera);
      return { canvasPosition: { x: (v.x + 1) * (SIZE.width / 2), y: (1 - v.y) * (SIZE.height / 2), z: v.z } };
    },
  };
}

/**
 * One drag of a piece from the base's centre: pressed on it, moved STEPS
 * times STEP_PX px along `angle` (degrees, screen, y down), released. Returns
 * the live poses, the commit, and how many steps the finger was off the base.
 */
function dragFromCentre(can, angle) {
  const { surface, geom, die } = can;
  const camera = baseCamera(die);
  const solved = measureProjection(hotspots(camera), probePointsFor(surface, "base"), { name: "probe" });
  surface.setCamera(solved.P);
  const lim = canSpotLimits(die, "base");
  const doc = { createElementNS: (_ns, tag) => new FakeNode(tag), activeElement: null, defaultView: { getComputedStyle: () => ({ position: "relative" }) } };
  const host = new FakeHost(doc);
  const frames = new Map();
  let next = 1;
  const flush = () => {
    for (let i = 0; i < 10 && frames.size; i++) {
      const list = [...frames.values()];
      frames.clear();
      for (const f of list) f(0);
    }
  };
  const live = [];
  const commits = [];
  const start = { ...PIECE, cx: geom.cx, cy: geom.cy };
  const placer = createPlacer(host, {
    surface,
    zone: "base",
    area: lim.area,
    cap: lim.cap,
    pieces: [start],
    selectedId: PIECE.id,
    pxPerInch: lim.pxPerInch,
    snapX: lim.snapX,
    snapCentre: false,
    level: lim.level,
    requestFrame: (cb) => {
      frames.set(next, cb);
      return next++;
    },
    cancelFrame: (id) => frames.delete(id),
    onLive: (_id, pose) => live.push(pose),
    onCommit: (_id, pose) => commits.push(pose),
  });
  const ev = (p) => ({ pointerId: 1, pointerType: "mouse", clientX: p[0], clientY: p[1], button: 0, isPrimary: true });
  let p = surface.dieToScreen("base", geom.cx, geom.cy);
  const dir = [Math.cos(angle * RAD), Math.sin(angle * RAD)];
  // the finger's way in the die: where its first 100 px on the bottom take it
  // (one triangle's own map, at the centre, can be a few degrees off)
  const reach = surface.screenToDie("base", p[0] + 100 * dir[0], p[1] + 100 * dir[1], { extrapolate: false });
  const u = [reach.x - geom.cx, reach.y - geom.cy];
  const un = Math.hypot(u[0], u[1]);
  host.fire("pointerdown", ev(p));
  flush();
  let off = 0;
  for (let i = 0; i < STEPS; i++) {
    p = [p[0] + dir[0] * STEP_PX, p[1] + dir[1] * STEP_PX];
    host.fire("pointermove", ev(p));
    flush();
    if (!surface.screenToDie("base", p[0], p[1], { extrapolate: false })) off++;
  }
  host.fire("pointerup", ev(p));
  flush();
  placer.destroy();
  surface.setCamera(null);
  return { live, commits, off, lim, start, way: [u[0] / un, u[1] / un] };
}

describe("a drag on the can's base past the can's outline (v1.16.1)", () => {
  it("stops the piece at the base's edge where the finger points, and holds it there", () => {
    // Through the flat bottom's edge: straight out each way, and the diagonals
    // that leave through the side of the bottom.
    for (const can of CANS) {
      for (const angle of [0, 30, 90, 150, 180, 210, 270, 330]) {
        const at = `${can.die} ${angle} deg`;
        const { commits, off, lim, start, way } = dragFromCentre(can, angle);
        expect(off, `${at}: the finger goes well past the outline`).toBeGreaterThan(30);
        expect(commits, at).toHaveLength(1);
        const got = commits[0];
        expect(poseValid(got, lim), at).toBe(true);
        // where a push that way from the centre stops: the edge's point nearest it
        const far = confinePose({ ...start, cx: start.cx + 5000 * way[0], cy: start.cy + 5000 * way[1] }, { area: lim.area, cap: lim.cap, from: start });
        expect(Math.hypot(got.cx - far.cx, got.cy - far.cy), `${at}: (${got.cx.toFixed(1)}, ${got.cy.toFixed(1)}) against (${far.cx.toFixed(1)}, ${far.cy.toFixed(1)})`).toBeLessThan(12);
        // at the edge: a step further out does not fit
        expect(poseValid({ ...got, cx: got.cx + 2 * way[0], cy: got.cy + 2 * way[1] }, lim), at).toBe(false);
      }
      // Straight out, it lands on the line it was dragged along, to a pixel.
      const right = dragFromCentre(can, 0).commits[0];
      expect(Math.abs(right.cy - can.geom.cy)).toBeLessThan(1);
      const down = dragFromCentre(can, 90).commits[0];
      expect(Math.abs(down.cx - can.geom.cx)).toBeLessThan(1);
    }
  });

  it("never rides round the edge, whichever way it leaves: past the outline it settles and stays", () => {
    for (const can of CANS) {
      for (let angle = 0; angle < 360; angle += 30) {
        const at = `${can.die} ${angle} deg`;
        const { live, commits, off, lim } = dragFromCentre(can, angle);
        expect(off, at).toBeGreaterThan(20);
        const got = commits[0];
        expect(poseValid(got, lim), at).toBe(true);
        // the last 20 frames are all well past the outline: the piece shows
        // within the rubber band of where it rests, and does not wander (it
        // rode 25 to 300 px a frame; leaving through the roll, the finger's
        // way in the die still turns a little as it settles, a few px a frame)
        const tail = live.slice(-20);
        for (let i = 1; i < tail.length; i++) {
          expect(Math.hypot(tail[i].cx - tail[i - 1].cx, tail[i].cy - tail[i - 1].cy), at).toBeLessThan(5);
        }
        for (const pose of tail) expect(Math.hypot(pose.cx - got.cx, pose.cy - got.cy), at).toBeLessThan(30);
        // and it never comes near a fold's middle unless dragged that way
        const towardFold = Math.abs(Math.sin(angle * RAD)) > 0.8;
        if (!towardFold) {
          const { cx, y1, y2 } = can.geom;
          expect(Math.hypot(got.cx - cx, got.cy - y1) > 60 && Math.hypot(got.cx - cx, got.cy - y2) > 60, `${at}: (${got.cx.toFixed(0)}, ${got.cy.toFixed(0)})`).toBe(true);
        }
      }
    }
  });
});
