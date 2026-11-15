// A can cooler panel's centre keep-out (v1.16.2). The flat stage keeps a
// piece's centre off the base disc where it reaches into a panel (core
// confine.js faceRegions' `exclude`, confineCenter); the 3D editor's panel area
// (canEditDie: the rect with `centreExclude`) now keeps it there too, through
// region.js confinePose, so the 3D editor stops a piece at the disc while it is
// dragged and its commit is one the flat rule leaves where it is. Before, the
// editor let the centre into the disc and account.reel48.com's island lifted
// the piece clear after it was let go (up to about 0.16 in).
import { describe, expect, it } from "vitest";
import {
  confineCenter,
  confinePose,
  dieGeometry,
  faceAt,
  faceRegions,
  poseValid,
  resolveDie,
} from "../src/core/index.js";
import { canEditDie, canSpotLimits } from "../src/viewer/can-edit.js";

const DIES = ["koozie-standard", "koozie-slim"];
const RAD = Math.PI / 180;

/** A small deterministic generator (mulberry32), so a failure names its case. */
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

/** The turned box's half extents, as the flat stage measures a piece (its bounding box). */
function half(w, h, rotation) {
  const t = rotation * RAD;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

describe("a can cooler panel keeps a piece's centre off the base disc (v1.16.2)", () => {
  it("confines exactly as the flat stage's confineCenter does, on both panels of both dies", () => {
    for (const id of DIES) {
      const geom = dieGeometry(id);
      const regions = faceRegions(geom);
      const die = canEditDie(id);
      for (const side of ["front", "back"]) {
        const area = die.zones.find((z) => z.id === side).area;
        const region = regions[side];
        const next = rng(id.length * 31 + side.length);
        for (let i = 0; i < 4000; i++) {
          // small pieces, mostly near the fold, some anywhere on or off the panel
          const w = 20 + next() * 220;
          const h = 20 + next() * 160;
          const rotation = next() < 0.3 ? Math.round(next() * 360 - 180) : 0;
          const nearFold = next() < 0.7;
          const foldY = side === "front" ? geom.y1 : geom.y2;
          const cx = geom.cx + (next() - 0.5) * (nearFold ? 2.4 * geom.r : 1.4 * (region.x1 - region.x0));
          const cy = nearFold ? foldY + (next() - 0.5) * 2.2 * geom.r : region.y0 + (next() * 1.4 - 0.2) * (region.y1 - region.y0);
          const flat = confineCenter(region, { x: cx, y: cy }, half(w, h, rotation));
          const got = confinePose({ cx, cy, w, h, rotation }, { area });
          const at = `${id} ${side} #${i} (${cx.toFixed(1)}, ${cy.toFixed(1)}) ${w.toFixed(0)}x${h.toFixed(0)} ${rotation}deg`;
          expect(got.scale, at).toBe(1);
          expect(got.cx, at).toBeCloseTo(flat.x, 9);
          expect(got.cy, at).toBeCloseTo(flat.y, 9);
          expect(got.moved, at).toBe(flat.moved);
          // what it leaves is on its own side, and valid by both rules
          expect(faceAt(geom, resolveDie(id).stage, { x: got.cx / resolveDie(id).stage.width, y: got.cy / resolveDie(id).stage.height }), at).toBe(side);
          expect(poseValid(got, { area }), at).toBe(true);
          expect(confineCenter(region, { x: got.cx, y: got.cy }, half(w, h, rotation)).moved, at).toBe(false);
        }
      }
    }
  });

  it("calls a centre on the disc invalid, and the same pose without the keep-out valid", () => {
    for (const id of DIES) {
      const geom = dieGeometry(id);
      const { area } = canSpotLimits(canEditDie(id), "front");
      const pose = { cx: geom.cx, cy: geom.y1 - 20, w: 60, h: 30, rotation: 0 };
      expect(poseValid(pose, { area })).toBe(false);
      const { centreExclude, ...plain } = area;
      expect(centreExclude.r).toBeCloseTo(geom.r, 9);
      expect(poseValid(pose, { area: plain })).toBe(true);
      // pushed straight up off the disc, to just past its edge
      const got = confinePose(pose, { area });
      expect(got.cx).toBe(pose.cx);
      expect(got.cy).toBeLessThan(geom.cy - geom.r);
      expect(got.cy).toBeGreaterThan(geom.cy - geom.r - 0.01);
      expect(got.moved).toBe(true);
    }
  });

  it("leaves areas without a keep-out exactly as before (a hat's, the base's)", () => {
    const rect = { x: 100, y: 50, w: 400, h: 300 };
    const pose = { cx: 120, cy: 340, w: 80, h: 60, rotation: 10 };
    expect(confinePose(pose, { area: rect })).toEqual(confinePose(pose, { area: { ...rect, centreExclude: null } }));
    expect(confinePose(pose, { area: rect })).toEqual(confinePose(pose, { area: { ...rect, centreExclude: { cx: 0, cy: 0, r: 0 } } }));
    const base = canEditDie("koozie-standard").zones.find((z) => z.id === "base").area;
    expect(base.centreExclude).toBeUndefined();
  });
});
