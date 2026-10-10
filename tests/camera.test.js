import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIES, dieGeometry } from "../src/core/dies.js";
import {
  IDENTITY_CAMERA,
  cameraFor,
  cameraForResize,
  cameraPoint,
  containDisplayWidth,
  focusRects,
} from "../src/core/camera.js";
import * as core from "../src/core/index.js";

// Captured from src/core/camera.js when v1.5.0 added it, for the two phone
// viewports the storefront's step form was designed against (390x420 and
// 375x330 — the canvas box on the top half of a phone) and the four views it
// uses: overview, front, base, and back turned 180°.
//
// Unlike the die geometry golden, a change here relocates nothing stored: the
// camera is a way of LOOKING at the stage frame, and the proof resets it. What
// it pins is that the artwork, the die-line and the guides — three layers that
// each get these numbers — keep agreeing with what the storefront tested. If a
// change is deliberate, recapture it and say why in the commit.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./camera.golden.json", import.meta.url)), "utf8"),
);

const VIEWS = { overview: null, front: ["front", 0], base: ["base", 0], back180: ["back", 180] };

// Display coords of a native rect, as the stage draws it.
function toDisplay(rect, native, displayW) {
  const k = displayW / native.width;
  return { x0: rect.x0 * k, y0: rect.y0 * k, x1: rect.x1 * k, y1: rect.y1 * k };
}

function corners({ x0, y0, x1, y1 }) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

// Konva's own Node._getTransform order, written out independently of
// cameraPoint: translate(x, y) · rotate · scale · translate(-offset), as a 2x3
// matrix [a b c d e f] mapping (x, y) → (a x + c y + e, b x + d y + f).
function konvaMatrix(cam) {
  let m = [1, 0, 0, 1, 0, 0];
  const translate = (tx, ty) => {
    m = [m[0], m[1], m[2], m[3], m[0] * tx + m[2] * ty + m[4], m[1] * tx + m[3] * ty + m[5]];
  };
  const rotate = (rad) => {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[0] * -s + m[2] * c, m[1] * -s + m[3] * c, m[4], m[5]];
  };
  const scale = (sx, sy) => {
    m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
  };
  translate(cam.x, cam.y);
  rotate((cam.rotation * Math.PI) / 180);
  scale(cam.scaleX, cam.scaleY);
  translate(-cam.offsetX, -cam.offsetY);
  return (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
}

describe("camera is exported from core", () => {
  it("ships the new functions without dragging a dependency in", () => {
    for (const k of ["focusRects", "cameraFor", "cameraForResize", "cameraPoint", "containDisplayWidth"]) {
      expect(typeof core[k], k).toBe("function");
    }
    expect(core.IDENTITY_CAMERA).toEqual(IDENTITY_CAMERA);
  });
});

describe("camera golden: unchanged for the viewports the storefront tested", () => {
  for (const [dieId, expected] of Object.entries(GOLDEN)) {
    const native = DIES[dieId].stage;

    it(`${dieId}: focus rects`, () => {
      expect(native).toEqual(expected.native);
      expect(focusRects(dieGeometry(dieId))).toEqual(expected.focusRects);
    });

    for (const [key, vp] of Object.entries(expected.viewports)) {
      it(`${dieId} @ ${key}: display width and every view's camera`, () => {
        const displayW = containDisplayWidth(vp.viewport, native);
        // Exact, like the die golden: these numbers go to three layers that
        // must agree, and "close" is how a die-line ends up a pixel off.
        expect(displayW).toBe(vp.displayW);
        const rects = focusRects(dieGeometry(dieId));
        for (const [name, v] of Object.entries(VIEWS)) {
          const cam = cameraFor({
            rect: v ? rects[v[0]] : null,
            native,
            displayW,
            viewport: vp.viewport,
            rotate: v ? v[1] : 0,
          });
          expect(cam, name).toEqual(vp.cameras[name]);
        }
      });
    }
  }
});

describe("focusRects", () => {
  it("gives a koozie exactly front, back and base", () => {
    const geom = dieGeometry("koozie-standard");
    const rects = focusRects(geom);
    expect(Object.keys(rects)).toEqual(["front", "back", "base"]);
    // Faces come straight from the zones, so the camera frames what the
    // upside-down warning and the snap guides already call a panel.
    for (const z of geom.zones) {
      expect(rects[z.id]).toEqual({ x0: z.bounds.x0, y0: z.bounds.y0, x1: z.bounds.x1, y1: z.bounds.y1 });
    }
    // The base is the whole disc, hidden edges included.
    expect(rects.base).toEqual({
      x0: geom.cx - geom.r,
      y0: geom.cy - geom.r,
      x1: geom.cx + geom.r,
      y1: geom.cy + geom.r,
    });
  });

  it("derives from zones, so a die with one zone and no disc gets one rect", () => {
    // What a hat front will look like: no fold, no base.
    const hat = { zones: [{ id: "front", bounds: { x0: 10, x1: 90, y0: 20, y1: 60 } }] };
    expect(focusRects(hat)).toEqual({ front: { x0: 10, y0: 20, x1: 90, y1: 60 } });
    expect(focusRects({})).toEqual({});
  });
});

describe("containDisplayWidth", () => {
  it("fits the die inside the box on whichever axis is tighter", () => {
    const native = DIES["koozie-standard"].stage; // 1:2
    expect(containDisplayWidth({ width: 390, height: 420 }, native)).toBe(210); // height-bound
    expect(containDisplayWidth({ width: 100, height: 420 }, native)).toBe(100); // width-bound
    expect(containDisplayWidth({ width: 0, height: 0 }, native)).toBe(0);
  });
});

describe("cameraFor", () => {
  const cases = [];
  for (const dieId of ["koozie-standard", "koozie-slim"]) {
    for (const viewport of [{ width: 390, height: 420 }, { width: 375, height: 330 }, { width: 320, height: 568 }]) {
      cases.push({ dieId, viewport });
    }
  }

  for (const { dieId, viewport } of cases) {
    const native = DIES[dieId].stage;
    const displayW = containDisplayWidth(viewport, native);
    const displayH = displayW * (native.height / native.width);
    const rects = focusRects(dieGeometry(dieId));
    const label = `${dieId} @ ${viewport.width}x${viewport.height}`;

    it(`${label}: overview is the layout the stage already drew`, () => {
      const cam = cameraFor({ rect: null, native, displayW, viewport });
      // Contain fit means scale 1 (up to float dust) and the die centred.
      expect(cam.scaleX).toBeCloseTo(1, 12);
      expect(cam.scaleY).toBe(cam.scaleX);
      expect(cam.rotation).toBe(0);
      const p = konvaMatrix(cam);
      const tl = p({ x: 0, y: 0 });
      const br = p({ x: displayW, y: displayH });
      // Fits inside the viewport...
      expect(tl.x).toBeGreaterThanOrEqual(-1e-9);
      expect(tl.y).toBeGreaterThanOrEqual(-1e-9);
      expect(br.x).toBeLessThanOrEqual(viewport.width + 1e-9);
      expect(br.y).toBeLessThanOrEqual(viewport.height + 1e-9);
      // ...centred...
      expect((tl.x + br.x) / 2).toBeCloseTo(viewport.width / 2, 9);
      expect((tl.y + br.y) / 2).toBeCloseTo(viewport.height / 2, 9);
      // ...and touching the box on the tight axis.
      expect(Math.max(br.x - tl.x - viewport.width, br.y - tl.y - viewport.height)).toBeCloseTo(0, 9);
    });

    for (const [face, rotate] of [["front", 0], ["base", 0], ["back", 180]]) {
      it(`${label}: ${face}${rotate ? " (turned 180°)" : ""} fills the box inside its margin`, () => {
        const margin = 0.06;
        const cam = cameraFor({ rect: rects[face], native, displayW, viewport, rotate });
        const p = konvaMatrix(cam);
        const r = toDisplay(rects[face], native, displayW);
        // The face's centre is the viewport's centre.
        const c = p({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
        expect(c.x).toBeCloseTo(viewport.width / 2, 9);
        expect(c.y).toBeCloseTo(viewport.height / 2, 9);
        // Every corner is inside the margin box, and the fit is tight on one axis.
        const pts = corners(r).map(p);
        const xs = pts.map((q) => q.x);
        const ys = pts.map((q) => q.y);
        const mx = viewport.width * margin;
        const my = viewport.height * margin;
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(mx - 1e-9);
        expect(Math.max(...xs)).toBeLessThanOrEqual(viewport.width - mx + 1e-9);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(my - 1e-9);
        expect(Math.max(...ys)).toBeLessThanOrEqual(viewport.height - my + 1e-9);
        const slack = Math.min(Math.min(...xs) - mx, Math.min(...ys) - my);
        expect(slack).toBeCloseTo(0, 9);
        expect(cam.rotation).toBe(rotate);
      });
    }

    it(`${label}: the back view is the panel turned over`, () => {
      // The back panel prints upside down unless its artwork is rotated ~180
      // (the zone's `flipped`). Turned over, its top-left corner shows bottom-
      // right — so artwork rotated 180 on the die reads upright on screen.
      const cam = cameraFor({ rect: rects.back, native, displayW, viewport, rotate: 180 });
      const r = toDisplay(rects.back, native, displayW);
      const tl = konvaMatrix(cam)({ x: r.x0, y: r.y0 });
      expect(tl.x).toBeGreaterThan(viewport.width / 2);
      expect(tl.y).toBeGreaterThan(viewport.height / 2);
    });
  }

  it("ignores rotate in overview: the whole die is only ever shown as cut", () => {
    const native = DIES["koozie-standard"].stage;
    const cam = cameraFor({ rect: null, native, displayW: 210, viewport: { width: 390, height: 420 }, rotate: 180 });
    expect(cam.rotation).toBe(0);
  });

  it("returns identity, not NaN, before anything is measured", () => {
    const native = DIES["koozie-standard"].stage;
    const rect = focusRects(dieGeometry("koozie-standard")).front;
    expect(cameraFor({ rect, native, displayW: 0, viewport: { width: 390, height: 420 } })).toEqual(IDENTITY_CAMERA);
    expect(cameraFor({ rect, native, displayW: 210, viewport: { width: 0, height: 0 } })).toEqual(IDENTITY_CAMERA);
  });

  it("honours a custom margin", () => {
    const native = DIES["koozie-standard"].stage;
    const rect = focusRects(dieGeometry("koozie-standard")).front;
    const viewport = { width: 390, height: 420 };
    const tight = cameraFor({ rect, native, displayW: 210, viewport, margin: 0 });
    const loose = cameraFor({ rect, native, displayW: 210, viewport, margin: 0.2 });
    expect(tight.scaleX).toBeGreaterThan(loose.scaleX);
    // 168 display px of panel across 390 px of viewport with no margin.
    expect(tight.scaleX).toBeCloseTo(390 / 168, 12);
  });
});

describe("cameraPoint", () => {
  it("is Konva's transform order", () => {
    const cams = [
      IDENTITY_CAMERA,
      { x: 195, y: 210, offsetX: 105, offsetY: 85.4, scaleX: 2.04, scaleY: 2.04, rotation: 0 },
      { x: 195, y: 210, offsetX: 105, offsetY: 334.6, scaleX: 2.04, scaleY: 2.04, rotation: 180 },
      { x: 12, y: -7, offsetX: 3, offsetY: 4, scaleX: 1.5, scaleY: 0.5, rotation: 37 },
    ];
    for (const cam of cams) {
      const ref = konvaMatrix(cam);
      for (const pt of [{ x: 0, y: 0 }, { x: 105, y: 85.4 }, { x: -20, y: 300 }]) {
        const got = cameraPoint(cam, pt);
        const want = ref(pt);
        expect(got.x).toBeCloseTo(want.x, 9);
        expect(got.y).toBeCloseTo(want.y, 9);
      }
    }
  });

  it("leaves a point where it is under the identity camera", () => {
    expect(cameraPoint(IDENTITY_CAMERA, { x: 42, y: 7 })).toEqual({ x: 42, y: 7 });
  });
});

describe("cameraFor with an inset (host overlays over the stage)", () => {
  const inset = { top: 56, right: 8, bottom: 64, left: 8 };
  const viewport = { width: 390, height: 420 };
  const safe = { x0: inset.left, y0: inset.top, x1: viewport.width - inset.right, y1: viewport.height - inset.bottom };

  for (const id of ["koozie-standard", "koozie-slim"]) {
    const die = DIES[id];
    const geom = dieGeometry(die);
    const native = die.stage;
    const displayW = containDisplayWidth(viewport, native);
    const displayH = displayW * (native.height / native.width);
    const rects = focusRects(geom);

    it(`${id}: overview and every face land inside the safe box, centred in it`, () => {
      const cases = [
        [null, 0, { x0: 0, y0: 0, x1: displayW, y1: displayH }],
        ["front", 0],
        ["base", 0],
        ["back", 180],
      ];
      for (const [focus, rotate, explicit] of cases) {
        const rect = focus ? rects[focus] : null;
        const cam = cameraFor({ rect, native, displayW, viewport, rotate, inset });
        const target = explicit ?? toDisplay(rect, native, displayW);
        const pts = corners(target).map(konvaMatrix(cam));
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(safe.x0 - 1e-6);
          expect(p.x).toBeLessThanOrEqual(safe.x1 + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(safe.y0 - 1e-6);
          expect(p.y).toBeLessThanOrEqual(safe.y1 + 1e-6);
        }
        expect(cam.x).toBeCloseTo((safe.x0 + safe.x1) / 2, 9);
        expect(cam.y).toBeCloseTo((safe.y0 + safe.y1) / 2, 9);
      }
    });
  }

  it("no inset (or an empty one) is exactly the v1.5.0 answer", () => {
    const die = DIES["koozie-standard"];
    const native = die.stage;
    const displayW = containDisplayWidth(viewport, native);
    const rect = focusRects(dieGeometry(die)).front;
    const base = cameraFor({ rect, native, displayW, viewport });
    expect(cameraFor({ rect, native, displayW, viewport, inset: {} })).toEqual(base);
    expect(cameraFor({ rect, native, displayW, viewport, inset: { top: 0, right: 0, bottom: 0, left: 0 } })).toEqual(base);
  });

  it("an inset bigger than the stage falls back to the whole viewport", () => {
    const die = DIES["koozie-standard"];
    const native = die.stage;
    const tiny = { width: 100, height: 100 };
    const displayW = containDisplayWidth(tiny, native);
    const cam = cameraFor({ rect: null, native, displayW, viewport: tiny, inset: { top: 80, bottom: 80 } });
    expect(cam.scaleX).toBeGreaterThan(0);
    expect(cam.y).toBe(50);
  });
});

describe("cameraForResize", () => {
  // Every node's display position is its fraction times the display width, so
  // the resized camera must put each fraction where the old camera put it.
  const native = DIES["koozie-standard"].stage;
  const geom = dieGeometry(DIES["koozie-standard"]);
  const cases = [
    { name: "overview, box taller", rect: null, from: { width: 390, height: 618 }, to: { width: 390, height: 521 } },
    { name: "back, turned, box shorter", rect: focusRects(geom).back, rotate: 180, from: { width: 390, height: 520 }, to: { width: 390, height: 640 } },
  ];
  for (const c of cases) {
    it(`keeps the die where it was on screen: ${c.name}`, () => {
      const fromW = containDisplayWidth(c.from, native);
      const toW = containDisplayWidth(c.to, native);
      const old = cameraFor({ rect: c.rect, native, displayW: fromW, viewport: c.from, rotate: c.rotate ?? 0 });
      const start = cameraForResize(old, fromW, toW);
      for (const [fx, fy] of [[0, 0], [1, 1], [0.25, 0.8], [0.5, 0.5]]) {
        const aspect = native.height / native.width;
        const before = cameraPoint(old, { x: fx * fromW, y: fy * fromW * aspect });
        const after = cameraPoint(start, { x: fx * toW, y: fy * toW * aspect });
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
      expect(start.rotation).toBe(old.rotation);
    });
  }

  it("is the same camera when the width did not change or is unknown", () => {
    const cam = { x: 1, y: 2, offsetX: 3, offsetY: 4, scaleX: 5, scaleY: 5, rotation: 180 };
    expect(cameraForResize(cam, 300, 300)).toEqual(cam);
    expect(cameraForResize(cam, 0, 300)).toEqual(cam);
    expect(cameraForResize(cam, 300, 0)).toEqual(cam);
    expect(cameraForResize(cam, 300, 300)).not.toBe(cam);
  });
});
