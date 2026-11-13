// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-place.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted: the real surface is a byte copy of the storefront's
// src/components/storefront/hat/hat-no7-surface.json (origin/main d78d90ee; the first No. 7's
// 1560 x 1296 surface, which this package does not ship) at that path under
// tests/storefront/fixtures/viewer/. Nothing dropped.
/**
 * Placing art on the 3D hat (hat-place.js): the gestures, driven end to end
 * through createPlacer with fake surfaces and a minimal fake DOM, then with the
 * real No. 7 surface under a real perspective camera. jsdom is not installed
 * in this repo, and the placer only needs listeners, a rect, pointer capture
 * and a few SVG nodes, so the fake is smaller than the dependency would be.
 *
 * The flat fake (die = 2 x screen + offset) pins the gestures' arithmetic. The
 * others pin what a flat map cannot show: a turned, sheared die (the jacobian's
 * off-diagonal terms and their orientation), a zone edge past which the
 * surface extrapolates wildly or returns nothing (as hat-surface's nearest
 * triangle does by the silhouette), and a fold whose far side projects onto
 * the near side's fabric (faces turned away).
 *
 * What is pinned: a move keeps the grabbed die point under the pointer; a
 * corner scales about the centre; the knob turns a whole degree at a time
 * from the spot's level and sticks to no angle (15 degree steps with Shift),
 * ticking as it reaches the level or a right angle from it; two fingers
 * pinch, twist (once turned 4 degrees) and pan as ONE gesture wherever they
 * land; release commits the confined pose exactly once, with
 * the limit's note; Escape commits nothing; pointercancel commits; bare fabric
 * orbits inside the camera's window and a tap there deselects; a drag or a
 * pan past the zone moves steadily; nothing turned away is drawn or taken;
 * turning back restores a size a turn shrank; on a polygon area (both front
 * panels as one, eyelet keep-outs) the outline and each hole are drawn, a drag
 * stops at its edge, slides along it and never hops an eyelet, a nudge follows
 * the sloping crease but stops when pushed into it, and the centre snap is the
 * seam's x only.
 */
import { describe, expect, it } from "vitest";
import SURFACE from "./fixtures/viewer/src/components/storefront/hat/hat-no7-surface.json";
import { createSurface } from "../../src/viewer/hat-surface.js";
import {
  createPlacer,
  orbitFrom,
  pathOf,
  readJacobian,
  turnFromLevel,
  wrap180,
} from "../../src/viewer/hat-place.js";
import { poseValid, rotatedSize } from "../../src/core/region.js";

// ---- A minimal DOM -----------------------------------------------------------------
class FakeNode {
  tagName: string;
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(k: string, v: string) {
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

type Ev = Record<string, unknown> & { stopped?: boolean; prevented?: boolean };
const RECT = { left: 10, top: 20, width: 800, height: 600 };

class FakeHost extends FakeNode {
  listeners: { type: string; fn: (e: Ev) => void; capture: boolean }[] = [];
  captured = new Set<number>();
  tabIndex = -1;
  ownerDocument: unknown;
  clientHeight = RECT.height;
  constructor(doc: unknown) {
    super("div");
    this.ownerDocument = doc;
  }
  addEventListener(type: string, fn: (e: Ev) => void, opts?: boolean | { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: opts === true || !!(opts as { capture?: boolean })?.capture });
  }
  removeEventListener(type: string, fn: (e: Ev) => void) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  getBoundingClientRect() {
    return { ...RECT };
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
  fire(type: string, init: Record<string, unknown>) {
    const e: Ev = {
      type,
      target: this,
      ...init,
      preventDefault() {
        e.prevented = true;
      },
      stopPropagation() {
        e.stopped = true;
      },
    };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
    return e;
  }
}

// ---- The fixture: the No. 7's front, a flat fake surface, a frame queue --------------
const PPI = 200;
const FRONT = { x: 40, y: 40, w: 900, h: 450 };
const FRONT_CAP = { w: 4.5 * PPI, h: 2.25 * PPI };
// die = K * screen + O (screen = CSS px from the host's top-left).
const K = 2;
const O = [-100, -60];
const flat = {
  screenToDie: (_z: string, sx: number, sy: number) => ({ x: K * sx + O[0], y: K * sy + O[1], inside: true }),
  dieToScreen: (_z: string, dx: number, dy: number) => [(dx - O[0]) / K, (dy - O[1]) / K] as [number, number],
  jacobian: () => [
    [1 / K, 0],
    [0, 1 / K],
  ],
};
const scr = (dx: number, dy: number) => flat.dieToScreen("front", dx, dy);

type Pose = { cx: number; cy: number; w: number; h: number; rotation: number };
const A = { id: "a", cx: 490, cy: 265, w: 200, h: 100, rotation: 0, label: "Logo" };

function setup(over: Record<string, unknown> = {}) {
  const doc = {
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    activeElement: null,
    defaultView: { getComputedStyle: () => ({ position: "relative" }) },
  };
  const host = new FakeHost(doc);
  const frames = new Map<number, (t: number) => void>();
  let nextFrame = 1;
  const flush = () => {
    for (let i = 0; i < 10 && frames.size; i++) {
      const list = [...frames.entries()];
      frames.clear();
      for (const [, f] of list) f(0);
    }
  };
  const calls = {
    select: [] as (string | null)[],
    live: [] as [string, Pose, { pushed: boolean }][],
    commit: [] as [string, Pose][],
    cancel: [] as string[],
    note: [] as string[],
    snap: 0,
    del: [] as string[],
    orbit: [] as { theta: number; phi: number }[],
  };
  let orbit = { theta: 0, phi: 1.2 };
  const camera = {
    getOrbit: () => ({ ...orbit }),
    setOrbit: (o: { theta: number; phi: number }) => {
      orbit = { ...o };
      calls.orbit.push({ ...o });
    },
    window: { theta: [-0.5, 0.5] as [number, number], phi: [0.9, 1.6] as [number, number] },
  };
  const placer = createPlacer(host as unknown as HTMLElement, {
    surface: flat,
    zone: "front",
    area: FRONT,
    cap: FRONT_CAP,
    pieces: [A],
    selectedId: null,
    camera,
    labels: { spot: "front" },
    pxPerInch: PPI,
    requestFrame: (cb: (t: number) => void) => {
      frames.set(nextFrame, cb);
      return nextFrame++;
    },
    cancelFrame: (id: number) => frames.delete(id),
    onSelect: (id: string | null) => calls.select.push(id),
    onLive: (id: string, pose: Pose, info: { pushed: boolean }) => calls.live.push([id, pose, info]),
    onCommit: (id: string, pose: Pose) => calls.commit.push([id, pose]),
    onCancel: (id: string) => calls.cancel.push(id),
    onNote: (t: string) => calls.note.push(t),
    onSnap: () => calls.snap++,
    onDelete: (id: string) => calls.del.push(id),
    ...over,
  });
  /** Pointer events at host-local screen px. */
  const at = (p: number[], id: number, type: string, extra: Record<string, unknown>) => ({
    pointerId: id,
    pointerType: type,
    clientX: p[0] + RECT.left,
    clientY: p[1] + RECT.top,
    button: 0,
    ...extra,
  });
  const down = (p: number[], id = 1, type = "mouse", extra = {}) => host.fire("pointerdown", at(p, id, type, extra));
  const move = (p: number[], id = 1, type = "mouse", extra = {}) => {
    const e = host.fire("pointermove", at(p, id, type, extra));
    flush();
    return e;
  };
  const up = (p: number[], id = 1, type = "mouse") => {
    const e = host.fire("pointerup", at(p, id, type, {}));
    flush();
    return e;
  };
  const key = (k: string, extra = {}) => host.fire("keydown", { key: k, ...extra });
  return { host, placer, calls, flush, down, move, up, key, camera, getOrbit: () => orbit };
}

const close = (a: Pose, b: Partial<Pose>, digits = 6) => {
  for (const [k, v] of Object.entries(b)) expect(a[k as keyof Pose], k).toBeCloseTo(v as number, digits);
};

// ---- Pure helpers ----------------------------------------------------------------
describe("hat-place helpers", () => {
  it("turns to whole degrees from the level, sticking to nothing, and says when it is at the level or a right angle from it", () => {
    expect(turnFromLevel(47.4)).toEqual({ rotation: 47, at: null });
    expect(turnFromLevel(1)).toEqual({ rotation: 1, at: null });
    expect(turnFromLevel(89.6)).toEqual({ rotation: 90, at: 90 });
    expect(turnFromLevel(8.3, 8)).toEqual({ rotation: 8, at: 0 });
    expect(turnFromLevel(9, 8)).toEqual({ rotation: 9, at: null });
    expect(turnFromLevel(-82, 8)).toEqual({ rotation: -82, at: -90 });
    expect(turnFromLevel(188, 8)).toEqual({ rotation: 188, at: 180 });
    expect(turnFromLevel(22, 0, 15)).toEqual({ rotation: 15, at: null });
    expect(turnFromLevel(23, 8, 15)).toEqual({ rotation: 23, at: null });
  });

  it("wraps degrees to (-180, 180]", () => {
    expect([wrap180(190), wrap180(-180), wrap180(540), wrap180(-0), wrap180(45)]).toEqual([-170, 180, 180, 0, 45]);
  });

  it("orbits at model-viewer's rate and direction, held in the window", () => {
    const o = orbitFrom({ theta: 0, phi: 1 }, 60, -30, 600);
    expect(o.theta).toBeCloseTo((-2 * Math.PI * 60) / 600, 12);
    expect(o.phi).toBeCloseTo(1 + (2 * Math.PI * 30) / 600, 12);
    expect(orbitFrom({ theta: 0, phi: 1 }, 1000, 1000, 600, { theta: [-0.5, 0.5], phi: [0.9, 1.6] })).toEqual({
      theta: -0.5,
      phi: 0.9,
    });
  });

  it("draws a projected outline, broken where points did not project", () => {
    expect(pathOf([[0, 0], [10, 0], [10, 10]])).toBe("M0.0,0.0L10.0,0.0L10.0,10.0Z");
    // A gap mid-ring: the run that wraps round the end stays one run.
    expect(pathOf([[0, 0], null, [10, 10], [0, 10]])).toBe("M10.0,10.0L0.0,10.0L0.0,0.0");
    expect(pathOf([null, null])).toBe("");
  });

  it("reads a jacobian in any of its shapes, and refuses a singular one", () => {
    expect(readJacobian([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
    expect(readJacobian([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(readJacobian({ a: 1, b: 2, c: 3, d: 4 })).toEqual([1, 2, 3, 4]);
    expect(readJacobian([[1, 2], [2, 4]])).toBeNull();
    expect(readJacobian(null)).toBeNull();
  });
});

// ---- The placer ------------------------------------------------------------------
describe("createPlacer: wiring", () => {
  it("listens in the capture phase, takes touch and focus, and overlays an outline only while a piece is selected", () => {
    const t = setup();
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      expect(t.host.listeners.find((l) => l.type === type)?.capture, type).toBe(true);
    }
    expect(t.host.style.touchAction).toBe("none");
    expect(t.host.tabIndex).toBe(0);
    const svg = t.host.children.find((c) => c.tagName === "SVG")!;
    expect(svg.attrs["aria-hidden"]).toBe("true");
    expect(svg.style.pointerEvents).toBe("none");
    const area = svg.children.find((c) => c.attrs["data-part"] === "area")!;
    expect(area.style.display).toBe("none");
    t.placer.update({ selectedId: "a" });
    expect(area.style.display).toBe("");
    expect(area.style.opacity).toBe("0.35");
    // Sampled every 2 mm round the 4.5 x 2.25 in rect: ~172 points.
    const d = area.children[1].attrs.d;
    expect(d.split("L").length).toBeGreaterThan(150);
    t.placer.destroy();
    expect(t.host.children).not.toContain(svg);
    expect(t.host.listeners).toEqual([]);
  });

  it("stacks its overlay by z-index inside an isolated host, not by DOM order, and puts the host back", () => {
    const t = setup();
    const svg = t.host.children.find((c) => c.tagName === "SVG")!;
    expect(svg.style.zIndex).toBe("1");
    expect(t.host.style.isolation).toBe("isolate");
    t.placer.destroy();
    expect(t.host.style.isolation).toBeUndefined();
    const u = setup({ zIndex: 7 });
    expect(u.host.children.find((c) => c.tagName === "SVG")!.style.zIndex).toBe("7");
  });

  it("dims nothing under reduced motion: the outline has no fade", () => {
    const t = setup({ reducedMotion: true, selectedId: "a" });
    const svg = t.host.children.find((c) => c.tagName === "SVG")!;
    expect(svg.children[0].style.transition).toBe("");
    t.placer.update({ reducedMotion: false });
    expect(svg.children[0].style.transition).toMatch(/^opacity /);
  });
});

describe("createPlacer: one finger or the mouse", () => {
  it("selects on press, and a move keeps the grabbed die point under the pointer", () => {
    const t = setup();
    const grab = scr(520, 280);
    const e = t.down(grab);
    expect(e.stopped).toBe(true);
    expect(t.calls.select).toEqual(["a"]);
    t.move([grab[0] + 40, grab[1] + 20]);
    const [, live] = t.calls.live.at(-1)!;
    close(live, { cx: 570, cy: 305, w: 200, h: 100, rotation: 0 });
    // The grabbed point (30, 15) from the centre is where the pointer is.
    expect(scr(live.cx + 30, live.cy + 15)).toEqual([grab[0] + 40, grab[1] + 20]);
    t.up([grab[0] + 40, grab[1] + 20]);
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 570, cy: 305, w: 200, h: 100, rotation: 0 });
    expect(t.calls.note).toEqual([]);
  });

  it("does nothing under the 2 px mouse slop, and a tap on a piece selects without a commit", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c);
    t.move([c[0] + 1, c[1] + 1]);
    t.up([c[0] + 1, c[1] + 1]);
    expect(t.calls.select).toEqual(["a"]);
    expect(t.calls.live).toEqual([]);
    expect(t.calls.commit).toEqual([]);
  });

  it("waits out the 4 px touch slop before a finger moves a piece", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c, 1, "touch");
    t.move([c[0] + 3, c[1]], 1, "touch");
    expect(t.calls.live).toEqual([]);
    t.move([c[0] + 10, c[1]], 1, "touch");
    close(t.calls.live.at(-1)![1], { cx: 510 });
  });

  it("scales uniformly about the centre from a corner handle", () => {
    const t = setup({ selectedId: "a" });
    t.down(scr(590, 315)); // bottom-right corner
    t.move(scr(690, 365)); // twice as far from the centre
    t.up(scr(690, 365));
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 490, cy: 265, w: 400, h: 200, rotation: 0 });
  });

  it("turns from the knob above the piece a whole degree at a time, sticking to no angle, and ticks once at a right angle", () => {
    const t = setup({ selectedId: "a" });
    const centre = scr(490, 265);
    const top = scr(490, 215);
    const knob = [top[0], top[1] - 24]; // a 24 px stalk straight up
    const r = Math.hypot(knob[0] - centre[0], knob[1] - centre[1]);
    const toward = (deg: number) => {
      const a = (-90 + deg) * (Math.PI / 180);
      return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    };
    t.down(knob);
    t.move(toward(30));
    close(t.calls.live.at(-1)![1], { rotation: 30 });
    t.move(toward(44.4));
    close(t.calls.live.at(-1)![1], { rotation: 44 });
    t.move(toward(46));
    close(t.calls.live.at(-1)![1], { rotation: 46 });
    expect(t.calls.snap).toBe(0);
    t.move(toward(89.7));
    close(t.calls.live.at(-1)![1], { rotation: 90 });
    t.move(toward(90.2));
    expect(t.calls.snap).toBe(1);
    t.move(toward(91));
    close(t.calls.live.at(-1)![1], { rotation: 91 });
    t.up(toward(91));
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { rotation: 91, cx: 490, cy: 265 });
  });

  it("counts turns from the spot's level: whole degrees from it, and the tick there", () => {
    const t = setup({ selectedId: "a", level: 8, pieces: [{ ...A, rotation: 8 }] });
    const centre = scr(490, 265);
    const r = 50 / 2 + 24 / 1;
    const knob = [centre[0], centre[1] - r];
    const toward = (deg: number) => {
      const a = (-90 + deg) * (Math.PI / 180);
      return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    };
    t.down(knob);
    t.move(toward(5.6));
    close(t.calls.live.at(-1)![1], { rotation: 14 });
    t.move(toward(-0.3));
    close(t.calls.live.at(-1)![1], { rotation: 8 });
    expect(t.calls.snap).toBe(1);
    t.up(toward(-0.3));
    close(t.calls.commit[0][1], { rotation: 8 });
    // the keys step from wherever it is, a degree (Shift 15)
    t.key("]");
    close(t.calls.commit.at(-1)![1], { rotation: 9 });
    t.key("[", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: -6 });
  });

  it("turns in 15 degree steps with Shift held", () => {
    const t = setup({ selectedId: "a" });
    const centre = scr(490, 265);
    const top = scr(490, 215);
    const knob = [top[0], top[1] - 24];
    const r = centre[1] - knob[1];
    const toward = (deg: number) => {
      const a = (-90 + deg) * (Math.PI / 180);
      return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    };
    t.down(knob);
    t.move(toward(22), 1, "mouse", { shiftKey: true });
    close(t.calls.live.at(-1)![1], { rotation: 15 });
    t.move(toward(23), 1, "mouse", { shiftKey: true });
    close(t.calls.live.at(-1)![1], { rotation: 30 });
  });

  it("puts the knob below a piece whose top is near the frame's top", () => {
    // Top edge at die y 40 is screen y 50: the knob 24 px above, at 26, is clear of the top.
    const t = setup({ selectedId: "a", pieces: [{ ...A, cy: 60, h: 40 }] });
    const svg = t.host.children.find((c) => c.tagName === "SVG")!;
    const piece = svg.children.find((c) => c.attrs["data-part"] === "piece")!;
    const knob = piece.children.find((c) => c.attrs["data-part"] === "knob")!;
    expect(Number(knob.attrs.cy)).toBeCloseTo(26, 6);
    // Top edge at screen y 40 would put it at 16: it goes 24 px below the bottom edge (screen y 60) instead.
    t.placer.update({ pieces: [{ ...A, cy: 40, h: 40 }] });
    expect(Number(knob.attrs.cy)).toBeCloseTo(84, 6);
  });
});

describe("createPlacer: limits", () => {
  it("resists a drag past the edge (never more than 24 screen px), then commits it clamped with the area note", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c);
    t.move([c[0] - 100, c[1]]);
    t.move([c[0] - 600, c[1]]);
    const [, live, info] = t.calls.live.at(-1)!;
    expect(info.pushed).toBe(true);
    // Settles at cx 140 (half its 200 width inside the area's x 40); shown short of that, by under 24 px on screen.
    expect(live.cx).toBeLessThan(140);
    expect((140 - live.cx) / K).toBeLessThan(24);
    expect(live.cx).toBeGreaterThan(490 - 1200);
    const svg = t.host.children.find((n) => n.tagName === "SVG")!;
    const area = svg.children[0];
    expect(area.style.opacity).toBe("1");
    expect(area.children[1].style.stroke).toMatch(/hat-place-edge/);
    t.up([c[0] - 600, c[1]]);
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 140, cy: 265, w: 200, h: 100 });
    expect(t.calls.note).toEqual(["The front's logo area ends here."]);
  });

  it("stops a stretch at the cap, the largest the spot takes, and says so in inches", () => {
    const t = setup({ selectedId: "a" });
    t.down(scr(590, 315));
    t.move(scr(1490, 765)); // ten times the reach: 2000 x 1000 asked for
    t.up(scr(1490, 765));
    expect(t.calls.commit).toHaveLength(1);
    const pose = t.calls.commit[0][1];
    const e = rotatedSize(pose.w, pose.h, pose.rotation);
    expect(e.w).toBeCloseTo(900, 6);
    expect(e.h).toBeCloseTo(450, 6);
    expect(t.calls.note).toEqual(["That's the largest the front takes: 4.5 × 2.25 in."]);
  });

  it("shrinks a piece turned past what fits, keeping it inside the area and the cap", () => {
    const wide = { ...A, w: 800, h: 300 };
    const t = setup({ selectedId: "a", pieces: [wide] });
    const centre = scr(490, 265);
    const knob = [centre[0], scr(490, 115)[1] - 24];
    const r = centre[1] - knob[1];
    t.down(knob);
    t.move([centre[0] + r * Math.cos(-Math.PI / 4), centre[1] + r * Math.sin(-Math.PI / 4)]);
    t.up([centre[0] + r * Math.cos(-Math.PI / 4), centre[1] + r * Math.sin(-Math.PI / 4)]);
    const pose = t.calls.commit[0][1];
    expect(pose.rotation).toBeCloseTo(45, 6);
    const e = rotatedSize(pose.w, pose.h, 45);
    expect(e.h).toBeLessThanOrEqual(450 + 1e-6);
    expect(pose.w / pose.h).toBeCloseTo(8 / 3, 9);
  });
});

describe("createPlacer: two fingers", () => {
  it("pinches, twists and pans the selected piece as one gesture wherever the fingers land, with one commit", () => {
    const t = setup({ selectedId: "a" });
    // Both fingers on bare fabric, far from the piece.
    t.down([600, 500], 1, "touch");
    t.down([700, 500], 2, "touch");
    const f2 = [600 + 150 * Math.cos(Math.PI / 6), 500 + 150 * Math.sin(Math.PI / 6)];
    t.move(f2, 2, "touch");
    const mid = [(600 + f2[0]) / 2, (500 + f2[1]) / 2];
    const pan = [K * (mid[0] - 650), K * (mid[1] - 500)];
    const want = { cx: 490 + pan[0], cy: 265 + pan[1], w: 300, h: 150, rotation: 30 };
    close(t.calls.live.at(-1)![1], want);
    expect(t.calls.orbit).toEqual([]);
    t.up(f2, 2, "touch");
    t.move([620, 520], 1, "touch"); // the finger left behind does nothing more
    t.up([620, 520], 1, "touch");
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], want);
  });

  it("leaves the angle alone until a twist passes 4 degrees, then follows it a whole degree at a time, sticking to none", () => {
    const t = setup({ selectedId: "a" });
    t.down([600, 500], 1, "touch");
    t.down([700, 500], 2, "touch");
    const twist = (deg: number) => [600 + 100 * Math.cos(deg * DEG), 500 + 100 * Math.sin(deg * DEG)];
    t.move(twist(3), 2, "touch");
    close(t.calls.live.at(-1)![1], { rotation: 0 });
    t.move(twist(6), 2, "touch");
    close(t.calls.live.at(-1)![1], { rotation: 6 });
    t.move(twist(2.2), 2, "touch"); // back under 4: it still turns
    close(t.calls.live.at(-1)![1], { rotation: 2 });
    t.move(twist(88), 2, "touch");
    close(t.calls.live.at(-1)![1], { rotation: 88 });
    expect(t.calls.snap).toBe(0);
    t.move(twist(90), 2, "touch");
    close(t.calls.live.at(-1)![1], { rotation: 90 });
    expect(t.calls.snap).toBe(1);
    t.up(twist(90), 2, "touch");
    close(t.calls.commit[0][1], { rotation: 90 });
  });

  it("carries a drag the second finger interrupts into the pinch: still one commit", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c, 1, "touch");
    t.move([c[0] + 20, c[1]], 1, "touch"); // die +40
    t.down([c[0] + 120, c[1]], 2, "touch");
    t.move([c[0] + 170, c[1]], 2, "touch"); // spread 100 to 150, midpoint +25 px: die +50
    t.up([c[0] + 170, c[1]], 2, "touch");
    t.up([c[0] + 20, c[1]], 1, "touch");
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 490 + 40 + 50, cy: 265, w: 300, h: 150, rotation: 0 });
  });

  it("commits nothing for a two-finger tap", () => {
    const t = setup({ selectedId: "a" });
    t.down([600, 500], 1, "touch");
    t.down([700, 500], 2, "touch");
    t.up([700, 500], 2, "touch");
    t.up([600, 500], 1, "touch");
    expect(t.calls.commit).toEqual([]);
  });
});

describe("createPlacer: ending a gesture", () => {
  it("Escape cancels: no commit, no more live frames, and the rest of the drag is ignored", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c);
    t.move([c[0] + 30, c[1]]);
    const lives = t.calls.live.length;
    const esc = t.key("Escape");
    expect(esc.prevented).toBe(true);
    expect(t.calls.cancel).toEqual(["a"]);
    t.move([c[0] + 60, c[1]]);
    t.up([c[0] + 60, c[1]]);
    expect(t.calls.commit).toEqual([]);
    expect(t.calls.live).toHaveLength(lives);
  });

  it("cancel() does what Escape does", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c);
    t.move([c[0] + 30, c[1]]);
    expect(t.placer.cancel()).toBe(true);
    t.up([c[0] + 30, c[1]]);
    expect(t.calls.cancel).toEqual(["a"]);
    expect(t.calls.commit).toEqual([]);
    expect(t.placer.cancel()).toBe(false);
  });

  it("pointercancel commits the last clamped pose, once", () => {
    const t = setup();
    const c = scr(490, 265);
    t.down(c, 1, "touch");
    t.move([c[0] - 600, c[1]], 1, "touch");
    t.host.fire("pointercancel", { pointerId: 1, pointerType: "touch", clientX: 0, clientY: 0 });
    t.flush();
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 140, cy: 265 });
  });
});

describe("createPlacer: bare fabric", () => {
  it("orbits the camera at model-viewer's rate inside its window", () => {
    const t = setup();
    t.down([700, 500]);
    t.move([710, 500]);
    expect(t.calls.orbit.at(-1)!.theta).toBeCloseTo((-2 * Math.PI * 10) / RECT.height, 12);
    expect(t.calls.orbit.at(-1)!.phi).toBeCloseTo(1.2, 12);
    t.move([1500, 100]);
    expect(t.calls.orbit.at(-1)).toEqual({ theta: -0.5, phi: 1.6 });
    t.up([1500, 100]);
    expect(t.calls.select).toEqual([]);
    expect(t.calls.commit).toEqual([]);
  });

  it("deselects on a tap", () => {
    const t = setup({ selectedId: "a" });
    t.down([700, 500], 1, "touch");
    t.move([703, 501], 1, "touch");
    t.up([703, 501], 1, "touch");
    expect(t.calls.select).toEqual([null]);
  });

  it("lets a press with no camera through to what is under it, and still deselects on a tap", () => {
    const t = setup({ selectedId: "a", camera: null });
    const e = t.down([700, 500]);
    expect(e.stopped).toBeUndefined();
    t.up([700, 500]);
    expect(t.calls.select).toEqual([null]);
  });
});

describe("createPlacer: what a press takes", () => {
  const B = { id: "b", cx: 520, cy: 280, w: 200, h: 100, rotation: 0 };

  it("takes the topmost piece when none is selected, and the selected one over it", () => {
    const t = setup({ pieces: [A, B] });
    t.down(scr(505, 270));
    t.up(scr(505, 270));
    expect(t.calls.select).toEqual(["b"]);
    const u = setup({ pieces: [A, B], selectedId: "a" });
    u.down(scr(505, 270));
    u.up(scr(505, 270));
    expect(u.calls.select).toEqual([]);
    u.move(scr(505, 270)); // hover only
    u.down(scr(505, 270));
    u.move(scr(545, 270));
    u.up(scr(545, 270));
    expect(u.calls.commit[0][0]).toBe("a");
  });

  it("gives a small piece at least a 44 px target round its centre", () => {
    const tiny = { id: "t", cx: 490, cy: 265, w: 10, h: 10, rotation: 0 };
    const t = setup({ pieces: [tiny] });
    const c = scr(490, 265);
    t.down([c[0] + 20, c[1] - 20]);
    expect(t.calls.select).toEqual(["t"]);
  });
});

describe("createPlacer: keys", () => {
  it("nudges 0.05 in (Shift ten times), turns a degree (Shift 15), scales 5%, and deletes", () => {
    const t = setup({ selectedId: "a" });
    t.key("ArrowRight");
    close(t.calls.commit.at(-1)![1], { cx: 500, cy: 265 });
    t.key("ArrowDown", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { cx: 500, cy: 365 });
    t.key("]");
    close(t.calls.commit.at(-1)![1], { rotation: 1 });
    t.key("[", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: -14 });
    t.key("=");
    close(t.calls.commit.at(-1)![1], { w: 210, h: 105 });
    t.key("Delete");
    expect(t.calls.del).toEqual(["a"]);
    expect(t.calls.commit).toHaveLength(5);
  });

  it("says why a nudge into the edge moves nothing, without a commit", () => {
    const t = setup({ selectedId: "a", pieces: [{ ...A, cx: 140 }] });
    t.key("ArrowLeft");
    expect(t.calls.commit).toEqual([]);
    expect(t.calls.note).toEqual(["The front's logo area ends here."]);
  });

  it("moves along the arrow as seen on screen when the die is mirrored there", () => {
    const mirrored = {
      screenToDie: (_z: string, sx: number, sy: number) => ({ x: 1000 - K * sx, y: K * sy, inside: true }),
      dieToScreen: (_z: string, dx: number, dy: number) => [(1000 - dx) / K, dy / K] as [number, number],
    };
    const t = setup({ selectedId: "a", surface: mirrored });
    t.key("ArrowRight");
    close(t.calls.commit.at(-1)![1], { cx: 480, cy: 265 });
  });

  it("orbits with the arrows when nothing is selected, and Escape deselects", () => {
    const t = setup();
    t.key("ArrowLeft");
    expect(t.getOrbit().theta).toBeCloseTo((15 * Math.PI) / 180, 12);
    const u = setup({ selectedId: "a" });
    u.key("Escape");
    expect(u.calls.select).toEqual([null]);
  });
});

// ---- Surfaces a flat map cannot stand in for ---------------------------------------
type Surf = {
  screenToDie: (z: string, sx: number, sy: number, o?: { extrapolate?: boolean }) => { x: number; y: number; inside?: boolean } | null;
  dieToScreen: (z: string, dx: number, dy: number) => [number, number] | null;
  jacobian?: (z: string, dx: number, dy: number) => number[][] | null;
};
const DEG = Math.PI / 180;
const partOf = (t: ReturnType<typeof setup>, part: string) =>
  t.host.children.find((c) => c.tagName === "SVG")!.children.find((c) => c.attrs["data-part"] === part)!;

/** die = M screen + OFF, with the jacobian a surface gives (screen px per die px: M's inverse). */
function affine(M: number[][], OFF: number[]): Surf {
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const inv = [
    [M[1][1] / det, -M[0][1] / det],
    [-M[1][0] / det, M[0][0] / det],
  ];
  return {
    screenToDie: (_z, sx, sy) => ({ x: M[0][0] * sx + M[0][1] * sy + OFF[0], y: M[1][0] * sx + M[1][1] * sy + OFF[1], inside: true }),
    dieToScreen: (_z, dx, dy) => [inv[0][0] * (dx - OFF[0]) + inv[0][1] * (dy - OFF[1]), inv[1][0] * (dx - OFF[0]) + inv[1][1] * (dy - OFF[1])],
    jacobian: () => inv,
  };
}

/**
 * The flat fake, its fabric ending at die x = EDGE_X. Past it the surface says
 * nothing ("none") or, as hat-surface's nearest boundary triangle does by the
 * silhouette, extrapolates with a huge, jumpy gain and `inside: false`
 * ("wild"), whatever options it is passed.
 */
const EDGE_X = 700;
function edged(mode: "wild" | "none"): Surf {
  return {
    screenToDie: (_z, sx, sy) => {
      const d = flat.screenToDie("front", sx, sy);
      if (d.x <= EDGE_X) return d;
      if (mode === "none") return null;
      const over = d.x - EDGE_X;
      return { x: EDGE_X + 40 * over + 300 * Math.sin(sx * 3), y: d.y + 25 * over * Math.cos(sy * 5), inside: false };
    },
    dieToScreen: flat.dieToScreen,
    jacobian: flat.jacobian,
  };
}

/**
 * A fold at die x = FOLD_X: the near side shows as the flat fake does; the far
 * side folds back under it, turned away, so its die points project onto the
 * near side's fabric (die x 700..940 onto 700..460).
 */
const FOLD_X = 700;
const FOLD_S = (FOLD_X - O[0]) / K;
const folded: Surf = {
  screenToDie: (_z, sx, sy) => {
    const d = flat.screenToDie("front", sx, sy);
    return d.x <= FOLD_X ? d : { ...d, inside: false };
  },
  dieToScreen: (_z, dx, dy) => (dx <= FOLD_X ? flat.dieToScreen("front", dx, dy) : [FOLD_S - (dx - FOLD_X) / K, (dy - O[1]) / K]),
  jacobian: (_z, dx) =>
    dx <= FOLD_X
      ? [
          [1 / K, 0],
          [0, 1 / K],
        ]
      : [
          [-1 / K, 0],
          [0, 1 / K],
        ],
};

describe("createPlacer: a turned, sheared die", () => {
  const tilted = affine(
    [
      [1.6, 0.9],
      [-0.7, 1.9],
    ],
    [-50, -30],
  );
  const ts = (dx: number, dy: number) => tilted.dieToScreen("front", dx, dy)!;

  it("keeps the grabbed die point under the pointer", () => {
    const t = setup({ surface: tilted, snapCentre: false });
    const grab = ts(520, 280);
    t.down(grab);
    const to = [grab[0] + 30, grab[1] + 10];
    t.move(to);
    const [, live] = t.calls.live.at(-1)!;
    const s = ts(live.cx + 30, live.cy + 15);
    expect(s[0]).toBeCloseTo(to[0], 6);
    expect(s[1]).toBeCloseTo(to[1], 6);
  });

  it("nudges along the arrow as the customer sees it (a transposed jacobian would not)", () => {
    const t = setup({ surface: tilted, selectedId: "a" });
    const before = ts(490, 265);
    t.key("ArrowRight");
    const p = t.calls.commit.at(-1)![1];
    const after = ts(p.cx, p.cy);
    expect(after[0] - before[0]).toBeGreaterThan(0);
    expect(after[1] - before[1]).toBeCloseTo(0, 9);
    expect(Math.hypot(p.cx - 490, p.cy - 265)).toBeCloseTo(10, 9);
  });

  it("twists the die the other way where it is mirrored on screen", () => {
    const mirrored = affine(
      [
        [-K, 0],
        [0, K],
      ],
      [1000, 0],
    );
    const t = setup({ surface: mirrored, selectedId: "a" });
    t.down([300, 400], 1, "touch");
    t.down([400, 400], 2, "touch");
    const f2 = [300 + 100 * Math.cos(Math.PI / 6), 400 + 100 * Math.sin(Math.PI / 6)];
    t.move(f2, 2, "touch");
    t.up(f2, 2, "touch");
    t.up([300, 400], 1, "touch");
    close(t.calls.commit[0][1], { rotation: -30, w: 200, h: 100 });
  });
});

describe("createPlacer: past the zone's edge", () => {
  for (const mode of ["wild", "none"] as const) {
    it(`drags steadily into the band where the surface ${mode === "wild" ? "extrapolates wildly" : "says nothing"}, and commits at the area's edge`, () => {
      const t = setup({ surface: edged(mode), pieces: [{ ...A, cx: 600 }], snapCentre: false });
      let p = scr(600, 265);
      t.down(p, 1, "touch");
      let last: number | null = null;
      for (let i = 0; i < 80; i++) {
        p = [p[0] + 2, p[1]];
        t.move(p, 1, "touch");
        const live = t.calls.live.at(-1)?.[1];
        if (!live) continue;
        // Never further than the pointer's own step at the zone's gain (2 px at 2 die px a px), and never back.
        if (last != null) {
          expect(live.cx - last).toBeLessThanOrEqual(2 * K + 1e-9);
          expect(live.cx).toBeGreaterThanOrEqual(last - 1e-9);
        }
        expect(live.cy).toBeCloseTo(265, 9);
        last = live.cx;
      }
      t.up(p, 1, "touch");
      expect(t.calls.commit).toHaveLength(1);
      close(t.calls.commit[0][1], { cx: 840, cy: 265, w: 200, h: 100 });
      expect(t.calls.note).toEqual(["The front's logo area ends here."]);
    });
  }

  it("pans a pinch steadily with both fingers off the zone, the piece following their midpoint", () => {
    const t = setup({ surface: edged("wild"), selectedId: "a", snapCentre: false });
    // Screen x past 400 is die x past 700: off the zone, where the surface runs wild.
    let a = [500, 300];
    let b = [600, 300];
    t.down(a, 1, "touch");
    t.down(b, 2, "touch");
    for (let i = 1; i <= 10; i++) {
      a = [a[0] - 3, a[1] - 2];
      b = [b[0] - 3, b[1] - 2];
      t.move(a, 1, "touch");
      t.move(b, 2, "touch");
      close(t.calls.live.at(-1)![1], { cx: 490 - 3 * K * i, cy: 265 - 2 * K * i, w: 200, h: 100 });
    }
    t.up(b, 2, "touch");
    t.up(a, 1, "touch");
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 430, cy: 225, w: 200, h: 100, rotation: 0 });
  });
});

describe("createPlacer: fabric turned away", () => {
  const H = { id: "h", cx: 820, cy: 265, w: 200, h: 100, rotation: 0 }; // wholly past the fold
  const S = { id: "s", cx: 650, cy: 265, w: 200, h: 100, rotation: 0 }; // across it

  it("never takes a piece turned away: a press on its projection turns the hat instead", () => {
    const t = setup({ surface: folded, pieces: [H] });
    const at = folded.dieToScreen("front", 820, 265)!; // over the near side's die x 580
    t.down(at, 1, "touch");
    t.move([at[0] + 20, at[1]], 1, "touch");
    t.up([at[0] + 20, at[1]], 1, "touch");
    expect(t.calls.select).toEqual([]);
    expect(t.calls.commit).toEqual([]);
    expect(t.calls.orbit.length).toBeGreaterThan(0);
  });

  it("draws only what faces the camera: nothing of a piece turned away, a broken outline across the fold", () => {
    const t = setup({ surface: folded, pieces: [H, S], selectedId: "h" });
    const piece = partOf(t, "piece");
    const line = piece.children[1];
    const handles = () => piece.children.filter((c) => ["corner", "knob"].includes(c.attrs["data-part"]) && c.style.display !== "none");
    expect(line.attrs.d).toBe("");
    expect(handles()).toEqual([]);
    // The area runs 40..940 across the fold at 700: one run, not closed.
    const ad = partOf(t, "area").children[1].attrs.d;
    expect(ad.match(/M/g)).toHaveLength(1);
    expect(ad.endsWith("Z")).toBe(false);
    t.placer.update({ selectedId: "s" });
    expect(line.attrs.d.match(/M/g)).toHaveLength(1);
    expect(line.attrs.d.endsWith("Z")).toBe(false);
    // Its two corners past the fold have no handles; the near two (and the knob above) do.
    expect(handles().filter((c) => c.attrs["data-part"] === "corner")).toHaveLength(2);
  });
});

describe("createPlacer: fingers it does not own", () => {
  it("leaves a second finger to model-viewer when the first was left to it (no camera), through both pointerups", () => {
    const t = setup({ selectedId: "a", camera: null });
    const events = [
      t.down([700, 500], 1, "touch"),
      t.down([600, 500], 2, "touch"),
      t.move([690, 490], 1, "touch"),
      t.move([620, 520], 2, "touch"),
      t.up([690, 490], 1, "touch"),
      t.up([620, 520], 2, "touch"),
    ];
    for (const e of events) {
      expect(e.stopped).toBeUndefined();
      expect(e.prevented).toBeUndefined();
    }
    expect(t.calls.live).toEqual([]);
    expect(t.calls.commit).toEqual([]);
  });
});

describe("createPlacer: turning back", () => {
  const BIG = { ...A, w: 900, h: 450 }; // the front's cap, exactly

  it("restores a size the turn keys shrank: six steps there and six back end where they began", () => {
    const t = setup({ selectedId: "a", pieces: [BIG] });
    for (let i = 0; i < 6; i++) t.key("]", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: 90, w: 450, h: 225 });
    for (let i = 0; i < 6; i++) t.key("[", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: 0, w: 900, h: 450, cx: 490, cy: 265 });
    expect(t.calls.commit).toHaveLength(12);
  });

  it("restores it across knob gestures too, with no jump as the second turn begins", () => {
    const t = setup({ selectedId: "a", pieces: [BIG] });
    const knob = partOf(t, "piece").children.find((c) => c.attrs["data-part"] === "knob")!;
    const centre = scr(490, 265);
    // Each step a turn round the centre (degrees) and out from it (px), so a
    // first step can clear the drag slop without turning.
    const turn = (steps: [number, number][]) => {
      const k = [Number(knob.attrs.cx), Number(knob.attrs.cy)];
      const a0 = Math.atan2(k[1] - centre[1], k[0] - centre[0]);
      const r = Math.hypot(k[0] - centre[0], k[1] - centre[1]);
      const at = ([d, out]: [number, number]) => [centre[0] + (r + out) * Math.cos(a0 + d * DEG), centre[1] + (r + out) * Math.sin(a0 + d * DEG)];
      t.down(k);
      for (const step of steps) t.move(at(step));
      t.up(at(steps.at(-1)!));
    };
    turn([[30, 0], [60, 0], [90, 0]]);
    close(t.calls.commit.at(-1)![1], { rotation: 90, w: 450, h: 225 });
    const lives = t.calls.live.length;
    turn([[0, 6], [-45, 6], [-90, 6]]);
    // A turn that has not turned yet shows exactly what was there, unstrained.
    const [, first, info] = t.calls.live[lives];
    close(first, { rotation: 90, w: 450, h: 225 });
    expect(info.pushed).toBe(false);
    close(t.calls.commit.at(-1)![1], { rotation: 0, w: 900, h: 450 });
  });

  it("forgets it when the host gives the piece another size", () => {
    const t = setup({ selectedId: "a", pieces: [BIG] });
    for (let i = 0; i < 6; i++) t.key("]", { shiftKey: true });
    t.placer.update({ pieces: [{ ...BIG, w: 300, h: 150, rotation: 90 }] });
    for (let i = 0; i < 6; i++) t.key("[", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: 0, w: 300, h: 150 });
  });

  it("forgets it on a resize: the next turns size from what shows", () => {
    const t = setup({ selectedId: "a", pieces: [BIG] });
    for (let i = 0; i < 6; i++) t.key("]", { shiftKey: true });
    t.key("-");
    for (let i = 0; i < 6; i++) t.key("[", { shiftKey: true });
    close(t.calls.commit.at(-1)![1], { rotation: 0, w: 450 / 1.05, h: 225 / 1.05 });
  });
});

// ---- The real No. 7 surface under a real perspective camera ---------------------------
const real = createSurface(SURFACE);
const ORBIT_CENTRE = [0, 0.03, -0.035];

/**
 * A pinhole camera orbiting the hat (model-viewer's frame, metres), as the 3x4
 * P measureProjection solves for: screen CSS px, y down, w the depth. The same
 * camera as three.js's PerspectiveCamera(fov, width / height) looking at the
 * orbit centre, written out so this file needs no three.
 */
function orbitCamera(thetaDeg: number, phiDeg: number, radius: number, { fov = 30, width = 390, height = 640 } = {}) {
  const th = thetaDeg * DEG;
  const ph = phiDeg * DEG;
  const c = ORBIT_CENTRE;
  const eye = [c[0] + radius * Math.sin(ph) * Math.sin(th), c[1] + radius * Math.cos(ph), c[2] + radius * Math.sin(ph) * Math.cos(th)];
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(v[0], v[1], v[2]));
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = unit([c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]]);
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const k = height / 2 / Math.tan((fov * DEG) / 2);
  const rows = [r.map((v, i) => k * v + (width / 2) * f[i]), u.map((v, i) => -k * v + (height / 2) * f[i]), f];
  return rows.flatMap((row) => [...row, -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2])]);
}

describe("createPlacer on the real No. 7 surface", () => {
  it("drags steadily past the silhouette, where the surface's own extrapolation runs off", () => {
    real.setCamera(orbitCamera(-40, 60, 0.45));
    const t = setup({ surface: real, pieces: [{ ...A, cx: 790, cy: 300 }], selectedId: "a", snapCentre: false });
    let p = real.dieToScreen("front", 790, 300)!;
    t.down(p, 1, "touch");
    let last: Pose | null = null;
    let off = 0;
    for (let i = 0; i < 60; i++) {
      p = [p[0] + 2, p[1] - 2];
      t.move(p, 1, "touch");
      if (!real.screenToDie("front", p[0], p[1], { extrapolate: false })) off++;
      const live = t.calls.live.at(-1)?.[1];
      // The fabric curves away: up and right on screen is right and DOWN in the die, steadily, never back.
      if (live && last) {
        expect(live.cx).toBeGreaterThanOrEqual(last.cx - 1e-6);
        expect(live.cy).toBeGreaterThanOrEqual(last.cy - 1e-6);
      }
      if (live) last = live;
    }
    expect(off).toBeGreaterThan(40);
    t.up(p, 1, "touch");
    expect(t.calls.commit).toHaveLength(1);
    close(t.calls.commit[0][1], { cx: 840, cy: 440, w: 200, h: 100 });
    real.setCamera(null);
  });

  it("pans a pinch 1:1 with the fingers' midpoint on screen, both fingers off the hat", () => {
    real.setCamera(orbitCamera(0, 76, 0.6));
    const t = setup({ surface: real, selectedId: "a", snapCentre: false });
    const c0 = real.dieToScreen("front", 490, 265)!;
    let a = [150, 600];
    let b = [250, 600];
    expect(real.screenToDie("front", 200, 600, { extrapolate: false })).toBeNull();
    t.down(a, 1, "touch");
    t.down(b, 2, "touch");
    for (let i = 1; i <= 10; i++) {
      a = [a[0] - 3, a[1] - 3];
      b = [b[0] - 3, b[1] - 3];
      t.move(a, 1, "touch");
      t.move(b, 2, "touch");
      const live = t.calls.live.at(-1)![1];
      const s = real.dieToScreen("front", live.cx, live.cy)!;
      expect(Math.abs(s[0] - c0[0] + 3 * i)).toBeLessThan(0.5);
      expect(Math.abs(s[1] - c0[1] + 3 * i)).toBeLessThan(0.5);
    }
    real.setCamera(null);
  });

  it("never takes a piece on a face turned away, and breaks the outlines there", () => {
    real.setCamera(orbitCamera(70, 76, 0.6));
    const hidden = { id: "h", cx: 110, cy: 265, w: 140, h: 100, rotation: 0 };
    const t = setup({ surface: real, pieces: [hidden] });
    const at = real.dieToScreen("front", 110, 265)!;
    // The fabric the camera sees there is another part of the front altogether.
    const under = real.screenToDie("front", at[0], at[1], { extrapolate: false })!;
    expect(Math.hypot(under.x - 110, under.y - 265)).toBeGreaterThan(200);
    t.down(at, 1, "touch");
    t.move([at[0] + 20, at[1]], 1, "touch");
    t.up([at[0] + 20, at[1]], 1, "touch");
    expect(t.calls.select).toEqual([]);
    expect(t.calls.orbit.length).toBeGreaterThan(0);
    t.placer.update({ selectedId: "h" });
    expect(partOf(t, "piece").children[1].attrs.d).toBe("");
    const ad = partOf(t, "area").children[1].attrs.d;
    expect(ad.endsWith("Z")).toBe(false);
    real.setCamera(null);
  });
});

// ---- A polygon area: the two front panels as one, with eyelet keep-outs ------------------
type Pt = [number, number];
const ring = (cx: number, cy: number, r: number, n = 24): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy - r * Math.sin((2 * Math.PI * i) / n)]);
/** The crown-to-bill crease along the bottom (sagging), the button skirt at the top; the centre seam at x 750. */
function frontPanels() {
  const bottom: Pt[] = [];
  for (let i = 0; i <= 40; i++) bottom.push([100 + 1300 * (i / 40), 800 + 40 * Math.sin(Math.PI * (i / 40))]);
  return { outline: [...bottom, [1300, 400], [800, 100], [700, 100], [200, 400]] as Pt[], holes: [ring(450, 380, 40), ring(1050, 380, 40)] };
}

describe("createPlacer on a polygon area", () => {
  const PANELS = frontPanels();
  const P = { ...A, cx: 500, cy: 650 };
  const lim = { area: PANELS, cap: FRONT_CAP };

  it("draws the area's outline and each hole, every 2 mm, all closed", () => {
    const t = setup({ area: PANELS, pieces: [P], selectedId: "a" });
    const d = partOf(t, "area").children[1].attrs.d;
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d.match(/Z/g)).toHaveLength(3);
    // the outline alone is ~3700 die px round: at 2 mm (15.7 px) that is well over 200 points
    expect(d.split("L").length).toBeGreaterThan(250);
    expect(partOf(t, "area").style.opacity).toBe("0.35");
  });

  it("stops a drag at the bottom edge and slides along it, committing a pose inside the outline", () => {
    const t = setup({ area: PANELS, pieces: [P], snapCentre: false });
    const c = scr(500, 650);
    t.down(c);
    // down past the crease, and on to the right
    for (let i = 1; i <= 10; i++) t.move([c[0] + 3 * i, c[1] + 20 * i]);
    const [, live, info] = t.calls.live.at(-1)!;
    expect(info.pushed).toBe(true);
    t.up([c[0] + 30, c[1] + 200]);
    expect(t.calls.commit).toHaveLength(1);
    const pose = t.calls.commit[0][1];
    expect(poseValid(pose, lim, 1e-6)).toBe(true);
    // on the edge: a pixel lower does not fit; and it followed the finger right (60 die px), give or take the slope
    expect(poseValid({ ...pose, cy: pose.cy + 1 }, lim, 1e-6)).toBe(false);
    expect(pose.cx).toBeGreaterThan(540);
    expect(pose.cx).toBeLessThan(600);
    // shown past it, by less than the 24 px band on screen
    expect(Math.hypot(live.cx - pose.cx, live.cy - pose.cy) / K).toBeLessThan(24);
    expect(t.calls.note).toEqual(["The front's logo area ends here."]);
  });

  it("keeps a drag off an eyelet's keep-out, never hops it, and follows the finger round it", () => {
    const t = setup({ area: PANELS, pieces: [{ ...A, cx: 300, cy: 380, w: 80, h: 40 }], snapCentre: false });
    const c = scr(300, 380);
    t.down(c);
    // right, straight at the eyelet (450, 380), the finger stopping over it: the piece stops at its keep-out
    for (let i = 1; i <= 15; i++) t.move([c[0] + 5 * i, c[1]]);
    t.up([c[0] + 75, c[1]]);
    const pose = t.calls.commit[0][1];
    expect(poseValid(pose, lim, 1e-6)).toBe(true);
    expect(pose.cx + pose.w / 2).toBeCloseTo(410, 3); // the keep-out's leftmost point
    expect(pose.cy).toBeCloseTo(380, 6);
    // on through it to where the logo would fit on the far side (600, 380): still held on the near side
    const u = setup({ area: PANELS, pieces: [{ ...A, cx: 300, cy: 380, w: 80, h: 40 }], snapCentre: false });
    u.down(c);
    u.move([c[0] + 50, c[1]]);
    u.move([c[0] + 150, c[1]]);
    expect(poseValid({ ...A, cx: 600, cy: 380, w: 80, h: 40 }, lim, 1e-6)).toBe(true);
    u.up([c[0] + 150, c[1]]);
    expect(u.calls.commit).toHaveLength(1);
    const held = u.calls.commit[0][1];
    expect(poseValid(held, lim, 1e-6)).toBe(true);
    expect(held.cx + held.w / 2).toBeCloseTo(410, 3);
    // round it, below the eyelet, then up the far side: where the finger is
    const v = setup({ area: PANELS, pieces: [{ ...A, cx: 300, cy: 380, w: 80, h: 40 }], snapCentre: false });
    v.down(c);
    for (const [dx, dy] of [[50, 0], [75, 0], [75, 50], [150, 50], [150, 0]]) v.move([c[0] + dx, c[1] + dy]);
    v.up([c[0] + 150, c[1]]);
    expect(v.calls.commit).toHaveLength(1);
    close(v.calls.commit[0][1], { cx: 600, cy: 380 });
  });

  it("snaps a dragged centre to the seam's x only, and draws the guide down the seam", () => {
    const t = setup({ area: PANELS, pieces: [{ ...A, cx: 700, cy: 600 }] });
    const c = scr(700, 600);
    t.down(c);
    // to (752, 472): 2 die px off the seam and 2 off the bounds' middle height
    t.move(scr(752, 472));
    close(t.calls.live.at(-1)![1], { cx: 750, cy: 472 });
    expect(t.calls.snap).toBe(1);
    const guides = partOf(t, "guides");
    expect(guides.style.display).toBe("");
    expect(guides.children[0].style.display).toBe("");
    expect(guides.children[0].attrs.d.length).toBeGreaterThan(20);
    expect(guides.children[1].style.display).toBe("none");
    t.up(scr(752, 472));
    close(t.calls.commit[0][1], { cx: 750, cy: 472 });
    // snapX moves the line, and false takes it away
    const u = setup({ area: PANELS, pieces: [{ ...A, cx: 700, cy: 600 }], snapX: 640 });
    u.down(c);
    u.move(scr(645, 600));
    u.up(scr(645, 600));
    close(u.calls.commit[0][1], { cx: 640 });
    const v = setup({ area: PANELS, pieces: [{ ...A, cx: 700, cy: 600 }], snapX: false });
    v.down(c);
    v.move(scr(752, 600));
    v.up(scr(752, 600));
    close(v.calls.commit[0][1], { cx: 752 });
  });

  it("nudges stop at the edge: steps down to it, then no step and the note", () => {
    const t = setup({ area: PANELS, pieces: [P], selectedId: "a" });
    for (let i = 0; i < 12; i++) t.key("ArrowDown", { shiftKey: true });
    const commits = t.calls.commit.length;
    const pose = t.calls.commit.at(-1)![1];
    expect(poseValid(pose, lim, 1e-6)).toBe(true);
    expect(poseValid({ ...pose, cy: pose.cy + 1 }, lim, 1e-6)).toBe(false);
    expect(pose.cx).toBeCloseTo(500, 3);
    t.placer.update({ pieces: [{ ...P, ...pose }] });
    t.calls.note.length = 0;
    t.key("ArrowDown");
    expect(t.calls.commit).toHaveLength(commits);
    expect(t.calls.note).toEqual(["The front's logo area ends here."]);
  });

  it("nudges Left and Right along the sloping crease from where it sits, low beside the seam", () => {
    // on the crease left of the seam, where it rises to the left (and on the right half, to the right)
    for (const [x, key, sign] of [[450, "ArrowLeft", -1], [1050, "ArrowRight", 1]] as const) {
      const t = setup({ area: PANELS, pieces: [{ ...P, cx: x, cy: 900 }], selectedId: "a" });
      for (let i = 0; i < 12; i++) t.key("ArrowDown", { shiftKey: true });
      let at = t.calls.commit.at(-1)![1];
      t.placer.update({ pieces: [{ ...P, ...at }] });
      for (let i = 0; i < 5; i++) {
        const n = t.calls.commit.length;
        t.key(key);
        expect(t.calls.commit, `${key} step ${i}`).toHaveLength(n + 1);
        const next = t.calls.commit.at(-1)![1];
        expect(poseValid(next, lim, 1e-6)).toBe(true);
        // 0.05 in (10 die px) asked: nearly all of it the key's way, rising a little
        expect(sign * (next.cx - at.cx)).toBeGreaterThan(9);
        expect(at.cy - next.cy).toBeGreaterThanOrEqual(-1e-6);
        expect(at.cy - next.cy).toBeLessThan(3);
        t.placer.update({ pieces: [{ ...P, ...next }] });
        at = next;
      }
    }
  });

  it("grows a piece by keys up to what fits round it, pushed in off the edge, never past the cap", () => {
    const t = setup({ area: PANELS, pieces: [{ ...P, cy: 760, w: 300, h: 60 }], selectedId: "a" });
    for (let i = 0; i < 40; i++) t.key("=");
    const pose = t.calls.commit.at(-1)![1];
    expect(poseValid(pose, lim, 1e-6)).toBe(true);
    const e = rotatedSize(pose.w, pose.h, pose.rotation);
    expect(e.w).toBeCloseTo(900, 6);
    expect(pose.w / pose.h).toBeCloseTo(5, 9);
  });
});
