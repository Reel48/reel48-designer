// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-edit.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted: hat-3d-assets.js names no URLs here, so the served surface is read from
// models/hat-no-7-surface.json, and round E1's die from tests/hat-no-7-v2.golden.json (a byte copy
// of the storefront's scripts/blender/hat-no7/e1/die_no7.json). Nothing dropped.
/**
 * Hat3D's on-hat editor (round E1, 2026-10-21): the glue in hat-edit.js,
 * driven in node. A fake <model-viewer> orbits a real three.js camera round
 * the No. 7 the way model-viewer does (its goal, a jump, a frame that eases to
 * the goal and renders), and answers updateHotspot / queryHotspot from the
 * camera of the LAST RENDERED frame, as model-viewer 4.2.0 does; the surface
 * is the one the site serves. Checked: the camera is measured after a change
 * and again when one lands while a measurement waits (the stale-measure
 * regression the lab found), each spot is zoomed to fill the editor, the
 * orbit is held to its window and keeps the fit's radius when turned
 * mid-flight, a gesture paints live as the lab does and commits once, and a
 * gesture that ends with no commit (the real placer's two-finger tap) or loses
 * its piece leaves nothing held live.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error three is plain JS here: @types/three is not a dependency.
import * as THREE from "three";
import PLACEMENTS from "../../src/viewer/hat-no7-placements.js";
import { FIELD_OF_VIEW, pieceMatrix, viewFor } from "../../src/viewer/hat-look.js";
import { createPlacer, orbitFrom } from "../../src/viewer/hat-place.js";
import { createSurface, measureProjection, probePointsFor, project } from "../../src/viewer/hat-surface.js";
import {
  LABEL_ORBIT_WINDOW,
  ORBIT_WINDOW,
  SPOT_FILL,
  areaFitPoints,
  createCameraAdapter,
  createEditSession,
  createProjector,
  fitSpot,
  goalRadius,
  orbitWindow,
  samePose,
  spotOfZone,
} from "../../src/viewer/hat-edit.js";

const RAD = Math.PI / 180;
const SURFACE_JSON = JSON.parse(readFileSync("models/hat-no-7-surface.json", "utf8"));
// The served model's die (round E1), read from the build until hat-config.js names it.
type Area = { outline: number[][]; holes?: number[][][] } | { x: number; y: number; w: number; h: number };
const DIE = JSON.parse(readFileSync("tests/hat-no-7-v2.golden.json", "utf8")) as {
  pxPerInch: number;
  zones: { id: string; rect: { x: number; y: number; w: number; h: number }; area?: Area; maxImprint: { w: number; h: number } }[];
};
const zoneOf = (id: string) => DIE.zones.find((z) => z.id === id)!;
// A variable, not a literal: hat-look types viewFor's options as the label shape only.
const VIEWS = { zones: PLACEMENTS, labelShape: "tall" };
const areaOf = (id: string): Area => zoneOf(id).area ?? zoneOf(id).rect;

type Orbit = { theta: number; phi: number; radius: number };
type Cam = InstanceType<typeof THREE.PerspectiveCamera>;

/** requestAnimationFrame by hand: `run` is one frame (model-viewer's tick and render first, then the callbacks queued before it). */
function frames() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    request: (cb: () => void) => {
      pending.set(++next, cb);
      return next;
    },
    cancel: (id: number) => {
      pending.delete(id);
    },
    run(mv?: { tick: () => void }) {
      mv?.tick();
      const now = [...pending.values()];
      pending.clear();
      for (const cb of now) cb();
    },
    get waiting() {
      return pending.size;
    },
  };
}

/**
 * model-viewer as the editor sees it: cameraOrbit / cameraTarget /
 * fieldOfView set a goal, jumpCameraToGoal lands on it (camera-change at
 * once), a frame eases to it (here in one step) and renders, and the hotspot
 * API projects with the camera the last frame rendered. The radius is held
 * to [minRadius, maxRadius], as model-viewer's own limits hold it. With `ease`
 * below 1 a frame goes only that part of the way, and getCameraOrbit() is the
 * camera mid-flight, as model-viewer 4.2.0's is ($lastSpherical).
 */
function fakeViewer({ width = 390, height = 640, minRadius = 0.06, maxRadius = Infinity, noise = 0, ease = 1 } = {}) {
  const events = new EventTarget();
  let goal: Orbit = { theta: 0, phi: 76 * RAD, radius: 0.6 };
  let now: Orbit = { ...goal };
  let target = [0, 0.03, -0.035];
  let fov = FIELD_OF_VIEW;
  let orbitText = "0deg 76deg 0.6m";
  const clamp = (o: Orbit): Orbit => ({ ...o, radius: Math.min(maxRadius, Math.max(minRadius, o.radius)) });
  const angle = (t: string) => (t.endsWith("rad") ? parseFloat(t) : parseFloat(t) * RAD);
  const cameraFor = (o: Orbit): Cam => {
    const c = new THREE.PerspectiveCamera(fov, width / height, 0.005, 10);
    const eye = [
      target[0] + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      target[1] + o.radius * Math.cos(o.phi),
      target[2] + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
    ];
    c.position.set(eye[0], eye[1], eye[2]);
    c.lookAt(new THREE.Vector3(target[0], target[1], target[2]));
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    return c;
  };
  let rendered = cameraFor(now);
  const probe = new THREE.Vector3();
  let jitter = 0;
  const changed = () => events.dispatchEvent(new Event("camera-change"));
  return {
    width,
    height,
    addEventListener: (type: string, fn: () => void) => events.addEventListener(type, fn),
    removeEventListener: (type: string, fn: () => void) => events.removeEventListener(type, fn),
    get cameraOrbit() {
      return orbitText;
    },
    set cameraOrbit(v: string) {
      orbitText = v;
      const [t, p, r] = v.trim().split(/\s+/);
      goal = { theta: angle(t), phi: angle(p), radius: r === "auto" ? goal.radius : parseFloat(r) };
    },
    set cameraTarget(v: string) {
      const xyz = v.trim().split(/\s+/).map((s) => parseFloat(s));
      if (xyz.length === 3 && xyz.every(Number.isFinite)) target = xyz;
    },
    set fieldOfView(v: string) {
      fov = parseFloat(v);
    },
    getCameraOrbit: () => ({ ...now }),
    jumpCameraToGoal() {
      now = clamp(goal);
      changed();
    },
    /** One of model-viewer's frames: ease to the goal (all the way unless `ease` says), then render. */
    tick() {
      const g = clamp(goal);
      const to = (a: number, b: number) => (ease >= 1 || Math.abs(b - a) < 1e-9 ? b : a + (b - a) * ease);
      if (g.theta !== now.theta || g.phi !== now.phi || g.radius !== now.radius) {
        now = { theta: to(now.theta, g.theta), phi: to(now.phi, g.phi), radius: to(now.radius, g.radius) };
        changed();
      }
      rendered = cameraFor(now);
    },
    /** The camera as it is now (not as last rendered). */
    camera: () => cameraFor(now),
    updateHotspot({ name, position }: { name: string; position: string }) {
      if (name !== "hotspot-probe") return;
      const [x, y, z] = position.trim().split(/\s+/).map((s) => parseFloat(s));
      probe.set(x, y, z);
    },
    queryHotspot(name: string) {
      if (name !== "hotspot-probe") return null;
      const v = probe.clone().project(rendered);
      // A viewer whose hotspots are not where the surface thinks (a transformed model, say).
      const n = noise ? noise * Math.sin(++jitter * 12.9898) : 0;
      return { canvasPosition: { x: (v.x * width) / 2 + width / 2 + n, y: (-v.y * height) / 2 + height / 2 - n, z: v.z } };
    },
  };
}
type Viewer = ReturnType<typeof fakeViewer>;

/** The least of a DOM the real placer needs (as tests/hat-place.test.ts's): listeners run in the order added, a rect, capture, SVG nodes. */
class FakeNode {
  tagName: string;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  hasAttribute(k: string) {
    return k in this.attrs;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  appendChild(c: FakeNode) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c: FakeNode) {
    this.children = this.children.filter((n) => n !== c);
    c.parentNode = null;
    return c;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}
class FakeHost extends FakeNode {
  listeners: { type: string; fn: (e: object) => void }[] = [];
  captured = new Set<number>();
  tabIndex = -1;
  ownerDocument = {
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    activeElement: null,
    defaultView: { getComputedStyle: () => ({ position: "relative" }) },
  };
  width: number;
  height: number;
  constructor(width: number, height: number) {
    super("div");
    this.width = width;
    this.height = height;
  }
  get clientHeight() {
    return this.height;
  }
  addEventListener(type: string, fn: (e: object) => void) {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type: string, fn: (e: object) => void) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  focus() {}
  querySelector() {
    return null;
  }
  /** A touch at host px [x, y]. */
  touch(type: string, pointerId: number, [x, y]: number[]) {
    const e = { type, target: this, pointerId, pointerType: "touch", isPrimary: pointerId === 1, button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
  }
}

/** hat-look's view(spot), as createHatLook's setView does it. */
const lookFor = (mv: Viewer) => ({
  view(spot: string) {
    const v = viewFor(spot, VIEWS);
    mv.cameraTarget = v.target;
    mv.cameraOrbit = v.orbit;
    mv.fieldOfView = `${FIELD_OF_VIEW}deg`;
  },
});

const hostOf = (mv: Viewer) => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: mv.width, height: mv.height }) });

/** The largest screen error of P against a three.js camera, over a zone's probe points. */
function offBy(P: number[], cam: Cam, mv: Viewer, surface: ReturnType<typeof createSurface>, zone: string) {
  let worst = 0;
  for (const X of probePointsFor(surface, zone)) {
    const v = new THREE.Vector3(X[0], X[1], X[2]).project(cam);
    const [sx, sy] = project(P, X);
    worst = Math.max(worst, Math.hypot(sx - ((v.x * mv.width) / 2 + mv.width / 2), sy - ((-v.y * mv.height) / 2 + mv.height / 2)));
  }
  return worst;
}

describe("the projection", () => {
  it("is measured a frame after the camera changes, and again when a change lands while a measurement waits", () => {
    const f = frames();
    const mv = fakeViewer();
    const surface = createSurface(SURFACE_JSON);
    const got: number[][] = [];
    const projector = createProjector(mv, {
      surface,
      zone: () => "front",
      requestFrame: f.request,
      cancelFrame: f.cancel,
      onMeasure: (res) => res && got.push(res.P),
    });
    mv.addEventListener("camera-change", projector.request);

    // A change is measured in the next frame, once it has rendered.
    mv.cameraOrbit = "10deg 80deg 0.5m";
    mv.jumpCameraToGoal();
    expect(got).toHaveLength(0);
    const A = mv.camera();
    f.run(mv);
    expect(got).toHaveLength(1);
    expect(offBy(got[0], A, mv, surface, "front")).toBeLessThan(1e-4);

    // The lab's regression: something earlier in a frame (a spot's fit) jumps
    // the camera while a measurement waits behind it. That measurement reads
    // the frame before the jump; dropping the jump's own request left the
    // editor on that stale camera until the next change, which never came.
    f.request(() => {
      mv.cameraOrbit = "-25deg 70deg 0.4m";
      mv.jumpCameraToGoal();
    });
    projector.request();
    f.run(mv);
    expect(got).toHaveLength(2);
    expect(offBy(got[1], A, mv, surface, "front")).toBeLessThan(1e-4);
    const B = mv.camera();
    expect(offBy(got[1], B, mv, surface, "front")).toBeGreaterThan(5);
    f.run(mv);
    expect(got).toHaveLength(3);
    expect(offBy(got[2], B, mv, surface, "front")).toBeLessThan(1e-4);
    // At rest, nothing more.
    f.run(mv);
    expect(got).toHaveLength(3);
    expect(f.waiting).toBe(0);
  });
});

describe("a spot's view", () => {
  /** Fits a spot, lets the camera settle, and says how much of the editor its area fills (1: SPOT_FILL exactly). */
  function fitted(zone: string, size: { width: number; height: number }, maxRadius = Infinity) {
    const f = frames();
    const mv = fakeViewer({ ...size, maxRadius });
    const surface = createSurface(SURFACE_JSON);
    const onWindow = vi.fn();
    const onFitted = vi.fn();
    fitSpot({ mv, look: lookFor(mv), surface, zone, area: areaOf(zone), host: hostOf(mv), requestFrame: f.request, cancelFrame: f.cancel, onWindow, onFitted });
    // The jump, two frames to render and measure it, then a frame to fly there.
    for (let i = 0; i < 3; i++) f.run(mv);
    expect(onFitted).toHaveBeenCalledTimes(1);
    const res = measureProjection(mv, probePointsFor(surface, zone), { name: "probe" })!;
    surface.setCamera(res.P);
    const pts = areaFitPoints(areaOf(zone)).map((p) => surface.dieToScreen(zone, p![0], p![1])!);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const fill = size.width < 600 ? SPOT_FILL.narrow : SPOT_FILL.wide;
    const ratio = Math.max((Math.max(...xs) - Math.min(...xs)) / (fill.w * size.width), (Math.max(...ys) - Math.min(...ys)) / (fill.h * size.height));
    return { ratio, fit: onFitted.mock.calls[0][0], window: onWindow.mock.calls[0]?.[0], mv };
  }
  const PHONE = { width: 390, height: 640 };
  const LAPTOP = { width: 1200, height: 800 };

  it("fills about 80% x 60% of a phone's editor and 50% x 45% of a laptop's, in its tighter direction", () => {
    for (const zone of ["front", "left", "right", "back", "label_tall"]) {
      for (const size of [PHONE, LAPTOP]) {
        const { ratio } = fitted(zone, size);
        expect(ratio, `${zone} ${size.width}`).toBeGreaterThan(0.9);
        expect(ratio, `${zone} ${size.width}`).toBeLessThan(1.1);
      }
    }
  });

  it("scales the radius the camera really had, not the goal it was given", () => {
    // viewFor puts the front's goal about 1 m out; a viewer that holds the
    // camera to 0.7 m measures it there, and the fit must scale 0.7.
    const goal = parseFloat(viewFor("front", VIEWS).orbit.split(/\s+/)[2]);
    expect(goal).toBeGreaterThan(0.75);
    const { ratio, fit } = fitted("front", LAPTOP, 0.7);
    expect(fit.had).toBeCloseTo(0.7, 9);
    expect(fit.radius).toBeLessThan(0.7);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it("turns only within a window round the spot's view: 30 by 15 degrees, the label 20 by 10", () => {
    expect(spotOfZone("label_tall")).toBe("label");
    const { window, mv } = fitted("left", PHONE);
    const [theta, phi] = viewFor("left", VIEWS).orbit.split(/\s+/).map((s: string) => parseFloat(s));
    expect(window).toEqual(orbitWindow("left", theta, phi));
    expect(window.theta[1] - window.theta[0]).toBeCloseTo(2 * ORBIT_WINDOW.theta * RAD, 12);
    expect(window.phi[1] - window.phi[0]).toBeCloseTo(2 * ORBIT_WINDOW.phi * RAD, 12);
    const label = fitted("label_tall", PHONE).window;
    expect(label.theta[1] - label.theta[0]).toBeCloseTo(2 * LABEL_ORBIT_WINDOW.theta * RAD, 12);
    expect(label.phi[1] - label.phi[0]).toBeCloseTo(2 * LABEL_ORBIT_WINDOW.phi * RAD, 12);

    // A long drag on bare fabric (the placer's orbitFrom) stops at the window's edge, the radius kept.
    const camera = createCameraAdapter(mv, () => window);
    const radius = mv.getCameraOrbit().radius;
    camera.setOrbit(orbitFrom(camera.getOrbit(), -5000, 5000, PHONE.height, camera.window));
    mv.tick();
    const o = mv.getCameraOrbit();
    expect(o.theta).toBeCloseTo(window.theta[1], 9);
    expect(o.phi).toBeCloseTo(window.phi[0], 9);
    expect(o.radius).toBeCloseTo(radius, 9);
  });

  it("keeps the fit's radius when the hat is turned while the camera is still flying there", () => {
    const f = frames();
    // model-viewer eases a part of the way each frame: getCameraOrbit() is the camera mid-flight
    const mv = fakeViewer({ ...PHONE, ease: 0.3 });
    const surface = createSurface(SURFACE_JSON);
    let fit: { radius: number; had: number } | null = null;
    let win = orbitWindow("front", 0, 76);
    fitSpot({
      mv, look: lookFor(mv), surface, zone: "front", area: areaOf("front"), host: hostOf(mv),
      requestFrame: f.request, cancelFrame: f.cancel,
      onWindow: (w) => (win = w),
      onFitted: (r) => (fit = r),
    });
    // the jump and two frames: fitted, the flight begins; two frames into it, a drag on the fabric
    for (let i = 0; i < 4; i++) f.run(mv);
    expect(fit).not.toBeNull();
    const { radius } = fit!;
    expect(goalRadius(mv)).toBeCloseTo(radius, 9);
    expect(Math.abs(mv.getCameraOrbit().radius - radius)).toBeGreaterThan(0.05);
    const camera = createCameraAdapter(mv, () => win);
    const o = camera.getOrbit();
    camera.setOrbit({ theta: o.theta + 0.05, phi: o.phi });
    for (let i = 0; i < 80; i++) f.run(mv);
    expect(mv.getCameraOrbit().radius).toBeCloseTo(radius, 6);
  });
});

describe("an edit session", () => {
  /** A session on the front with a fake placer (or the real one, on a fake host) and a look that records the live repaint. */
  function session(mvOptions = {}, { real = false, piece = { cx: 875, cy: 700, w: 300, h: 150 } } = {}) {
    const f = frames();
    const mv = fakeViewer(mvOptions);
    const host = real ? new FakeHost(mv.width, mv.height) : hostOf(mv);
    const surface = createSurface(SURFACE_JSON);
    const calls: unknown[][] = [];
    const sprite = { w: 340, h: 190, pad: 20 };
    const look = {
      ...lookFor(mv),
      buildSprite: (...a: unknown[]) => (calls.push(["buildSprite", ...a]), sprite),
      beginLive: (...a: unknown[]) => (calls.push(["beginLive", ...a]), true),
      liveFrame: (zone: string, s: unknown, m: number[]) => (calls.push(["liveFrame", zone, s, [...m]]), true),
      endLive: (zone: string, o: { m?: number[] }) => (calls.push(["endLive", zone, { ...o, m: o.m && [...o.m] }]), undefined),
    };
    const placers: { opts: Record<string, (...a: unknown[]) => void>; update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    const makePlacer = (_host: unknown, opts: Record<string, (...a: unknown[]) => void>) => {
      const p = { opts, update: vi.fn(), cancel: vi.fn(() => false), destroy: vi.fn() };
      placers.push(p);
      return p;
    };
    const art = { width: 300, height: 150 };
    const rests: { width: number; height: number }[] = [];
    const edit = {
      zone: "front",
      area: areaOf("front"),
      cap: { w: zoneOf("front").maxImprint.w * DIE.pxPerInch, h: zoneOf("front").maxImprint.h * DIE.pxPerInch },
      pxPerInch: DIE.pxPerInch,
      pieces: [{ id: "a", ...piece, rotation: 0, label: "Logo" }],
      selectedId: "a",
      pieceArt: vi.fn(() => art),
      restArt: vi.fn(() => {
        const c = { width: 1644, height: 1288 };
        rests.push(c);
        return c;
      }),
      onSelect: vi.fn(),
      onCommit: vi.fn((..._a: unknown[]) => calls.push(["host onCommit", ..._a])),
      onCancel: vi.fn(),
      onNote: vi.fn(),
      onDelete: vi.fn(),
      labels: { spot: "front" },
      reducedMotion: false,
    };
    const onFailed = vi.fn();
    const s = createEditSession({
      mv, host, look, surface, edit, requestFrame: f.request, cancelFrame: f.cancel,
      makePlacer: (real ? createPlacer : makePlacer) as never, onFailed,
    });
    return { f, mv, host, surface, s, calls, sprite, art, rests, edit, placer: placers[0], placers, onFailed };
  }
  const pose = (cx: number, cy: number, w = 300, rotation = 0) => ({ cx, cy, w, h: w / 2, rotation });
  const matrix = (sprite: { w: number; h: number }, p: ReturnType<typeof pose>) => [...pieceMatrix(sprite, { x: p.cx, y: p.cy, angle: p.rotation * RAD, scale: p.w / 300 })];

  it("paints a gesture live as the lab does, and commits it once, after the held frame", () => {
    const t = session();
    const { opts } = t.placer;
    const moves = [pose(880, 702), pose(900, 720, 330, 5), pose(920, 740, 360, 10)];
    for (const p of moves) opts.onLive("a", p, { pushed: false, kind: "move" });
    opts.onCommit("a", moves[2]);
    expect(t.edit.onCommit).toHaveBeenCalledTimes(1);
    expect(t.edit.onCommit).toHaveBeenCalledWith("a", moves[2]);
    expect(t.calls).toEqual([
      // the piece's look once, at the size the gesture starts at (sprite px are die px)
      ["buildSprite", "front", t.art, { scale: 1 }],
      // the rest of the spot once
      ["beginLive", "front", { rest: t.rests[0] }],
      ...moves.map((p) => ["liveFrame", "front", t.sprite, matrix(t.sprite, p)]),
      // the pose it came to rest at, held for the host's new art, then the host told
      ["endLive", "front", { sprite: t.sprite, m: matrix(t.sprite, moves[2]) }],
      ["host onCommit", "a", moves[2]],
    ]);
    expect(t.rests[0].width).toBe(0);

    // Escape mid-gesture: the committed art at once, the host's onCancel, no commit.
    t.calls.length = 0;
    opts.onLive("a", pose(700, 650), { pushed: false, kind: "move" });
    opts.onCancel("a");
    expect(t.calls.at(-1)).toEqual(["endLive", "front", { now: true, m: undefined }]);
    expect(t.edit.onCancel).toHaveBeenCalledWith("a");
    expect(t.edit.onCommit).toHaveBeenCalledTimes(1);
    expect(t.placer.update).toHaveBeenLastCalledWith({ pieces: t.edit.pieces, selectedId: "a" });

    // A key step commits on its own, with nothing live to end.
    t.calls.length = 0;
    opts.onCommit("a", pose(930, 740));
    expect(t.calls).toEqual([["host onCommit", "a", pose(930, 740)]]);
    expect(t.edit.onCommit).toHaveBeenCalledTimes(2);
  });

  it("measures and fits on its own, passes on only what changed, and refits on a new spot", () => {
    const t = session();
    for (let i = 0; i < 4; i++) t.f.run(t.mv);
    // the fit's measurement and the camera's own after it: the placer re-projects
    expect(t.placer.update).toHaveBeenCalledWith({ cameraMoved: true });
    expect(t.s.residual).toBeLessThan(1e-3);
    t.placer.update.mockClear();
    t.s.update({ ...t.edit });
    expect(t.placer.update).not.toHaveBeenCalled();
    const moved = [{ ...t.edit.pieces[0], cx: 900 }];
    t.s.update({ ...t.edit, pieces: moved, selectedId: null });
    expect(t.placer.update).toHaveBeenCalledWith({ pieces: moved, selectedId: null });
    t.placer.update.mockClear();
    const left = { ...t.edit, zone: "left", area: areaOf("left"), pieces: [], labels: { spot: "left side" } };
    t.s.update(left);
    expect(t.placer.update).toHaveBeenCalledWith(expect.objectContaining({ zone: "left", area: left.area, pieces: [], labels: { spot: "left side" } }));
    const [theta] = viewFor("left", VIEWS).orbit.split(/\s+/).map((s: string) => parseFloat(s));
    expect(parseFloat(t.mv.cameraOrbit)).toBeCloseTo(theta, 6);
    t.s.destroy();
    expect(t.placer.destroy).toHaveBeenCalledTimes(1);
  });

  it("gives up, once, when the camera can't be measured to half a pixel", () => {
    const t = session({ noise: 3 });
    for (let i = 0; i < 4; i++) t.f.run(t.mv);
    for (let i = 0; i < 4; i++) {
      t.mv.cameraOrbit = `${10 + i}deg 76deg 0.5m`;
      t.f.run(t.mv);
      t.f.run(t.mv);
    }
    expect(t.onFailed).toHaveBeenCalledTimes(1);
    expect(t.placer.update).not.toHaveBeenCalledWith({ cameraMoved: true });
  });

  /** Two fingers down on the selected piece, held a few frames, lifted where they landed: the real placer commits nothing. */
  function twoFingerTap(t: ReturnType<typeof session>) {
    for (let i = 0; i < 4; i++) t.f.run(t.mv);
    expect(t.s.residual).toBeLessThan(1e-3);
    const p = t.edit.pieces[0];
    const at = t.surface.dieToScreen("front", p.cx, p.cy)!;
    const beside = [at[0] + 40, at[1] + 10];
    const host = t.host as FakeHost;
    host.touch("pointerdown", 1, at);
    host.touch("pointerdown", 2, beside);
    for (let i = 0; i < 3; i++) t.f.run(t.mv);
    host.touch("pointerup", 2, beside);
    host.touch("pointerup", 1, at);
    t.f.run(t.mv);
    expect(t.edit.onCommit).not.toHaveBeenCalled();
    expect(t.edit.onCancel).not.toHaveBeenCalled();
  }

  it("leaves nothing held live after a two-finger tap, which the placer ends with no commit and no cancel", () => {
    // The piece where it is: its pose is the committed one, so nothing starts.
    expect(samePose({ cx: 1, cy: 2, w: 3, h: 4, rotation: 180 }, { cx: 1.2, cy: 2, w: 3, h: 4, rotation: -180 })).toBe(true);
    expect(samePose({ cx: 1, cy: 2, w: 3, h: 4, rotation: 0 }, { cx: 1, cy: 2, w: 3, h: 4, rotation: 0.5 })).toBe(false);
    const t = session({}, { real: true });
    twoFingerTap(t);
    expect(t.calls.map((c) => c[0])).not.toContain("beginLive");

    // A piece the confine rule moves (larger than the front's cap) shows its
    // confined pose live; the fingers lift unchanged, and the committed art
    // comes back at once rather than the spot staying live.
    const big = session({}, { real: true, piece: { cx: 875, cy: 700, w: 1000, h: 500 } });
    twoFingerTap(big);
    const names = big.calls.map((c) => c[0]);
    expect(names).toContain("beginLive");
    expect(big.calls.at(-1)).toEqual(["endLive", "front", { now: true, m: undefined }]);
  });

  it("ends the live repaint of a piece taken away mid-gesture", () => {
    const t = session();
    t.placer.opts.onLive("a", pose(880, 702), { pushed: false, kind: "move" });
    expect(t.calls.map((c) => c[0])).toEqual(["buildSprite", "beginLive", "liveFrame"]);
    t.s.update({ ...t.edit, pieces: [], selectedId: null });
    expect(t.calls.at(-1)).toEqual(["endLive", "front", { now: true, m: undefined }]);
    expect(t.rests[0].width).toBe(0);
  });
});
