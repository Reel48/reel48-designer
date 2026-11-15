// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/coozie-die.test.js (origin/main d78d90ee); imports point into this package.
import { describe, it, expect } from "vitest";
import {
  COOZIE_SIZES,
  dieGeometry,
  resolveSize,
  traceDie,
} from "../../src/core/coozie-config.js";
// Dropped: the "design state" suite (designReducer, initialDesignState and toDesignDescription live in the storefront's lib/coozie-design.ts).

/**
 * The die numbers are measured off real production art, not chosen — see the
 * header of coozie-config.js. These assertions exist so a future edit to the
 * geometry has to be deliberate: getting them wrong means cutting foam to the
 * wrong shape, which no test downstream of here would catch.
 */

const IN = (geom, px) => px / geom.pxPerInch;

describe("die geometry", () => {
  it("reproduces the measured standard die in inches", () => {
    const g = dieGeometry("standard");
    expect(IN(g, g.x1 - g.x0)).toBeCloseTo(4.2222, 3); // panel width
    expect(IN(g, g.y1 - g.y0)).toBeCloseTo(4.0278, 3); // panel height
    expect(IN(g, g.y3 - g.y2)).toBeCloseTo(4.0278, 3);
    expect(IN(g, 2 * g.r)).toBeCloseTo(2.875, 3); // base disc
    expect(IN(g, g.y2 - g.y1)).toBeCloseTo(2.2361, 3); // gap between panels
    expect(IN(g, g.y3 - g.y0)).toBeCloseTo(10.2917, 3); // total flat height
  });

  it("gives slim the same physical pixel scale as standard", () => {
    // A design switched between dies keeps its proportions only if a stage
    // pixel means the same thing on both.
    expect(dieGeometry("slim").pxPerInch).toBeCloseTo(
      dieGeometry("standard").pxPerInch,
      1,
    );
  });

  it("centres both dies in their stage and puts the disc between the panels", () => {
    for (const size of Object.values(COOZIE_SIZES)) {
      const g = dieGeometry(size);
      expect(g.cx).toBeCloseTo(size.stage.width / 2, 6);
      expect(g.cy).toBeCloseTo((g.y1 + g.y2) / 2, 6);
      expect(size.stage.width - g.x1).toBeCloseTo(g.x0, 6);
      expect(size.stage.height - g.y3).toBeCloseTo(g.y0, 0);
      // The disc is wider than the gap, so the panels hide its top and bottom.
      expect(2 * g.r).toBeGreaterThan(g.y2 - g.y1);
      expect(g.chord).toBeGreaterThan(0);
      expect(g.chord).toBeLessThan(g.r);
    }
  });

  it("pins the stage frames stored designs are measured against", () => {
    // Moving either frame relocates the artwork on orders already placed.
    expect(COOZIE_SIZES.standard.stage).toEqual({ width: 1000, height: 2000 });
    expect(COOZIE_SIZES.slim.stage).toEqual({ width: 875, height: 2600 });
  });

  it("sizes each disc to the can it has to fit", () => {
    // The standard disc runs 0.275" wider than a 2.60" can — ~3.5mm of neoprene
    // per side. Slim has to clear a 12 oz sleek can (2.24"), not a 250ml true
    // slim, and gets the same wall allowance.
    const WALL = 0.275;
    expect(COOZIE_SIZES.standard.die.discD - 2.6).toBeCloseTo(WALL, 3);
    expect(COOZIE_SIZES.slim.die.discD - 2.24).toBeCloseTo(WALL, 3);
  });

  it("keeps both dies on the standard die's proportions", () => {
    for (const { die } of Object.values(COOZIE_SIZES)) {
      expect(die.panelW / die.discD).toBeCloseTo(1.4686, 3);
      expect(die.gap / die.discD).toBeCloseTo(0.7778, 3);
    }
  });
});

describe("traceDie", () => {
  /** Records the path so the outline can be checked without a canvas. */
  function recorder() {
    const ops = [];
    return {
      ops,
      beginPath: () => ops.push(["begin"]),
      closePath: () => ops.push(["close"]),
      moveTo: (x, y) => ops.push(["move", x, y]),
      lineTo: (x, y) => ops.push(["line", x, y]),
      arc: (...a) => ops.push(["arc", ...a]),
    };
  }

  it("draws one closed outline with both disc arcs", () => {
    const ctx = recorder();
    traceDie(ctx, dieGeometry("standard"));
    expect(ctx.ops[0][0]).toBe("begin");
    expect(ctx.ops.at(-1)[0]).toBe("close");
    expect(ctx.ops.filter((o) => o[0] === "arc")).toHaveLength(2);
    expect(ctx.ops.filter((o) => o[0] === "move")).toHaveLength(1);
  });

  it("stays inside the stage and honours the display scale", () => {
    const g = dieGeometry("slim");
    const scale = 0.25;
    const ctx = recorder();
    traceDie(ctx, g, scale);
    const points = ctx.ops
      .filter((o) => o[0] === "move" || o[0] === "line")
      .map(([, x, y]) => [x, y]);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(COOZIE_SIZES.slim.stage.width * scale);
      expect(y).toBeLessThanOrEqual(COOZIE_SIZES.slim.stage.height * scale);
    }
    // The outline reaches both panel edges at the scaled position.
    expect(Math.min(...points.map((p) => p[0]))).toBeCloseTo(g.x0 * scale, 6);
    expect(Math.max(...points.map((p) => p[0]))).toBeCloseTo(g.x1 * scale, 6);
  });
});

describe("resolveSize", () => {
  it("ignores inherited object keys — size=constructor is the default die, not Object's constructor", () => {
    // COOZIE_SIZES is a plain object. Before the own-key check this returned
    // a function, and `.id` (undefined) reached stored design documents from
    // every handler that pinned a posted size.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(resolveSize(key).id).toBe("standard");
      expect(resolveSize({ id: key }).id).toBe("standard");
    }
  });

  it("accepts an id, a size object, or nothing at all", () => {
    expect(resolveSize("slim").id).toBe("slim");
    expect(resolveSize(COOZIE_SIZES.slim).id).toBe("slim");
    expect(resolveSize(undefined).id).toBe("standard");
    expect(resolveSize({ id: "bottle" }).id).toBe("standard");
  });
});
