import { describe, it, expect } from "vitest";
import { DIES, dieGeometry } from "../src/core/dies.js";
import { confineCenter, faceAt, faceRegions, fitScale, rubberBand, scaleRegion } from "../src/core/confine.js";
import * as core from "../src/core/index.js";

const rect = { kind: "rect", x0: 0, y0: 0, x1: 100, y1: 50 };
const disc = { kind: "circle", cx: 0, cy: 0, r: 10 };

describe("faceRegions", () => {
  for (const id of ["koozie-standard", "koozie-slim"]) {
    const geom = dieGeometry(DIES[id]);
    it(`${id}: the panels are the die's zones, the base its disc`, () => {
      const r = faceRegions(geom);
      for (const side of ["front", "back"]) {
        const zone = geom.zones.find((z) => z.id === side).bounds;
        expect(r[side]).toEqual({
          kind: "rect", x0: zone.x0, y0: zone.y0, x1: zone.x1, y1: zone.y1,
          exclude: { cx: geom.cx, cy: geom.cy, r: geom.r },
        });
      }
      expect(r.base).toEqual({ kind: "circle", cx: geom.cx, cy: geom.cy, r: geom.r });
    });

    it(`${id}: faceAt reads each region's centre as that side`, () => {
      const r = faceRegions(geom);
      const { stage } = DIES[id];
      const at = (x, y) => faceAt(geom, stage, { x: x / stage.width, y: y / stage.height });
      expect(at((r.front.x0 + r.front.x1) / 2, (r.front.y0 + r.front.y1) / 2)).toBe("front");
      expect(at((r.back.x0 + r.back.x1) / 2, (r.back.y0 + r.back.y1) / 2)).toBe("back");
      expect(at(r.base.cx, r.base.cy)).toBe("base");
      // Beside the disc, just above and just below the fold.
      const fold = geom.bottomPanelStartY * stage.height;
      expect(at(r.front.x0 + 5, fold - 1)).toBe("front");
      expect(at(r.front.x0 + 5, fold + 1)).toBe("back");
    });
  }

  it(`${"koozie-standard"} and slim: a box settled at a panel's edge stays that panel's`, () => {
    for (const id of ["koozie-standard", "koozie-slim"]) {
      const geom = dieGeometry(DIES[id]);
      const { stage } = DIES[id];
      const r = faceRegions(geom);
      // A small box pushed straight down the centre line past the front's
      // bottom edge, and up past the back's top edge: both into the disc.
      for (const [side, y] of [["front", r.front.y1 + 40], ["back", r.back.y0 - 40]]) {
        const c = confineCenter(r[side], { x: geom.cx, y }, { hx: 60, hy: 20 });
        expect(c.moved).toBe(true);
        expect(faceAt(geom, stage, { x: c.x / stage.width, y: c.y / stage.height }), `${id} ${side}`).toBe(side);
        // And the box still lies inside the panel's rect.
        expect(c.y - 20).toBeGreaterThanOrEqual(r[side].y0 - 1e-6);
        expect(c.y + 20).toBeLessThanOrEqual(r[side].y1 + 1e-6);
      }
    }
  });

  it("a die with no zones and no disc has no sides", () => {
    expect(faceRegions({ zones: [] })).toEqual({});
  });
});

describe("confineCenter", () => {
  it("leaves a box that is already inside where it is", () => {
    expect(confineCenter(rect, { x: 50, y: 25 }, { hx: 10, hy: 5 })).toEqual({ x: 50, y: 25, moved: false });
  });

  it("pulls a box back across each edge of a rect, and only on the axis it crossed", () => {
    expect(confineCenter(rect, { x: 97, y: 25 }, { hx: 10, hy: 5 })).toEqual({ x: 90, y: 25, moved: true });
    expect(confineCenter(rect, { x: 50, y: -3 }, { hx: 10, hy: 5 })).toEqual({ x: 50, y: 5, moved: true });
    expect(confineCenter(rect, { x: -20, y: 80 }, { hx: 10, hy: 5 })).toEqual({ x: 10, y: 45, moved: true });
  });

  it("centres a box too big for a rect on that axis only", () => {
    expect(confineCenter(rect, { x: 80, y: 40 }, { hx: 60, hy: 5 })).toEqual({ x: 50, y: 40, moved: true });
  });

  it("keeps a box's farthest corner inside a disc, along the line it left by", () => {
    const half = { hx: 3, hy: 4 }; // corner 5 from centre, so 5 of room
    const c = confineCenter(disc, { x: 10, y: 0 }, half);
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(0, 9);
    expect(c.moved).toBe(true);
    const d = confineCenter(disc, { x: -6, y: -8 }, half);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(5, 9);
    expect(d.x / d.y).toBeCloseTo(6 / 8, 9);
    expect(confineCenter(disc, { x: 1, y: 1 }, half)).toEqual({ x: 1, y: 1, moved: false });
  });

  it("centres a box too big for the disc", () => {
    expect(confineCenter(disc, { x: 2, y: 3 }, { hx: 9, hy: 9 })).toEqual({ x: 0, y: 0, moved: true });
  });
});

describe("fitScale", () => {
  it("is 1 for a box that fits, and the shrink that makes one fit", () => {
    expect(fitScale(rect, { hx: 10, hy: 5 })).toBe(1);
    expect(fitScale(rect, { hx: 100, hy: 5 })).toBe(0.5);
    expect(fitScale(rect, { hx: 10, hy: 50 })).toBe(0.5);
    expect(fitScale(disc, { hx: 6, hy: 8 })).toBe(1);
    expect(fitScale(disc, { hx: 12, hy: 16 })).toBeCloseTo(0.5, 9);
  });
});

describe("rubberBand", () => {
  it("follows the finger at first, never reaches the limit, and keeps the sign", () => {
    expect(rubberBand(0, 24)).toBe(0);
    expect(rubberBand(1, 24)).toBeCloseTo(0.96, 2);
    let prev = 0;
    for (const over of [1, 5, 20, 80, 400, 10000]) {
      const v = rubberBand(over, 24);
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeLessThan(24);
      prev = v;
    }
    expect(rubberBand(-30, 24)).toBe(-rubberBand(30, 24));
    expect(rubberBand(30, 0)).toBe(0);
  });
});

describe("scaleRegion", () => {
  it("scales both kinds", () => {
    expect(scaleRegion(rect, 2)).toEqual({ kind: "rect", x0: 0, y0: 0, x1: 200, y1: 100 });
    expect(scaleRegion({ ...rect, exclude: { cx: 1, cy: 2, r: 3 } }, 2).exclude).toEqual({ cx: 2, cy: 4, r: 6 });
    expect(scaleRegion({ kind: "circle", cx: 1, cy: 2, r: 3 }, 2)).toEqual({ kind: "circle", cx: 2, cy: 4, r: 6 });
  });
});

it("is exported from core", () => {
  for (const k of ["confineCenter", "faceAt", "faceRegions", "fitScale", "rubberBand", "scaleRegion"]) {
    expect(typeof core[k], k).toBe("function");
  }
});
