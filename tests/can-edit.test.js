// Editing on the 3D can cooler (v1.16.0): src/viewer/can-edit.js, and what
// hat-edit.js does with a look that brings its own fill and orbit window.
//
// Checked in node: a koozie die as the hat helpers take it (pieceOf, piecesOf,
// commitPatch, createPieceArtCache, adjustAction, unchanged); each side's
// limits; the rest art's export; the look's texture, committed paint and
// live repaint on a stand-in <model-viewer> and a recording 2D context (the
// order of a frame's draws, the flip, the hold until the next paint, the
// HOLD_MAX_MS release, a cancel); the views; and fitSpot and an edit session
// on a fake model-viewer that orbits a real three.js camera round the can's
// own surface, at its 13 degree field of view: an "auto" radius fitted
// rather than given up on, each side filling CAN_EDIT_FILL, the camera never
// clamped by CAN_COOLER_VIEW's radius floor, and the window the can's own.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  CAN_BASE_SIDES,
  CAN_EDIT_FILL,
  CAN_EDIT_VIEWS,
  CAN_EDIT_ZONES,
  CAN_ORBIT_WINDOW,
  CAN_SPOT_LEVELS,
  CAN_SPOT_NAMES,
  canEditDie,
  canOrbitWindow,
  canRestArt,
  canSpotLimits,
  createCanLook,
} from "../src/viewer/can-edit.js";
import * as viewer from "../src/viewer/index.js";
import { CAN_COOLER_MIN_RADIUS, CAN_COOLER_VIEW, paintCanCooler } from "../src/viewer/can-cooler.js";
import { HOLD_MAX_MS, pieceMatrix } from "../src/viewer/hat-look.js";
import { createSurface, measureProjection, probePointsFor } from "../src/viewer/hat-surface.js";
import { SPOT_FILL, areaFitPoints, areaScreenPoints, createEditSession, fitSpot, orbitWindow } from "../src/viewer/hat-edit.js";
import { adjustAction, commitPatch, createPieceArtCache, pieceOf, piecesOf } from "../src/viewer/hat-edit-host.js";
import { dieGeometry, faceAt, faceRegions, resolveDie } from "../src/core/index.js";
import { HAT_NO_6_DIE, HAT_NO_7_DIE } from "../src/core/hat-config.js";
import { zoneArea } from "../src/core/hat-placements.js";
import { areaHome, confinePose, pointInArea } from "../src/core/region.js";

const RAD = Math.PI / 180;
const FOV = parseFloat(CAN_COOLER_VIEW["field-of-view"]);
const SURFACES = {
  "koozie-standard": JSON.parse(readFileSync(new URL("../models/can-cooler-standard-surface.json", import.meta.url), "utf8")),
  "koozie-slim": JSON.parse(readFileSync(new URL("../models/can-cooler-slim-surface.json", import.meta.url), "utf8")),
};

afterEach(() => {
  vi.useRealTimers();
});

// ---- The die ---------------------------------------------------------------------------

describe("canEditDie", () => {
  it("is a koozie die as the hat helpers take one: its stage, its px/in, and three sides with an area", () => {
    for (const id of ["koozie-standard", "koozie-slim"]) {
      const die = canEditDie(id);
      const geom = dieGeometry(id);
      const regions = faceRegions(geom);
      expect(die.id).toBe(id);
      expect(die.kind).toBe("koozie");
      expect(die.stage).toEqual(resolveDie(id).stage);
      expect(die.pxPerInch).toBe(geom.pxPerInch);
      expect(die.zones.map((z) => z.id)).toEqual(CAN_EDIT_ZONES);
      for (const z of die.zones) expect(Object.keys(z)).toEqual(["id", "rect", "area", "maxImprint"]);
      const [front, back, base] = die.zones;
      expect(front.rect).toEqual({ x: geom.x0, y: geom.y0, w: geom.x1 - geom.x0, h: geom.y1 - geom.y0 });
      expect(front.area).toBe(front.rect);
      expect(back.rect).toEqual({ x: geom.x0, y: geom.y2, w: geom.x1 - geom.x0, h: geom.y3 - geom.y2 });
      expect(regions.front).toMatchObject({ x0: front.rect.x, y0: front.rect.y });
      // the base: its disc, as a polygon on the circle, within 0.15 px of it everywhere
      const { cx, cy, r } = regions.base;
      expect(base.rect).toEqual({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });
      expect(base.area.outline).toHaveLength(CAN_BASE_SIDES);
      expect(base.area.holes).toEqual([]);
      for (const [x, y] of base.area.outline) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 9);
      expect(r * (1 - Math.cos(Math.PI / CAN_BASE_SIDES))).toBeLessThan(0.15);
      const home = areaHome(base.area);
      expect(home[0]).toBeCloseTo(cx, 6);
      expect(home[1]).toBeCloseTo(cy, 0);
      // the bounding box in inches, to the die's own 1e-4
      expect(front.maxImprint).toEqual({ w: resolveDie(id).measurements.panelW, h: resolveDie(id).measurements.panelH });
      expect(base.maxImprint).toEqual({ w: resolveDie(id).measurements.discD, h: resolveDie(id).measurements.discD });
    }
  });

  it("is frozen, the same object every time for a die by any name, and throws for a hat", () => {
    const die = canEditDie("koozie-standard");
    expect(canEditDie("standard")).toBe(die);
    expect(canEditDie(resolveDie("koozie-standard"))).toBe(die);
    expect(canEditDie(die)).toBe(die);
    expect(Object.isFrozen(die)).toBe(true);
    expect(Object.isFrozen(die.zones[2].area.outline[0])).toBe(true);
    expect(() => canEditDie("hat-no-6")).toThrow(/kind "koozie"/);
  });

  it("works unchanged as the die of pieceOf, piecesOf, commitPatch and createPieceArtCache", () => {
    const die = canEditDie("koozie-slim");
    const { width: W, height: H } = die.stage;
    const geom = dieGeometry("koozie-slim");
    const zoneOf = (el) => faceAt(geom, die.stage, el);
    const logo = { id: "a", type: "logo", x: 0.5, y: 0.2, scale: 0.4, naturalWidth: 400, naturalHeight: 200, rotation: 0, fileName: "a.png" };
    const back = { id: "b", type: "logo", x: 0.5, y: 0.8, scale: 0.3, naturalWidth: 100, naturalHeight: 100, rotation: 180 };
    const disc = { id: "c", type: "logo", x: 0.5, y: 0.5, scale: 0.2, naturalWidth: 100, naturalHeight: 100, rotation: 0 };
    const piece = pieceOf(logo, die);
    expect(piece).toEqual({ id: "a", cx: 0.5 * W, cy: 0.2 * H, w: 0.4 * W, h: 0.2 * W, rotation: 0, label: "a.png" });
    expect(piecesOf([logo, back, disc], "front", die, { zoneOf }).map((p) => p.id)).toEqual(["a"]);
    expect(piecesOf([logo, back, disc], "back", die, { zoneOf }).map((p) => p.id)).toEqual(["b"]);
    expect(piecesOf([logo, back, disc], "base", die, { zoneOf }).map((p) => p.id)).toEqual(["c"]);
    // a pose the placer let go at, as the document's fractions, and back
    const pose = { cx: piece.cx + 35, cy: piece.cy - 20, w: piece.w * 1.1, h: piece.h * 1.1, rotation: 7 };
    const patch = commitPatch(logo, pose, piece, die);
    expect(patch).toEqual({ x: pose.cx / W, y: pose.cy / H, rotation: 7, scale: pose.w / W });
    const moved = pieceOf({ ...logo, ...patch }, die);
    expect(moved.cx).toBeCloseTo(pose.cx, 9);
    expect(moved.cy).toBeCloseTo(pose.cy, 9);
    expect(moved.w).toBeCloseTo(pose.w, 9);
    expect(moved.h).toBeCloseTo(pose.h, 9);
    expect(commitPatch(logo, piece, piece, die)).toBeNull();
    // a piece's art: the stage's art layer with that element alone, on its box
    const canvas = { width: 10, height: 5 };
    const stage = { exportArtCanvas: vi.fn(() => canvas) };
    const cache = createPieceArtCache();
    expect(cache.get(stage, logo, piece, {})).toBe(canvas);
    expect(stage.exportArtCanvas).toHaveBeenCalledWith({ color: false, only: "a", rect: { x: piece.cx - piece.w / 2, y: piece.cy - piece.h / 2, w: piece.w, h: piece.h } });
    expect(cache.get(stage, { ...logo, x: 0.4 }, { ...piece, cx: 0.4 * W }, {})).toBe(canvas);
    expect(stage.exportArtCanvas).toHaveBeenCalledTimes(1);
  });
});

describe("canSpotLimits", () => {
  it("is each side as the placer takes it: its area, a cap that is the side itself, its level and name", () => {
    const die = canEditDie("koozie-standard");
    for (const z of die.zones) {
      const l = canSpotLimits(die, z.id);
      expect(Object.keys(l).sort()).toEqual(["area", "cap", "labels", "level", "maxImprint", "pxPerInch", "zone", ...(z.id === "base" ? ["snapX"] : [])].sort());
      expect(l.zone).toBe(z.id);
      expect(l.area).toBe(z.area);
      expect(l.cap).toEqual({ w: z.rect.w, h: z.rect.h });
      expect(l.maxImprint).toBe(z.maxImprint);
      expect(l.pxPerInch).toBe(die.pxPerInch);
      expect(l.level).toBe(CAN_SPOT_LEVELS[z.id]);
      expect(l.labels).toEqual({ spot: CAN_SPOT_NAMES[z.id] });
      expect(canSpotLimits(die, z.id)).toBe(l);
      expect(canSpotLimits("koozie-standard", z.id)).toBe(l);
    }
    expect(canSpotLimits(die, "back").level).toBe(180);
    expect(canSpotLimits(die, "front").labels.spot).toBe("front panel");
    expect(canSpotLimits(die, "base").snapX).toBeCloseTo(dieGeometry("koozie-standard").cx, 6);
    expect(canSpotLimits(die, "left")).toBeNull();
    expect(canSpotLimits("hat-no-7-v2", "front")).toBeNull();
    expect(canSpotLimits(null, "front")).toBeNull();
  });

  it("keeps a piece inside the base's disc, and says so as the hat's spots do", () => {
    const die = canEditDie("koozie-standard");
    const l = canSpotLimits(die, "base");
    const { cx, cy, r } = faceRegions(dieGeometry("koozie-standard")).base;
    const fit = confinePose({ cx: cx + r, cy, w: 120, h: 120, rotation: 0 }, { area: l.area, cap: l.cap });
    expect(fit.moved).toBe(true);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = fit.cx + (sx * 120) / 2, y = fit.cy + (sy * 120) / 2;
      expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(r + 1e-6);
      expect(pointInArea(l.area, x, y)).toBe(true);
    }
    const element = { id: "c", type: "logo", x: (cx + r - 70) / die.stage.width, y: cy / die.stage.height, scale: 120 / die.stage.width, naturalWidth: 1, naturalHeight: 1, rotation: 0 };
    const { note } = adjustAction("right", { element, piece: pieceOf(element, die), limits: l, die });
    expect(note).toBe("The base's logo area ends here.");
    const front = canSpotLimits(die, "front");
    const huge = { id: "a", type: "logo", x: 0.5, y: 0.2, scale: 0.79, naturalWidth: 1, naturalHeight: 1, rotation: 0 };
    expect(adjustAction("larger", { element: huge, piece: pieceOf(huge, die), limits: front, die }).note).toBe(
      "That's the largest the front panel takes: 4.2222 × 4.0278 in.",
    );
  });
});

describe("canRestArt", () => {
  it("is the whole die's art without the piece and without the ground, at the scale asked", () => {
    const canvas = { width: 600, height: 1200 };
    const stage = { exportArtCanvas: vi.fn(() => canvas) };
    expect(canRestArt(stage, "a")).toBe(canvas);
    expect(stage.exportArtCanvas).toHaveBeenLastCalledWith({ color: false, exclude: ["a"] });
    expect(canRestArt(stage, "a", { scale: 0.6 })).toBe(canvas);
    expect(stage.exportArtCanvas).toHaveBeenLastCalledWith({ color: false, exclude: ["a"], scale: 0.6 });
    expect(canRestArt(null, "a")).toBeNull();
    expect(canRestArt({ exportArtCanvas: () => null }, "a")).toBeNull();
  });
});

// ---- The look --------------------------------------------------------------------------

/** A 2D context that records every call ([name, ...args]) and set ([`${name}=`, value]). */
function recorder() {
  const ops = [];
  const g = new Proxy({}, {
    get: (_t, k) => (...args) => void ops.push([k, ...args]),
    set: (_t, k, v) => (ops.push([`${String(k)}=`, v]), true),
  });
  return { ops, g };
}

/** A <model-viewer> with the can's materials, a canvas texture on a recording context, and its load event. */
function standIn({ loaded = false } = {}) {
  const events = new EventTarget();
  const { ops, g } = recorder();
  const textures = [];
  const bound = [];
  const material = (name) => ({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [0.2, 0.2, 0.2, 1],
      setBaseColorFactor: vi.fn(),
      baseColorTexture: { setTexture: (t) => bound.push([name, t]) },
    },
    setAlphaMode: vi.fn(),
  });
  const mv = {
    loaded,
    model: loaded ? { materials: ["print", "foam", "print_seam", "thread", "magnet"].map(material) } : null,
    cameraOrbit: "0deg 80deg auto",
    cameraTarget: "auto auto auto",
    jumpCameraToGoal: vi.fn(),
    getCameraOrbit: () => ({ theta: 0, phi: 80 * RAD, radius: 0.61 }),
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
    createCanvasTexture() {
      const t = { source: { element: { width: 0, height: 0, getContext: () => g }, update: vi.fn() } };
      textures.push(t);
      return t;
    },
    load() {
      this.loaded = true;
      this.model = { materials: ["print", "foam", "print_seam", "thread", "magnet"].map(material) };
      events.dispatchEvent(new Event("load"));
    },
  };
  return { mv, ops, textures, bound };
}

const STANDARD = resolveDie("koozie-standard").stage;
const art = (width = 1000, height = 2000) => ({ width, height });

describe("createCanLook", () => {
  it("binds a texture of the die's size times textureScale to print and print_seam on every load, and says so", () => {
    const { mv, textures, bound } = standIn();
    const onReady = vi.fn();
    const look = createCanLook(mv, { stage: STANDARD, textureScale: 0.6, onReady });
    expect(look.texture).toBeNull();
    expect(look.paint({ color: "#112233", art: art() })).toBe(false);
    mv.load();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(look.texture).toBe(textures[0]);
    expect(textures[0].source.element).toMatchObject({ width: 600, height: 1200 });
    expect(bound.map(([name, t]) => [name, t === textures[0]])).toEqual([["print", true], ["print_seam", true]]);
    mv.load();
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(look.texture).toBe(textures[1]);
    // a model already loaded is bound at once
    const ready = standIn({ loaded: true });
    const onReady2 = vi.fn();
    const look2 = createCanLook(ready.mv, { stage: STANDARD, onReady: onReady2 });
    expect(onReady2).toHaveBeenCalledTimes(1);
    expect(look2.texture.source.element).toMatchObject({ width: 1000, height: 2000 });
    look2.dispose();
    ready.mv.load();
    expect(onReady2).toHaveBeenCalledTimes(1);
  });

  it("paints exactly paintCanCooler's pixels, and nothing without art", () => {
    const a = standIn({ loaded: true });
    const look = createCanLook(a.mv, { stage: STANDARD });
    const design = { color: "#1C2E4A", art: art(500, 1000), magnet: true };
    a.ops.length = 0;
    expect(look.paint(design)).toBe(true);
    const b = standIn({ loaded: true });
    const texture = createCanLook(b.mv, { stage: STANDARD }).texture;
    b.ops.length = 0;
    paintCanCooler(b.mv, texture, design);
    expect(a.ops).toEqual(b.ops);
    expect(a.ops).toContainEqual(["drawImage", design.art, 0, 0, 1000, 2000]);
    expect(look.texture.source.update).toHaveBeenCalledTimes(1);
    expect(look.paint({ color: "#000000", art: null })).toBe(false);
  });

  it("puts the camera on each side at a numeric orbit: the approved view's own radius, never auto", () => {
    const { mv } = standIn({ loaded: true });
    const look = createCanLook(mv, { stage: STANDARD });
    const sleeve = resolveDie("koozie-standard").measurements.panelH * 0.0254;
    look.view("front");
    expect(mv.cameraOrbit).toBe("0deg 80deg 0.61m");
    expect(mv.cameraTarget).toBe(`0m ${+(sleeve / 2).toFixed(6)}m 0m`);
    look.view("back");
    expect(mv.cameraOrbit).toBe("180deg 80deg 0.61m");
    look.view("base");
    expect(mv.cameraOrbit).toBe("0deg 150deg 0.61m");
    expect(mv.cameraTarget).toBe("0m 0m 0m");
    // the goal is numeric now; the radius learned on the auto goal is kept
    look.view("whole");
    expect(mv.cameraOrbit).toBe("0deg 80deg 0.61m");
    expect(mv.cameraTarget).toBe("auto auto auto");
    look.view("nowhere");
    expect(mv.cameraOrbit).toBe("0deg 80deg 0.61m");
    expect(mv.jumpCameraToGoal).not.toHaveBeenCalled();
    // never on an auto goal: a radius that frames the whole can
    const fresh = standIn({ loaded: true });
    fresh.mv.cameraOrbit = "0deg 80deg 0.3m";
    createCanLook(fresh.mv, { stage: STANDARD }).view("front");
    const r = parseFloat(fresh.mv.cameraOrbit.split(" ")[2]);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(0.7);
    // a jump under reduced motion
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      look.view("front");
      expect(mv.jumpCameraToGoal).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("brings its own fill and orbit window: wider than a hat's, the base kept within the viewer's limits", () => {
    const { mv } = standIn();
    const look = createCanLook(mv, { stage: STANDARD });
    expect(look.fill).toBe(CAN_EDIT_FILL);
    expect(look.orbitWindow).toBe(canOrbitWindow);
    expect(CAN_EDIT_FILL.wide.h).toBeGreaterThan(SPOT_FILL.wide.h);
    expect(CAN_EDIT_FILL.narrow.w).toBeGreaterThan(SPOT_FILL.narrow.w);
    const front = canOrbitWindow("front", 0, 80);
    expect(front.theta.map((t) => t / RAD)).toEqual([-45, 45].map((d) => expect.closeTo(d, 9)));
    expect(front.phi.map((t) => t / RAD)).toEqual([60, 100].map((d) => expect.closeTo(d, 9)));
    const base = canOrbitWindow("base", 0, 150);
    expect(base.theta.map((t) => t / RAD)).toEqual([-60, 60].map((d) => expect.closeTo(d, 9)));
    expect(base.phi.map((t) => t / RAD)).toEqual([130, 150].map((d) => expect.closeTo(d, 9)));
    expect(CAN_ORBIT_WINDOW.panel.theta).toBeGreaterThan(30);
    expect(canOrbitWindow("back", 180, 40).phi[0] / RAD).toBeCloseTo(35, 9);
  });

  it("builds a piece's sprite as its art itself, die px at the scale given", () => {
    const { mv } = standIn({ loaded: true });
    const look = createCanLook(mv, { stage: STANDARD });
    const a = art(300, 150);
    expect(look.buildSprite("front", a, { scale: 0.5 })).toEqual({ color: a, w: 150, h: 75, pad: 0 });
    expect(look.buildSprite("base", a)).toEqual({ color: a, w: 300, h: 150, pad: 0 });
    expect(look.buildSprite("left", a)).toBeNull();
    expect(look.buildSprite("front", art(0, 10))).toBeNull();
    expect(look.buildSprite("front", null)).toBeNull();
  });

  /** A loaded look with a committed paint, its ops cleared. */
  function painted() {
    const t = standIn({ loaded: true });
    const look = createCanLook(t.mv, { stage: STANDARD, textureScale: 0.5 });
    const design = { color: "#1C2E4A", art: art() };
    look.paint(design);
    t.ops.length = 0;
    look.texture.source.update.mockClear();
    return { ...t, look, design };
  }
  const SPRITE = { color: art(300, 150), w: 300, h: 150, pad: 0 };
  const M = (x, y, deg = 0) => [...pieceMatrix(SPRITE, { x, y, angle: deg * RAD })];
  const names = (ops) => ops.map(([k]) => k);

  it("paints a live frame: the colour, the rest, then the sprite clipped to the side, all upside down", () => {
    const t = painted();
    const rest = art(500, 1000);
    expect(t.look.liveFrame("front", SPRITE, M(500, 400))).toBe(false); // nothing begun
    expect(t.look.beginLive("front", { rest })).toBe(true);
    expect(t.ops).toEqual([]);
    expect(t.look.liveFrame("back", SPRITE, M(500, 400))).toBe(false); // another side's
    expect(t.look.liveFrame("front", SPRITE, M(500, 400, 10))).toBe(true);
    const geom = dieGeometry("koozie-standard");
    expect(t.ops).toEqual([
      ["save"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["fillStyle=", "#1C2E4A"],
      ["fillRect", 0, 0, 500, 1000],
      // die px to the texture, upside down
      ["setTransform", 0.5, 0, 0, -0.5, 0, 1000],
      ["drawImage", rest, 0, 0, 1000, 2000],
      ["beginPath"],
      ["rect", geom.x0, geom.y0, geom.x1 - geom.x0, geom.y1 - geom.y0],
      ["clip"],
      ["transform", ...M(500, 400, 10)],
      ["imageSmoothingEnabled=", true],
      ["imageSmoothingQuality=", "low"],
      ["drawImage", SPRITE.color, 0, 0, 300, 150],
      ["restore"],
    ]);
    expect(t.look.texture.source.update).toHaveBeenCalledTimes(1);
    // the base clips to its disc
    t.look.endLive("front", { now: true });
    t.look.beginLive("base", { rest: null });
    t.ops.length = 0;
    t.look.liveFrame("base", SPRITE, M(500, 1000));
    const { cx, cy, r } = faceRegions(geom).base;
    expect(names(t.ops)).toEqual(["save", "setTransform", "fillStyle=", "fillRect", "setTransform", "beginPath", "moveTo", "arc", "closePath", "clip", "transform", "imageSmoothingEnabled=", "imageSmoothingQuality=", "drawImage", "restore"]);
    expect(t.ops[7]).toEqual(["arc", cx, cy, r, 0, 2 * Math.PI, false]);
    // before the first paint, or on a side that is not the can's, nothing begins
    const fresh = standIn({ loaded: true });
    const unpainted = createCanLook(fresh.mv, { stage: STANDARD });
    expect(unpainted.beginLive("front", { rest })).toBe(false);
    expect(t.look.beginLive("left", { rest })).toBe(false);
  });

  it("holds a drag's resting frame until the next paint, which is the handover", () => {
    vi.useFakeTimers();
    const t = painted();
    t.look.beginLive("front", { rest: art() });
    t.look.liveFrame("front", SPRITE, M(500, 400));
    t.ops.length = 0;
    t.look.endLive("front", { sprite: SPRITE, m: M(520, 410) });
    // the pose it came to rest at, drawn once, then held
    expect(names(t.ops).filter((k) => k === "drawImage")).toHaveLength(2);
    expect(t.ops).toContainEqual(["transform", ...M(520, 410)]);
    t.ops.length = 0;
    vi.advanceTimersByTime(HOLD_MAX_MS - 1);
    expect(t.ops).toEqual([]);
    // the host's new art: painted at once, and the hold is over
    const next = { color: "#1C2E4A", art: art(1000, 2000) };
    expect(t.look.paint(next)).toBe(true);
    expect(t.ops).toContainEqual(["drawImage", next.art, 0, 0, 500, 1000]);
    t.ops.length = 0;
    vi.advanceTimersByTime(HOLD_MAX_MS * 2);
    expect(t.ops).toEqual([]);
  });

  it("ends a hold no paint releases after HOLD_MAX_MS, showing the committed paint", () => {
    vi.useFakeTimers();
    const t = painted();
    t.look.beginLive("back", { rest: null });
    t.look.endLive("back", { sprite: SPRITE, m: M(500, 1500, 180) });
    t.ops.length = 0;
    vi.advanceTimersByTime(HOLD_MAX_MS);
    expect(t.ops).toContainEqual(["drawImage", t.design.art, 0, 0, 500, 1000]);
    expect(t.ops).toContainEqual(["fillStyle=", t.design.color]);
  });

  it("shows the committed paint at once when cancelled, or when the drag changed nothing", () => {
    vi.useFakeTimers();
    const t = painted();
    t.look.beginLive("front", { rest: null });
    t.look.liveFrame("front", SPRITE, M(500, 400));
    t.ops.length = 0;
    t.look.endLive("front", { now: true });
    expect(t.ops).toContainEqual(["drawImage", t.design.art, 0, 0, 500, 1000]);
    // changed: false, with no hold waiting: the committed paint is the result
    t.look.beginLive("front", { rest: null });
    t.look.liveFrame("front", SPRITE, M(500, 400));
    t.ops.length = 0;
    t.look.endLive("front", { changed: false });
    expect(t.ops).toContainEqual(["drawImage", t.design.art, 0, 0, 500, 1000]);
    // changed: false while an earlier drag's result is still to come: that hold stays
    t.look.beginLive("front", { rest: null });
    t.look.endLive("front", { sprite: SPRITE, m: M(530, 400) });
    t.look.beginLive("front", { rest: null });
    t.look.liveFrame("front", SPRITE, M(530, 400));
    t.ops.length = 0;
    t.look.endLive("front", { changed: false });
    expect(t.ops).toEqual([]);
    // a press that never drew leaves the can as it was
    t.look.paint(t.design);
    t.look.beginLive("front", { rest: null });
    t.ops.length = 0;
    t.look.endLive("front", { now: true });
    expect(t.ops).toEqual([]);
  });

  it("keeps a paint that comes mid-drag for the drag's end, and draws the drag in its colour", () => {
    const t = painted();
    t.look.beginLive("front", { rest: null });
    t.look.liveFrame("front", SPRITE, M(500, 400));
    t.ops.length = 0;
    const recoloured = { color: "#FF0000", art: art() };
    expect(t.look.paint(recoloured)).toBe(true);
    expect(t.ops).toEqual([]);
    t.look.liveFrame("front", SPRITE, M(505, 400));
    expect(t.ops).toContainEqual(["fillStyle=", "#FF0000"]);
    t.ops.length = 0;
    t.look.endLive("front", { now: true });
    expect(t.ops).toContainEqual(["drawImage", recoloured.art, 0, 0, 500, 1000]);
  });

  it("costs a frame a fixed handful of canvas calls on numbers", () => {
    const t = painted();
    const rest = art(500, 1000);
    t.look.beginLive("front", { rest });
    const m = M(500, 400);
    t.look.liveFrame("front", SPRITE, m);
    const perFrame = t.ops.length;
    expect(perFrame).toBe(14);
    for (const op of t.ops) for (const a of op.slice(1)) expect(["number", "string", "boolean", "object"]).toContain(typeof a);
    // what the JS side costs, on a context that does nothing: well under a millisecond a frame
    const quiet = new Proxy({}, { get: () => () => {}, set: () => true });
    const q = standIn({ loaded: true });
    q.mv.createCanvasTexture = () => ({ source: { element: { width: 0, height: 0, getContext: () => quiet }, update() {} } });
    const look = createCanLook(q.mv, { stage: STANDARD });
    q.mv.load();
    look.paint({ color: "#000000", art: art() });
    look.beginLive("front", { rest });
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) look.liveFrame("front", SPRITE, m);
    const usPerFrame = ((performance.now() - t0) * 1000) / n;
    expect(usPerFrame).toBeLessThan(50);
  });
});

// ---- The views, fitted, on a fake model-viewer ---------------------------------------------

/** requestAnimationFrame by hand (tests/storefront/hat-edit.test.ts's). */
function frames() {
  const pending = new Map();
  let next = 0;
  return {
    request: (cb) => (pending.set(++next, cb), next),
    cancel: (id) => void pending.delete(id),
    run(mv) {
      mv?.tick();
      const now = [...pending.values()];
      pending.clear();
      for (const cb of now) cb();
    },
  };
}

/**
 * model-viewer as the editor sees it (tests/storefront/hat-edit.test.ts's
 * fake, at the can's field of view): an orbit and target set a goal, "auto"
 * is the radius `auto`, a jump lands on it, a frame eases to it and renders,
 * the radius is held to `minRadius` (CAN_COOLER_VIEW's floor), and the hotspot
 * API projects with the camera the last frame rendered.
 */
function fakeViewer({ width = 390, height = 640, auto = 0.62, minRadius = CAN_COOLER_MIN_RADIUS } = {}) {
  const events = new EventTarget();
  const autoTarget = [0, 0.06, 0];
  let target = autoTarget;
  let goal = { theta: 0, phi: 80 * RAD, radius: null };
  const resolve = (o) => ({ ...o, radius: Math.max(minRadius, o.radius ?? auto) });
  let now = resolve(goal);
  let orbitText = "0deg 80deg auto";
  const angle = (t) => (t.endsWith("rad") ? parseFloat(t) : parseFloat(t) * RAD);
  const cameraFor = (o) => {
    const c = new THREE.PerspectiveCamera(FOV, width / height, 0.005, 10);
    c.position.set(
      target[0] + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      target[1] + o.radius * Math.cos(o.phi),
      target[2] + o.radius * Math.sin(o.phi) * Math.cos(o.theta),
    );
    c.lookAt(new THREE.Vector3(...target));
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    return c;
  };
  let rendered = cameraFor(now);
  const probe = new THREE.Vector3();
  const changed = () => events.dispatchEvent(new Event("camera-change"));
  return {
    width,
    height,
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
    get cameraOrbit() {
      return orbitText;
    },
    set cameraOrbit(v) {
      orbitText = v;
      const [t, p, r] = v.trim().split(/\s+/);
      goal = { theta: angle(t), phi: angle(p), radius: r === "auto" ? null : parseFloat(r) };
    },
    set cameraTarget(v) {
      const xyz = v.trim().split(/\s+/).map((s) => parseFloat(s));
      target = xyz.length === 3 && xyz.every(Number.isFinite) ? xyz : autoTarget;
    },
    getCameraOrbit: () => ({ ...now }),
    jumpCameraToGoal() {
      now = resolve(goal);
      changed();
    },
    tick() {
      const g = resolve(goal);
      if (g.theta !== now.theta || g.phi !== now.phi || g.radius !== now.radius) {
        now = g;
        changed();
      }
      rendered = cameraFor(now);
    },
    updateHotspot({ name, position }) {
      if (name !== "hotspot-probe") return;
      const [x, y, z] = position.trim().split(/\s+/).map((s) => parseFloat(s));
      probe.set(x, y, z);
    },
    queryHotspot(name) {
      if (name !== "hotspot-probe") return null;
      const v = probe.clone().project(rendered);
      return { canvasPosition: { x: (v.x * width) / 2 + width / 2, y: (-v.y * height) / 2 + height / 2, z: v.z } };
    },
  };
}

const hostOf = (mv) => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: mv.width, height: mv.height }) });
const PHONE = { width: 390, height: 640 };
const LAPTOP = { width: 1200, height: 800 };

/** How much of the editor a side's area fills now (1: the fill exactly), in its tighter direction. */
function ratio(mv, surface, zone, area, fill) {
  const res = measureProjection(mv, probePointsFor(surface, zone), { name: "probe" });
  surface.setCamera(res.P);
  const pts = areaScreenPoints(surface, zone, area);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const f = mv.width < 600 ? fill.narrow : fill.wide;
  return Math.max((Math.max(...xs) - Math.min(...xs)) / (f.w * mv.width), (Math.max(...ys) - Math.min(...ys)) / (f.h * mv.height));
}

describe("fitSpot, with the can's look", () => {
  it("fits each side to CAN_EDIT_FILL, from the radius the camera really has, never at the radius floor", () => {
    for (const dieId of ["koozie-standard", "koozie-slim"]) {
      const die = canEditDie(dieId);
      for (const size of [PHONE, LAPTOP]) {
        for (const zone of CAN_EDIT_ZONES) {
          const f = frames();
          const mv = fakeViewer(size);
          const surface = createSurface(SURFACES[dieId]);
          const look = createCanLook(mv, { stage: die.stage });
          const onFitted = vi.fn();
          const onWindow = vi.fn();
          const area = canSpotLimits(die, zone).area;
          fitSpot({ mv, look, surface, zone, area, host: hostOf(mv), requestFrame: f.request, cancelFrame: f.cancel, onWindow, onFitted });
          for (let i = 0; i < 3; i++) f.run(mv);
          expect(onFitted).toHaveBeenCalledTimes(1);
          const fit = onFitted.mock.calls[0][0];
          expect(fit.had).toBeCloseTo(0.62, 9);
          expect(fit.radius, `${dieId} ${zone} ${size.width}`).toBeGreaterThan(CAN_COOLER_MIN_RADIUS * 1.2);
          const k = ratio(mv, surface, zone, area, CAN_EDIT_FILL);
          expect(k, `${dieId} ${zone} ${size.width}`).toBeGreaterThan(0.9);
          expect(k, `${dieId} ${zone} ${size.width}`).toBeLessThan(1.1);
          const v = CAN_EDIT_VIEWS[zone];
          expect(onWindow).toHaveBeenCalledWith(canOrbitWindow(zone, v.theta, v.phi));
        }
      }
    }
  });

  it("fits a view whose radius is auto, where it used to give up; only angles that aren't numbers still give up", () => {
    const die = canEditDie("koozie-standard");
    const area = canSpotLimits(die, "front").area;
    const f = frames();
    const mv = fakeViewer(LAPTOP);
    const surface = createSurface(SURFACES["koozie-standard"]);
    // a look that leaves the radius to the viewer, and no fill or window of its own: the hat's are used
    const look = { view: () => { mv.cameraTarget = "0m 0.05m 0m"; mv.cameraOrbit = "0deg 80deg auto"; } };
    const onFitted = vi.fn();
    const onWindow = vi.fn();
    fitSpot({ mv, look, surface, zone: "front", area, host: hostOf(mv), requestFrame: f.request, cancelFrame: f.cancel, onWindow, onFitted });
    expect(onWindow).toHaveBeenCalledWith(orbitWindow("front", 0, 80));
    for (let i = 0; i < 3; i++) f.run(mv);
    const fit = onFitted.mock.calls[0][0];
    expect(fit.had).toBeCloseTo(0.62, 9);
    expect(mv.cameraOrbit).toBe(`0deg 80deg ${fit.radius}m`);
    const k = ratio(mv, surface, "front", area, SPOT_FILL);
    expect(k).toBeGreaterThan(0.9);
    expect(k).toBeLessThan(1.1);

    const lost = vi.fn();
    fitSpot({ mv, look: { view: () => { mv.cameraOrbit = "auto auto auto"; } }, surface, zone: "front", area, host: hostOf(mv), requestFrame: f.request, cancelFrame: f.cancel, onFitted: lost });
    expect(lost).toHaveBeenCalledWith(null);
  });
});

it("measures a hat's areas exactly as before: every point of them is on its print faces", () => {
  for (const [file, die] of [["hat-no-7", HAT_NO_7_DIE], ["hat-no-6", HAT_NO_6_DIE]]) {
    const surface = createSurface(JSON.parse(readFileSync(new URL(`../models/${file}-surface.json`, import.meta.url), "utf8")));
    for (const z of die.zones) {
      for (const [x, y] of areaFitPoints(zoneArea(z))) expect(surface.dieToModel(z.id, x, y), `${file} ${z.id}`).not.toBeNull();
    }
  }
});

describe("an edit session on the can", () => {
  it("fits, turns in the can's window, and paints a drag live through the can's look", () => {
    const f = frames();
    const mv = fakeViewer(PHONE);
    // the look's texture needs a loaded model: the stand-in's, on the fake viewer
    const s = standIn({ loaded: true });
    Object.assign(mv, { loaded: true, model: s.mv.model, createCanvasTexture: s.mv.createCanvasTexture.bind(s.mv) });
    const die = canEditDie("koozie-standard");
    const look = createCanLook(mv, { stage: die.stage, textureScale: 0.6 });
    look.paint({ color: "#1C2E4A", art: art() });
    const surface = createSurface(SURFACES["koozie-standard"]);
    const limits = canSpotLimits(die, "front");
    const placers = [];
    const makePlacer = (_host, opts) => {
      const p = { opts, update: vi.fn(), destroy: vi.fn() };
      placers.push(p);
      return p;
    };
    const pieceArt = art(300, 150);
    const rest = art(600, 1200);
    const edit = {
      zone: "front",
      area: limits.area,
      cap: limits.cap,
      pxPerInch: limits.pxPerInch,
      level: limits.level,
      labels: limits.labels,
      pieces: [{ id: "a", cx: 500, cy: 400, w: 300, h: 150, rotation: 0, label: "Logo" }],
      selectedId: "a",
      pieceArt: () => pieceArt,
      restArt: () => rest,
      onCommit: vi.fn(),
      reducedMotion: false,
    };
    const session = createEditSession({ mv, host: hostOf(mv), look, surface, edit, requestFrame: f.request, cancelFrame: f.cancel, makePlacer });
    for (let i = 0; i < 4; i++) f.run(mv);
    expect(session.residual).toBeLessThan(1e-3);
    expect(session.failed).toBe(false);
    const { opts } = placers[0];
    expect(opts.camera.window).toEqual(canOrbitWindow("front", 0, 80));
    expect(opts.level).toBe(0);
    expect(opts.labels).toEqual({ spot: "front panel" });
    expect(ratio(mv, surface, "front", limits.area, CAN_EDIT_FILL)).toBeCloseTo(1, 1);

    s.ops.length = 0;
    opts.onLive("a", { cx: 520, cy: 410, w: 300, h: 150, rotation: 0 }, { pushed: false, kind: "move" });
    expect(s.ops).toContainEqual(["drawImage", rest, 0, 0, 1000, 2000]);
    expect(s.ops).toContainEqual(["drawImage", pieceArt, 0, 0, 300, 150]);
    opts.onCommit("a", { cx: 530, cy: 410, w: 300, h: 150, rotation: 0 });
    expect(edit.onCommit).toHaveBeenCalledTimes(1);
    // the rest canvas is let go once the drag ends (the session zeroes it)
    expect(rest.width).toBe(0);

    // the back: its own view, turned 180 in the die
    const back = canSpotLimits(die, "back");
    session.update({ ...edit, zone: "back", area: back.area, cap: back.cap, level: back.level, labels: back.labels, pieces: [] });
    expect(mv.cameraOrbit.startsWith("180deg 80deg")).toBe(true);
    expect(placers[0].update).toHaveBeenCalledWith(expect.objectContaining({ zone: "back", level: 180, labels: { spot: "back panel" } }));
    for (let i = 0; i < 4; i++) f.run(mv);
    expect(session.residual).toBeLessThan(1e-3);
    expect(opts.camera.window).toEqual(canOrbitWindow("back", 180, 80));
    session.destroy();
  });
});

it("is exported from the viewer entry point", () => {
  for (const name of ["createCanLook", "CAN_EDIT_VIEWS", "canEditDie", "canSpotLimits", "canRestArt", "CAN_EDIT_FILL", "canOrbitWindow", "CAN_COOLER_MIN_RADIUS"]) {
    expect(viewer[name], name).toBeDefined();
  }
  expect(CAN_COOLER_VIEW["min-camera-orbit"]).toBe(`auto 35deg ${CAN_COOLER_MIN_RADIUS}m`);
});
