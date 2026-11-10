import { describe, expect, it } from "vitest";
import {
  designReducer,
  dieGeometry,
  historyReducer,
  initialDesignState,
  patternFillScale,
  patternPlacements,
  tracePatternClip,
} from "../src/core/index.js";

function recorder() {
  const calls = [];
  return {
    calls,
    rect: (...a) => calls.push(["rect", ...a]),
    moveTo: (...a) => calls.push(["moveTo", ...a]),
    arc: (...a) => calls.push(["arc", ...a]),
    closePath: () => calls.push(["closePath"]),
  };
}

describe("patternPlacements (v1.14.0)", () => {
  for (const id of ["koozie-standard", "koozie-slim"]) {
    it(`${id}: the tile starts at the front panel and the back is drawn turned`, () => {
      const geom = dieGeometry(id);
      const front = geom.zones.find((z) => !z.flipped).bounds;
      const back = geom.zones.find((z) => z.flipped).bounds;
      const [all, turned, ...rest] = patternPlacements(geom);
      expect(rest).toEqual([]);
      expect(all).toEqual({ x: front.x0, y: front.y0, rotation: 0, clip: null });
      // Turned about the back panel, anchored at its far corner: the panel's
      // top-left once it is folded under and the sleeve stands upright.
      expect(turned.rotation).toBe(180);
      expect([turned.x, turned.y]).toEqual([back.x1, back.y1]);
      expect(turned.clip).toEqual({
        kind: "rect",
        ...back,
        exclude: { cx: geom.cx, cy: geom.cy, r: geom.r },
      });
    });
  }

  it("the back's copy lays out like the front once turned upright", () => {
    // A point (u, v) from the front panel's top-left shows the tile at (u, v);
    // the same (u, v) from the back panel's upright top-left must too.
    const geom = dieGeometry("koozie-standard");
    const [front, back] = patternPlacements(geom);
    const tileAt = (p, x, y) => {
      const dx = x - p.x;
      const dy = y - p.y;
      return p.rotation === 180 ? [-dx, -dy] : [dx, dy];
    };
    const f = geom.zones.find((z) => !z.flipped).bounds;
    const b = geom.zones.find((z) => z.flipped).bounds;
    const [u, v] = [37, 120];
    expect(tileAt(front, f.x0 + u, f.y0 + v)).toEqual([u, v]);
    // Upright, the back's top-left is the flat's bottom-right corner.
    expect(tileAt(back, b.x1 - u, b.y1 - v)).toEqual([u, v]);
  });

  it("a die with no zones keeps the old origin and draws nothing turned", () => {
    expect(patternPlacements({ zones: [] })).toEqual([{ x: 0, y: 0, rotation: 0, clip: null }]);
    expect(patternPlacements(null)).toEqual([{ x: 0, y: 0, rotation: 0, clip: null }]);
  });

  it("the clip is the panel rect with the disc wound against it", () => {
    const ctx = recorder();
    tracePatternClip(ctx, { x0: 10, y0: 20, x1: 30, y1: 60, exclude: { cx: 20, cy: 20, r: 5 } }, 2);
    expect(ctx.calls).toEqual([
      ["rect", 20, 40, 40, 80],
      ["moveTo", 50, 40],
      ["arc", 40, 40, 10, 0, 2 * Math.PI, true],
      ["closePath"],
    ]);
  });
});

describe("patternFillScale (v1.14.0)", () => {
  it("draws a dense tile at its true size", () => {
    expect(patternFillScale(0.5, 3)).toBeCloseTo(0.5 / 3);
    expect(patternFillScale(0.5)).toBe(0.5);
    expect(patternFillScale(0.5, 0)).toBe(0.5);
    expect(patternFillScale(0.5, Number.NaN)).toBe(0.5);
  });
});

describe("SET_PATTERN (v1.14.0)", () => {
  it("the same pattern again changes nothing and adds no undo step", () => {
    const s = designReducer(initialDesignState("standard"), { type: "SET_PATTERN", patternId: "duck-camo-slate" });
    expect(s.patternId).toBe("duck-camo-slate");
    expect(designReducer(s, { type: "SET_PATTERN", patternId: "duck-camo-slate" })).toBe(s);
    const history = { past: [], present: s, future: [], lastCoalesceKey: null };
    expect(historyReducer(history, { type: "SET_PATTERN", patternId: "duck-camo-slate" })).toBe(history);
  });

  it("clearing takes null or a missing id", () => {
    const s = designReducer(initialDesignState("standard"), { type: "SET_PATTERN", patternId: "gingham-red" });
    expect(designReducer(s, { type: "SET_PATTERN", patternId: null }).patternId).toBeNull();
    expect(designReducer(s, { type: "SET_PATTERN" }).patternId).toBeNull();
  });
});
