/**
 * The confine rule for art placed on the 3D hat (hat-confine.js): a piece's
 * turned box stays inside its spot's AREA and within its CAP, shrinking
 * uniformly to fit and never growing; the rubber band that resists a drag past
 * either; and the overhang the server will refuse a placement on.
 *
 * The No. 7 die's zones (200 px/in) are the fixtures, plus the bigger areas
 * the rebuilt model will have round the same caps, since area and cap are
 * separate inputs and must never be assumed equal; then polygon areas (the
 * rebuilt die's zone.area: both front panels as one, a whole side panel, eyelet
 * keep-outs as holes), synthetic, on the same caps.
 */
import { describe, expect, it } from "vitest";
import {
  areaBounds,
  areaHome,
  areaRect,
  areaRings,
  bandPose,
  confinePose,
  overhang,
  pointInArea,
  poseValid,
  rotatedSize,
  rubberBand,
} from "../src/core/region.js";

const PPI = 200;
type Rect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };
const ZONES: Record<string, { area: Rect; cap: Size }> = {
  front: { area: { x: 40, y: 40, w: 900, h: 450 }, cap: { w: 4.5 * PPI, h: 2.25 * PPI } },
  left: { area: { x: 1020, y: 40, w: 400, h: 300 }, cap: { w: 2 * PPI, h: 1.5 * PPI } },
  back: { area: { x: 1020, y: 800, w: 500, h: 175 }, cap: { w: 2.5 * PPI, h: 0.875 * PPI } },
  label_tall: { area: { x: 1020, y: 1055, w: 350, h: 200 }, cap: { w: 1.75 * PPI, h: 1 * PPI } },
  // The rebuilt model: bigger areas, the same caps.
  front_big: { area: { x: 20, y: 20, w: 5.37 * PPI, h: 2.69 * PPI }, cap: { w: 4.5 * PPI, h: 2.25 * PPI } },
  side_big: { area: { x: 1000, y: 20, w: 2.86 * PPI, h: 2.14 * PPI }, cap: { w: 2 * PPI, h: 1.5 * PPI } },
  back_big: { area: { x: 1000, y: 780, w: 2.79 * PPI, h: 0.98 * PPI }, cap: { w: 2.5 * PPI, h: 0.875 * PPI } },
};

/** A small seeded PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-6;

function expectInside(p: { cx: number; cy: number; w: number; h: number; rotation: number }, area: Rect, cap: Size) {
  const e = rotatedSize(p.w, p.h, p.rotation);
  expect(e.w).toBeLessThanOrEqual(cap.w + EPS);
  expect(e.h).toBeLessThanOrEqual(cap.h + EPS);
  expect(p.cx - e.w / 2).toBeGreaterThanOrEqual(area.x - EPS);
  expect(p.cx + e.w / 2).toBeLessThanOrEqual(area.x + area.w + EPS);
  expect(p.cy - e.h / 2).toBeGreaterThanOrEqual(area.y - EPS);
  expect(p.cy + e.h / 2).toBeLessThanOrEqual(area.y + area.h + EPS);
}

describe("rotatedSize", () => {
  it("is the box itself unturned, and its sides swapped at a right angle exactly", () => {
    expect(rotatedSize(400, 100, 0)).toEqual({ w: 400, h: 100 });
    expect(rotatedSize(400, 100, 90)).toEqual({ w: 100, h: 400 });
    expect(rotatedSize(400, 100, -270)).toEqual({ w: 100, h: 400 });
    expect(rotatedSize(400, 100, 180)).toEqual({ w: 400, h: 100 });
  });

  it("grows to (w + h) / sqrt 2 on each axis at 45 degrees", () => {
    const e = rotatedSize(300, 100, 45);
    expect(e.w).toBeCloseTo(400 / Math.SQRT2, 9);
    expect(e.h).toBeCloseTo(400 / Math.SQRT2, 9);
  });
});

describe("confinePose", () => {
  it("leaves a piece that already fits exactly where it is", () => {
    const pose = { cx: 490, cy: 265, w: 300, h: 150, rotation: 10 };
    const out = confinePose(pose, ZONES.front);
    expect(out).toMatchObject({ ...pose, moved: false, capped: false, shrunk: false, scale: 1 });
  });

  it("fits inside the area and within the cap for many random poses, right angles included", () => {
    const rand = rng(7);
    let checked = 0;
    for (const z of Object.values(ZONES)) {
      for (let i = 0; i < 400; i++) {
        const rotation = i % 4 === 0 ? [0, 90, 180, -90, 270][i % 5] : (rand() - 0.5) * 720;
        const pose = {
          cx: z.area.x + (rand() * 3 - 1) * z.area.w,
          cy: z.area.y + (rand() * 3 - 1) * z.area.h,
          w: 5 + rand() * 2500,
          h: 5 + rand() * 1200,
          rotation,
        };
        const out = confinePose(pose, z);
        expectInside(out, z.area, z.cap);
        // Never grows, keeps its aspect and its rotation.
        expect(out.w).toBeLessThanOrEqual(pose.w + EPS);
        expect(out.h).toBeLessThanOrEqual(pose.h + EPS);
        expect(out.w / out.h).toBeCloseTo(pose.w / pose.h, 9);
        expect(out.rotation).toBe(rotation);
        checked++;
      }
    }
    expect(checked).toBe(400 * Object.keys(ZONES).length);
  });

  it("shrinks a turned piece about its centre until its turned box fits, then slides it in", () => {
    // 400 x 200 turned 90 degrees on the back (500 x 175): 200 x 400 must fit 175 tall.
    const out = confinePose({ cx: 1270, cy: 887.5, w: 400, h: 200, rotation: 90 }, ZONES.back);
    expect(out.scale).toBeCloseTo(175 / 400, 12);
    expect(out.h).toBeCloseTo(87.5, 9);
    expect(out.w).toBeCloseTo(175, 9);
    expect(out).toMatchObject({ shrunk: true, moved: false, cx: 1270, cy: 887.5 });
  });

  it("says the cap was the limit when the cap is what shrank it", () => {
    const big = { cx: 490, cy: 265, w: 1200, h: 300, rotation: 0 };
    expect(confinePose(big, ZONES.front)).toMatchObject({ capped: true, shrunk: true, w: 900, h: 225 });
    // On the rebuilt model the area is wider than the cap: still the cap that limits.
    const out = confinePose({ ...big, cx: 557 }, ZONES.front_big);
    expect(out).toMatchObject({ capped: true, w: 900 });
  });

  it("lets a capped piece move anywhere the bigger area reaches", () => {
    const z = ZONES.front_big;
    const at = (cx: number) => confinePose({ cx, cy: 200, w: 900, h: 300, rotation: 0 }, z);
    expect(at(z.area.x + 450).moved).toBe(false);
    expect(at(z.area.x + z.area.w - 450).moved).toBe(false);
    expect(at(0)).toMatchObject({ moved: true, cx: z.area.x + 450, capped: false, shrunk: false });
  });

  it("slides a piece past an edge back to just inside it, without shrinking it", () => {
    const out = confinePose({ cx: 0, cy: 600, w: 200, h: 100, rotation: 0 }, ZONES.front);
    expect(out).toMatchObject({ cx: 140, cy: 440, w: 200, h: 100, moved: true, shrunk: false, capped: false });
  });

  it("never grows a piece, however small (a size floor is the gesture's, not the rule's)", () => {
    expect(confinePose({ cx: 490, cy: 265, w: 100, h: 10, rotation: 0 }, ZONES.front)).toMatchObject({
      w: 100,
      h: 10,
      shrunk: false,
      scale: 1,
    });
    expect(bandPose({ cx: 490, cy: 265, w: 4, h: 2, rotation: 30 }, ZONES.front, 48)).toMatchObject({ w: 4, h: 2, pushed: false });
    // A long thin line turned 45 degrees shrinks as far as the back's 175 px needs, thin side and all.
    const out = confinePose({ cx: 1270, cy: 887.5, w: 2000, h: 30, rotation: 45 }, ZONES.back);
    expectInside(out, ZONES.back.area, ZONES.back.cap);
    expect(out.h).toBeLessThan(20);
  });

  it("works with either limit absent", () => {
    expect(confinePose({ cx: 0, cy: 0, w: 5000, h: 10, rotation: 0 }, { cap: { w: 100, h: 100 } })).toMatchObject({
      cx: 0,
      w: 100,
      moved: false,
    });
    expect(confinePose({ cx: 0, cy: 0, w: 50, h: 50, rotation: 0 }, { area: { x: 100, y: 100, w: 200, h: 200 } })).toMatchObject({
      cx: 125,
      cy: 125,
      moved: true,
    });
  });
});

describe("rubberBand", () => {
  it("is zero at zero, odd, monotone and bounded by its limit", () => {
    const limit = 48;
    expect(rubberBand(0, limit)).toBe(0);
    let last = 0;
    for (let over = 0.5; over < 100000; over *= 1.5) {
      const b = rubberBand(over, limit);
      expect(b).toBeGreaterThan(last);
      expect(b).toBeLessThan(limit);
      expect(b).toBeLessThan(over);
      expect(rubberBand(-over, limit)).toBeCloseTo(-b, 12);
      last = b;
    }
    expect(last).toBeGreaterThan(limit * 0.99);
  });

  it("starts at a little over half the finger's pace (the iOS 0.55)", () => {
    expect(rubberBand(0.001, 24) / 0.001).toBeCloseTo(0.55, 3);
  });

  it("gives nothing with no limit", () => {
    expect(rubberBand(30, 0)).toBe(0);
    expect(rubberBand(30, -1)).toBe(0);
  });
});

describe("bandPose", () => {
  it("is the pose itself inside its limits", () => {
    const pose = { cx: 490, cy: 265, w: 200, h: 100, rotation: 0 };
    expect(bandPose(pose, ZONES.front, 48)).toMatchObject({ ...pose, pushed: false });
  });

  it("shows a drag past an edge part of the way, never more than the limit past where it settles", () => {
    for (const cx of [100, 0, -500, -50000]) {
      const live = bandPose({ cx, cy: 265, w: 200, h: 100, rotation: 0 }, ZONES.front, 48);
      expect(live.pushed).toBe(true);
      expect(live.fit.cx).toBe(140);
      expect(live.cx).toBeLessThan(140);
      expect(live.cx).toBeGreaterThan(140 - 48);
      expect(live.cx).toBeGreaterThan(cx);
    }
  });

  it("shows a stretch past the cap part of the way, keeping the aspect", () => {
    const live = bandPose({ cx: 490, cy: 265, w: 3000, h: 1500, rotation: 0 }, ZONES.front, 48);
    expect(live.fit).toMatchObject({ w: 900, h: 450, capped: true });
    expect(live.w).toBeGreaterThan(900);
    expect(live.w).toBeLessThan(900 + 48);
    expect(live.w / live.h).toBeCloseTo(2, 9);
  });
});

describe("overhang", () => {
  it("is nothing for a pose confinePose made", () => {
    const rand = rng(11);
    for (let i = 0; i < 200; i++) {
      const z = ZONES.front_big;
      const out = confinePose(
        { cx: rand() * 2000, cy: rand() * 1000, w: 10 + rand() * 2000, h: 10 + rand() * 900, rotation: rand() * 360 },
        z,
      );
      const o = overhang(out, z);
      expect(o.area).toBeLessThan(1e-6);
      expect(o.cap).toBeLessThan(1e-9);
    }
  });

  it("measures px past the area's worst edge, and the fraction over the cap", () => {
    expect(overhang({ cx: 110, cy: 265, w: 200, h: 100, rotation: 0 }, ZONES.front)).toEqual({ area: 30, cap: 0 });
    const wide = overhang({ cx: 490, cy: 265, w: 1080, h: 100, rotation: 0 }, ZONES.front);
    expect(wide.area).toBeCloseTo(90, 9);
    expect(wide.cap).toBeCloseTo(0.2, 9);
    // Turned 90 degrees, a 400 wide piece is 400 tall on the 300 tall left side.
    const o = overhang({ cx: 1220, cy: 190, w: 400, h: 100, rotation: 90 }, ZONES.left);
    expect(o.area).toBeCloseTo(50, 9);
    expect(o.cap).toBeCloseTo(400 / 300 - 1, 9);
  });
});

// ---- Polygon areas -------------------------------------------------------------------
// The rebuilt die's zone.area: one outline (the printable region after margins) and
// keep-out holes round the eyelets, die px, y down. These are synthetic: an arch for the
// two front panels as one (its bottom the crown-to-bill crease, sagging; its top the
// button skirt), two eyelet holes; a concave U; a side panel that narrows to the button.
type Pt = [number, number];
type Poly = { outline: Pt[]; holes: Pt[][] };
const circle = (cx: number, cy: number, r: number, n = 24): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy - r * Math.sin((2 * Math.PI * i) / n)]);
function arch(): Poly {
  const bottom: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    bottom.push([100 + 1300 * t, 800 + 40 * Math.sin(Math.PI * t)]);
  }
  // counter-clockwise on screen: along the bottom left to right, then up and back over the top
  return { outline: [...bottom, [1300, 400], [800, 100], [700, 100], [200, 400]], holes: [circle(450, 380, 40), circle(1050, 380, 40)] };
}
const FRONT_POLY = arch();
const SEAM_X = 750;
// A U: two arms joined at the bottom; the notch between them (x 400..600, y 0..300) is outside.
const U: Poly = { outline: [[0, 0], [0, 500], [1000, 500], [1000, 0], [600, 0], [600, 300], [400, 300], [400, 0]], holes: [] };
// A side panel: wide at the band (the bottom), narrowing to the button, an eyelet high up.
const SIDE_POLY: Poly = { outline: [[1000, 600], [1600, 600], [1450, 150], [1150, 150]], holes: [circle(1300, 230, 35)] };
const POLYS: Record<string, { area: Poly; cap: Size }> = {
  front: { area: FRONT_POLY, cap: { w: 4.5 * PPI, h: 2.25 * PPI } },
  u: { area: U, cap: { w: 2 * PPI, h: 1.5 * PPI } },
  side: { area: SIDE_POLY, cap: { w: 2 * PPI, h: 1.5 * PPI } },
};
const POLY_EPS = 1e-5;
type P5 = { cx: number; cy: number; w: number; h: number; rotation: number };
// to a hundred-thousandth of a die px (the rule itself allows 1e-4 for float noise and rounding)
const valid = (p: P5, z: { area: Poly; cap: Size }) => poseValid(p, z, 1e-5);

describe("confinePose on a polygon area", () => {
  it("leaves a valid pose where it is, anywhere on the two front panels, across the seam too", () => {
    for (const [cx, cy] of [[750, 600], [300, 760], [1200, 760], [SEAM_X, 450]]) {
      const pose = { cx, cy, w: 200, h: 80, rotation: 0 };
      expect(valid(pose, POLYS.front), `${cx},${cy}`).toBe(true);
      expect(confinePose(pose, POLYS.front)).toMatchObject({ ...pose, moved: false, shrunk: false, scale: 1 });
    }
  });

  it("brings many random poses inside the outline, clear of every hole and within the cap, never growing them", () => {
    const rand = rng(23);
    for (const z of Object.values(POLYS)) {
      const b = areaBounds(z.area)!;
      for (let i = 0; i < 400; i++) {
        const rotation = i % 4 === 0 ? [0, 90, 180, -90, 270][i % 5] : (rand() - 0.5) * 720;
        const pose = { cx: b.x + (rand() * 3 - 1) * b.w, cy: b.y + (rand() * 3 - 1) * b.h, w: 5 + rand() * 1500, h: 5 + rand() * 700, rotation };
        // half with a `from` (a drag's last valid pose), half without (toward home)
        const from = i % 2 ? confinePose({ ...pose, cx: b.x + rand() * b.w, cy: b.y + rand() * b.h }, z) : null;
        const out = confinePose(pose, { ...z, from });
        expect(valid(out, z), JSON.stringify(pose)).toBe(true);
        const o = overhang(out, z);
        expect(o.area).toBeLessThan(POLY_EPS);
        expect(o.cap).toBeLessThan(1e-9);
        expect(out.w).toBeLessThanOrEqual(pose.w + EPS);
        expect(out.h).toBeLessThanOrEqual(pose.h + EPS);
        expect(out.w / out.h).toBeCloseTo(pose.w / pose.h, 9);
        expect(out.rotation).toBe(rotation);
      }
    }
  });

  it("moves a piece out of a concave outline's notch to the first centre that takes it on the way home", () => {
    const pose = { cx: 500, cy: 100, w: 100, h: 100, rotation: 0 };
    expect(valid(pose, POLYS.u)).toBe(false);
    const out = confinePose(pose, POLYS.u);
    expect(valid(out, POLYS.u)).toBe(true);
    expect(out).toMatchObject({ moved: true, shrunk: false });
    // on the line from the asked centre to home, and a pixel back toward the asked one does not fit
    const home = areaHome(U)!;
    const cross = (out.cx - 500) * (home[1] - 100) - (out.cy - 100) * (home[0] - 500);
    // (to the 2e-6 px it backs off the edge it met, along that edge's normal)
    expect(cross / Math.hypot(home[0] - 500, home[1] - 100)).toBeCloseTo(0, 5);
    const back = 1 / Math.hypot(out.cx - 500, out.cy - 100);
    expect(valid({ ...out, cx: out.cx + (500 - out.cx) * back, cy: out.cy + (100 - out.cy) * back }, POLYS.u)).toBe(false);
  });

  it("stops a drag at the edge it meets (with `from`), never jumping the notch, and goes round it", () => {
    const z = POLYS.u;
    const from = { cx: 200, cy: 150, w: 100, h: 100, rotation: 0 };
    // asked for in the notch, nearer the far arm: the notch's near wall stops it
    const out = confinePose({ ...from, cx: 560 }, { ...z, from });
    expect(valid(out, z)).toBe(true);
    expect(out.cx + 50).toBeCloseTo(400, 4);
    expect(out.cy).toBeCloseTo(150, 6);
    // asked for in the far arm, valid as it stands: still stopped at the near wall, not hopped across
    const far = confinePose({ ...from, cx: 800 }, { ...z, from });
    expect(valid({ ...from, cx: 800 }, z)).toBe(true);
    expect(far).toMatchObject({ moved: true });
    expect(far.cx + 50).toBeCloseTo(400, 4);
    // round it: down the wall below the notch, then across the joined bottom to the far arm
    const down = confinePose({ ...far, cx: 800, cy: 400 }, { ...z, from: far });
    expect(valid(down, z)).toBe(true);
    expect(down.cx + 50).toBeCloseTo(400, 4);
    expect(down.cy).toBeCloseTo(400, 4);
    expect(confinePose({ ...down, cx: 800, cy: 400 }, { ...z, from: down })).toMatchObject({ cx: 800, cy: 400, moved: false });
  });

  it("takes a free move from `from` exactly as asked: not moved, to the last bit", () => {
    const f = POLYS.front;
    const from = { cx: 500, cy: 600, w: 200, h: 80, rotation: 12 };
    for (const [cx, cy] of [[520.123456789, 611.987654321], [SEAM_X, 640], [980.5, 700.25]]) {
      const out = confinePose({ ...from, cx, cy }, { ...f, from });
      expect(out).toMatchObject({ cx, cy, moved: false, shrunk: false });
      expect(bandPose({ ...from, cx, cy }, { ...f, from }, 24)).toMatchObject({ cx, cy, pushed: false });
    }
  });

  it("pushes a piece turned or grown beside an eyelet off it by about the least it must, never across it", () => {
    // a tall side panel, the eyelet high on its axis, home well below it
    const area: Poly = { outline: [[1000, 900], [1600, 900], [1500, 100], [1100, 100]], holes: [circle(1300, 400, 40)] };
    const z = { area, cap: { w: 2 * PPI, h: 1.5 * PPI } };
    expect(areaHome(area)![1]).toBeGreaterThan(500);
    const top = 360; // the keep-out's top
    // a 240 x 100 logo just above it
    const above = { cx: 1300, cy: 305, w: 240, h: 100, rotation: 0 };
    expect(valid(above, z)).toBe(true);
    for (const [ask, least] of [
      // turned 20 degrees: its turned box is 176 tall, 33 px into the keep-out
      [{ ...above, rotation: 20 }, 305 + rotatedSize(240, 100, 20).h / 2 - top],
      // grown 1.25x: 125 tall, 7.5 px into it
      [{ ...above, w: 300, h: 125 }, 305 + 62.5 - top],
    ] as const) {
      expect(valid(ask, z)).toBe(false);
      for (const out of [confinePose(ask, { ...z, from: above }), confinePose(ask, { ...z, from: above, slide: "step" })]) {
        expect(valid(out, z)).toBe(true);
        expect(out).toMatchObject({ shrunk: false, w: ask.w, h: ask.h, rotation: ask.rotation });
        const moved = Math.hypot(out.cx - ask.cx, out.cy - ask.cy);
        expect(moved).toBeGreaterThan(least - 1e-6);
        expect(moved).toBeLessThan(least * 1.05 + 0.5);
        // still above the eyelet: its turned box's bottom on or over the keep-out's top
        expect(out.cy + rotatedSize(out.w, out.h, out.rotation).h / 2).toBeLessThanOrEqual(top + 1e-4);
      }
    }
  });

  it("lets a nudge (`slide: \"step\"`) follow a gently sloping edge, but a step into it stays put", () => {
    const f = POLYS.front;
    // resting on the sagging crease on the left half, where it rises to the left
    let at = confinePose({ cx: 400, cy: 1000, w: 200, h: 80, rotation: 0 }, f);
    for (let i = 0; i < 4; i++) at = confinePose({ ...at, cy: at.cy + 10 }, { ...f, from: at, slide: "step" });
    expect(valid({ ...at, cy: at.cy + 1 }, f), "on the crease").toBe(false);
    // Left: without a slide it cannot move at all; with the step rule it goes left, rising a little
    const stuck = confinePose({ ...at, cx: at.cx - 10 }, { ...f, from: at, slide: false });
    expect(Math.hypot(stuck.cx - at.cx, stuck.cy - at.cy)).toBeLessThan(1e-3);
    const left = confinePose({ ...at, cx: at.cx - 10 }, { ...f, from: at, slide: "step" });
    expect(valid(left, f)).toBe(true);
    expect(at.cx - left.cx).toBeGreaterThan(9.5);
    expect(at.cy - left.cy).toBeGreaterThan(0);
    expect(at.cy - left.cy).toBeLessThan(2);
    // Down, into the crease: no sideways drift (a drag's slide would take it along)
    const down = confinePose({ ...at, cy: at.cy + 10 }, { ...f, from: at, slide: "step" });
    expect(Math.hypot(down.cx - at.cx, down.cy - at.cy)).toBeLessThan(1e-4);
    expect(Math.abs(confinePose({ ...at, cy: at.cy + 10 }, { ...f, from: at }).cx - at.cx)).toBeGreaterThan(0.01);
  });

  it("slides a drag along the edge it is pushed past, as the rect's clamp does", () => {
    const z = POLYS.u;
    const from = { cx: 200, cy: 300, w: 100, h: 100, rotation: 0 };
    // down and right past the bottom (y 500): x follows the finger, y stops at the edge
    const out = confinePose({ ...from, cx: 260, cy: 700 }, { ...z, from });
    expect(out.cx).toBeCloseTo(260, 4);
    expect(out.cy + 50).toBeCloseTo(500, 4);
    expect(out.moved).toBe(true);
    // into the bottom-left corner: stops in it
    const corner = confinePose({ ...from, cx: -400, cy: 900 }, { ...z, from });
    expect(corner.cx - 50).toBeCloseTo(0, 4);
    expect(corner.cy + 50).toBeCloseTo(500, 4);
    // along the front's sagging bottom: the piece follows the finger along the curve, sitting on it
    // (a little downhill of the finger, as the nearest centre would be)
    const f = POLYS.front;
    let at = confinePose({ cx: 300, cy: 700, w: 200, h: 80, rotation: 0 }, f);
    for (const x of [400, 500, 600, 700, 800, 900]) {
      const next = confinePose({ ...at, cx: x, cy: 1000 }, { ...f, from: at });
      expect(valid(next, f)).toBe(true);
      expect(valid({ ...next, cy: next.cy + 1 }, f), "on the bottom edge").toBe(false);
      expect(next.cx).toBeGreaterThan(at.cx);
      expect(Math.abs(next.cx - x)).toBeLessThan(30);
      at = next;
    }
  });

  it("keeps a piece off a hole, and a turned one too: at 90 degrees its turned box swaps sides", () => {
    const z = POLYS.side;
    const hole = { x: 1300, y: 230, r: 35 };
    // a wide logo laid over the eyelet
    const over = { cx: hole.x, cy: hole.y + 20, w: 160, h: 40, rotation: 0 };
    expect(valid(over, z)).toBe(false);
    expect(overhang(over, z).area).toBeGreaterThan(10);
    const out = confinePose(over, z);
    expect(valid(out, z)).toBe(true);
    // turned 90 degrees beside the eyelet: 40 wide, 160 tall
    const beside = { cx: hole.x + hole.r + 25, cy: 380, w: 160, h: 40, rotation: 0 };
    expect(valid(beside, z)).toBe(true);
    const turned = confinePose({ ...beside, rotation: 90 }, { ...z, from: beside });
    expect(valid(turned, z)).toBe(true);
    const e = rotatedSize(turned.w, turned.h, 90);
    expect(e.w).toBeCloseTo(40 * turned.scale, 9);
    // its turned box is clear of the eyelet's keep-out
    const nearestX = Math.max(turned.cx - e.w / 2, Math.min(hole.x, turned.cx + e.w / 2));
    const nearestY = Math.max(turned.cy - e.h / 2, Math.min(hole.y, turned.cy + e.h / 2));
    expect(Math.hypot(nearestX - hole.x, nearestY - hole.y)).toBeGreaterThan(hole.r * Math.cos(Math.PI / 24) - 1e-6);
    // and the turn back, from there, is valid again
    expect(valid(confinePose({ ...turned, rotation: 0 }, { ...z, from: turned }), z)).toBe(true);
  });

  it("caps first and says so; shrinks further only when no centre on the way takes it, and never grows", () => {
    const f = POLYS.front;
    const big = confinePose({ cx: 750, cy: 600, w: 1800, h: 450, rotation: 0 }, f);
    expect(big).toMatchObject({ capped: true, shrunk: true, w: 900, h: 225 });
    expect(valid(big, f)).toBe(true);
    // the side panel cannot take its own 2 x 1.5 in cap near the button: moved down to where it fits
    const s = POLYS.side;
    const high = confinePose({ cx: 1300, cy: 200, w: 400, h: 300, rotation: 0 }, s);
    expect(valid(high, s)).toBe(true);
    expect(high.cy).toBeGreaterThan(200);
    // within the panel's bounds but too big for the panel anywhere: shrunk, and the area did it
    const wide = confinePose({ cx: 1300, cy: 400, w: 560, h: 400, rotation: 0 }, { area: SIDE_POLY });
    expect(poseValid(wide, { area: SIDE_POLY }, 1e-5)).toBe(true);
    expect(wide).toMatchObject({ shrunk: true, capped: false });
    expect(wide.w / wide.h).toBeCloseTo(560 / 400, 9);
    // never grown, however small
    expect(confinePose({ cx: 750, cy: 600, w: 3, h: 1, rotation: 33 }, f)).toMatchObject({ w: 3, h: 1, shrunk: false, scale: 1 });
    expect(bandPose({ cx: 750, cy: 600, w: 3, h: 1, rotation: 0 }, f, 48)).toMatchObject({ w: 3, h: 1, pushed: false });
  });

  it("moves a wide logo to where its shape fits rather than shrinking it at home (an eyelet on the panel's axis)", () => {
    const s = POLYS.side;
    // the eyelet on the axis pushes the pole, the largest circle's centre, off to one side
    const home = areaHome(SIDE_POLY)!;
    expect(Math.abs(home[0] - 1300)).toBeGreaterThan(10);
    const wide = { cx: home[0], cy: home[1], w: 400, h: 80, rotation: 0 };
    expect(valid(wide, s)).toBe(false);
    const out = confinePose(wide, s);
    expect(valid(out, s)).toBe(true);
    expect(out).toMatchObject({ w: 400, h: 80, shrunk: false, moved: true });
    // lower, where the panel is wider, and only as far as it had to go: a px back toward home does not fit
    expect(out.cy).toBeGreaterThan(home[1]);
    const back = 1 / Math.hypot(home[0] - out.cx, home[1] - out.cy);
    expect(valid({ ...out, cx: out.cx + (home[0] - out.cx) * back, cy: out.cy + (home[1] - out.cy) * back }, s)).toBe(false);
  });

  it("reads a polygon that is an axis-aligned rect with no holes (the back, the label) exactly as the rect", () => {
    const rect = ZONES.back.area;
    const poly = { outline: [[rect.x, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h], [rect.x + rect.w, rect.y]] as Pt[], holes: [] };
    expect(areaRect(poly)).toEqual(rect);
    const rand = rng(5);
    for (let i = 0; i < 100; i++) {
      const pose = { cx: rand() * 2000, cy: 700 + rand() * 400, w: 10 + rand() * 900, h: 10 + rand() * 300, rotation: (rand() - 0.5) * 360 };
      expect(confinePose(pose, { area: poly, cap: ZONES.back.cap })).toEqual(confinePose(pose, ZONES.back));
      expect(overhang(pose, { area: poly, cap: ZONES.back.cap })).toEqual(overhang(pose, ZONES.back));
    }
  });
});

describe("areaHome and the rest of an area's reading", () => {
  it("is the pole of inaccessibility: inside, clear of the holes, farthest from every edge", () => {
    for (const z of Object.values(POLYS)) {
      const [x, y] = areaHome(z.area)!;
      expect(pointInArea(z.area, x, y)).toBe(true);
      // no grid point inside is much farther from the edges
      const clearance = (px: number, py: number) => {
        let d = Infinity;
        for (const ring of [z.area.outline, ...z.area.holes]) {
          for (let i = 0; i < ring.length; i++) {
            const [ax, ay] = ring[i];
            const [bx, by] = ring[(i + 1) % ring.length];
            const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
            const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
            d = Math.min(d, Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)));
          }
        }
        return d;
      };
      const b = areaBounds(z.area)!;
      let best = 0;
      for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
        const px = b.x + (b.w * i) / 60;
        const py = b.y + (b.h * j) / 60;
        if (pointInArea(z.area, px, py)) best = Math.max(best, clearance(px, py));
      }
      expect(clearance(x, y)).toBeGreaterThan(best - 1);
    }
  });

  it("puts a symmetric outline's home on its centre line exactly (the front's seam)", () => {
    expect(areaHome(FRONT_POLY)![0]).toBe(SEAM_X);
  });

  it("is the centre of a rect, and every reading is null or empty for no area", () => {
    expect(areaHome(ZONES.front.area)).toEqual([490, 265]);
    expect(areaBounds(FRONT_POLY)).toEqual({ x: 100, y: 100, w: 1300, h: 740 });
    expect(areaRings(ZONES.back.area)).toHaveLength(1);
    expect(areaRings(FRONT_POLY)).toHaveLength(3);
    expect([areaHome(null), areaBounds(null), areaRect(null)]).toEqual([null, null, null]);
    expect(areaRings(undefined)).toEqual([]);
    expect(pointInArea(FRONT_POLY, 450, 380)).toBe(false); // in an eyelet
    expect(pointInArea(FRONT_POLY, 750, 600)).toBe(true);
  });
});

describe("bandPose and overhang on a polygon", () => {
  it("bands a drag past the edge along the overshoot, never more than the limit past where it settles", () => {
    const z = POLYS.u;
    const from = { cx: 200, cy: 300, w: 100, h: 100, rotation: 0 };
    for (const over of [10, 100, 1000, 100000]) {
      const live = bandPose({ ...from, cx: 260, cy: 450 + over }, { ...z, from }, 24);
      expect(live.pushed).toBe(true);
      const d = Math.hypot(live.cx - live.fit.cx, live.cy - live.fit.cy);
      expect(d).toBeLessThan(24);
      expect(d).toBeGreaterThan(0);
      expect(live.cy).toBeGreaterThan(live.fit.cy);
    }
    expect(bandPose(from, z, 24)).toMatchObject({ ...from, pushed: false });
  });

  it("measures a corner past the outline, a corner in a hole, and a hole wholly under the box", () => {
    const z = POLYS.u;
    // the box's right side 30 px past x 1000
    expect(overhang({ cx: 980, cy: 400, w: 100, h: 40, rotation: 0 }, z).area).toBeCloseTo(30, 6);
    // one corner 20 px into the notch's floor (y 300), its others in the arm
    expect(overhang({ cx: 380, cy: 330, w: 80, h: 100, rotation: 0 }, z).area).toBeCloseTo(20, 6);
    // a hole wholly under a box with every corner inside the outline: still refused
    const hole = { outline: [[0, 0], [0, 400], [400, 400], [400, 0]] as Pt[], holes: [circle(200, 200, 10)] };
    const covering = { cx: 200, cy: 200, w: 200, h: 200, rotation: 0 };
    expect(poseValid(covering, { area: hole })).toBe(false);
    expect(overhang(covering, { area: hole }).area).toBeGreaterThan(80);
    expect(overhang({ ...covering, cx: 100, cy: 100, w: 100, h: 100 }, { area: hole }).area).toBe(0);
  });
});
