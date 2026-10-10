import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIES, dieGeometry } from "../src/core/dies.js";
import { MAGNET_INCHES, magnetRect } from "../src/core/magnet.js";
import * as core from "../src/core/index.js";

// Captured from src/core/magnet.js when v1.6.0 added it. Like the camera
// golden, a change here relocates nothing stored: the magnet is drawn on screen
// only, never into a proof or a design document. What it pins is that the strip
// stays the part measured off Reel48's product photo, on both dies. If a change
// is deliberate, recapture it and say why in the commit.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./magnet.golden.json", import.meta.url)), "utf8"),
);

const round = (n) => Math.round(n * 1000) / 1000;
const rounded = (r) => ({
  x0: round(r.x0),
  y0: round(r.y0),
  x1: round(r.x1),
  y1: round(r.y1),
  pads: r.pads.map((p) => ({ x0: round(p.x0), y0: round(p.y0), x1: round(p.x1), y1: round(p.y1) })),
});

describe("magnetRect", () => {
  for (const id of ["koozie-standard", "koozie-slim"]) {
    const geom = dieGeometry(DIES[id]);
    const back = geom.zones.find((z) => z.id === "back").bounds;
    const m = magnetRect(geom);

    it(`${id}: matches the golden`, () => {
      expect(rounded(m)).toEqual(GOLDEN[id]);
    });

    it(`${id}: is the measured part, in inches, centred on the back panel`, () => {
      expect((m.x1 - m.x0) / geom.pxPerInch).toBeCloseTo(MAGNET_INCHES.width, 6);
      expect((m.y1 - m.y0) / geom.pxPerInch).toBeCloseTo(MAGNET_INCHES.height, 6);
      expect((m.x0 + m.x1) / 2).toBeCloseTo((back.x0 + back.x1) / 2, 6);
      expect((m.y0 + m.y1) / 2).toBeCloseTo((back.y0 + back.y1) / 2, 6);
      expect(m.x0).toBeGreaterThan(back.x0);
      expect(m.x1).toBeLessThan(back.x1);
      expect(m.y0).toBeGreaterThan(back.y0);
      expect(m.y1).toBeLessThan(back.y1);
    });

    it(`${id}: three near-square pads inside the border, top to bottom`, () => {
      expect(m.pads).toHaveLength(3);
      for (const p of m.pads) {
        expect(p.x0).toBeGreaterThan(m.x0);
        expect(p.x1).toBeLessThan(m.x1);
        expect((p.x1 - p.x0) / (p.y1 - p.y0)).toBeGreaterThan(0.9);
        expect((p.x1 - p.x0) / (p.y1 - p.y0)).toBeLessThan(1.1);
      }
      expect(m.pads[0].y0).toBeGreaterThan(m.y0);
      expect(m.pads[2].y1).toBeLessThan(m.y1);
      expect(m.pads[0].y1).toBeLessThan(m.pads[1].y0);
      expect(m.pads[1].y1).toBeLessThan(m.pads[2].y0);
    });
  }

  it("a die with no back zone has no magnet", () => {
    expect(magnetRect({ zones: [{ id: "front", bounds: { x0: 0, x1: 1, y0: 0, y1: 1 } }], pxPerInch: 10 })).toBeNull();
    expect(magnetRect(null)).toBeNull();
  });

  it("is exported from core", () => {
    expect(core.magnetRect).toBe(magnetRect);
    expect(core.MAGNET_INCHES).toBe(MAGNET_INCHES);
  });
});
