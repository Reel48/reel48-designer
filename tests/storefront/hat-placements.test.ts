// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-placements.test.ts (origin/main d78d90ee); imports point into this package.
// Dropped: the "a designed hat in the cart" suite and its db/next mocks (they drive the storefront's server/cart.ts addLine and updateLine and its pricing).
// Adapted: the E1 die is read from tests/hat-no-7-v2.golden.json (a byte copy of the storefront's scripts/blender/hat-no7/e1/die_no7.json).
/**
 * A designed hat's spots and its price (2026-10-19/20): which spots a design
 * uses, which one is primary, how many extra spots it carries, and that the
 * cart prices it from its elements alone, whatever was posted beside them.
 */
import { describe, expect, it } from "vitest";
import { DIES } from "../../src/core/index.js";
import { readFileSync } from "node:fs";
import { HAT_DIES, HAT_NO_6_DIE, HAT_NO_7_DIE, HAT_NO_7_V1_DIE, hatDie, spotHome } from "../../src/core/hat-config.js";
import {
  confineElement,
  distanceToArea,
  fitsSpot,
  elementPose,
  hatPlacements,
  hatSpotProblem,
  logoMisfit,
  spotLine,
  spotSummary,
  strayElement,
  zoneArea,
  zoneCap,
  zoneOfElement,
} from "../../src/core/hat-placements.js";
import type { HatDie, HatPolygon } from "../../src/core/hat-placements.js";
import { HAT_NO_7_ANCHORS } from "../../src/core/hat-migrate.js";
import { poseValid } from "../../src/core/region.js";

// The first No. 7 die: every design made before round E1 is on it, and is
// still priced and checked on it (its own die, hatDie(doc.dieId)).
const DIE = HAT_NO_7_V1_DIE as unknown as HatDie;
const HAT_DECORATIONS = ["embroidery", "pvc_patch", "silicon_patch", "woven_patch"];

/** A zone's centre, as the fractions of the stage a design stores. */
function at(zone: string) {
  const z = DIE.zones.find((zz) => zz.id === zone)!;
  return { x: (z.rect.x + z.rect.w / 2) / DIE.stage.width, y: (z.rect.y + z.rect.h / 2) / DIE.stage.height };
}
const logo = (id: string, zone: string) => ({ id, type: "logo", ...at(zone), scale: 0.1, mimeType: "image/png" });
const text = (id: string, zone: string, copy = "EST 1999") => ({ id, type: "text", text: copy, ...at(zone), fontScale: 0.03 });

function hat(elements: unknown[], zones: Record<string, unknown> = { front: { method: "embroidery" } }) {
  return { schemaVersion: 4, kind: "hat", dieId: "hat-no-7", parts: {}, zones, elements };
}

describe("which spot an element belongs to", () => {
  it("is the spot its centre is in", () => {
    for (const z of DIE.zones) expect(zoneOfElement(logo("a", z.id), DIE)?.id).toBe(z.id);
  });
  it("is the nearest spot for a centre in a gutter", () => {
    // Between the front (right edge 940) and the left side (left edge 1020).
    expect(zoneOfElement({ x: 975 / 1560, y: 100 / 1296 }, DIE)?.id).toBe("front");
    expect(zoneOfElement({ x: 990 / 1560, y: 100 / 1296 }, DIE)?.id).toBe("left");
  });
  it("is nothing without a finite centre", () => {
    expect(zoneOfElement({ x: Number.NaN, y: 0.5 }, DIE)).toBeNull();
    expect(zoneOfElement({ x: "0.5", y: 0.5 }, DIE)).toBeNull();
  });
});

describe("the primary spot and the extra spots", () => {
  it("makes the front primary and counts every other used spot, the label included", () => {
    const spots = hatPlacements(hat([logo("a", "front"), logo("b", "left"), text("c", "label_tall")]))!;
    expect(spots.primary).toEqual({ zone: "front", method: "embroidery", primary: true });
    expect(spots.placements.map((p) => [p.zone, p.method])).toEqual([
      ["front", "embroidery"],
      ["left", "embroidery"],
      ["label_tall", "woven_label"],
    ]);
    expect(spots.extraSpots).toBe(2);
  });
  it("makes the first used of left, right and back primary when the front is empty", () => {
    const spots = hatPlacements(hat([logo("a", "back"), logo("b", "right"), logo("c", "label_square")], {}))!;
    expect(spots.primary?.zone).toBe("right");
    expect(spots.extraSpots).toBe(2);
  });
  it("counts a spot once however many pieces it holds, and never one with only blank text", () => {
    const spots = hatPlacements(hat([logo("a", "front"), text("b", "front"), text("c", "back", "   ")]))!;
    expect(spots.placements.map((p) => p.zone)).toEqual(["front"]);
    expect(spots.extraSpots).toBe(0);
  });
  it("reads only hat designs on a die it knows", () => {
    expect(hatPlacements({ size: "standard", elements: [logo("a", "front")] })).toBeNull();
    expect(hatPlacements({ ...hat([]), dieId: "hat-no-99" })).toBeNull();
  });
});

describe("what a hat's spots can be made with", () => {
  const problem = (elements: unknown[], zones?: Record<string, unknown>, decos = HAT_DECORATIONS) =>
    hatSpotProblem(hatPlacements(hat(elements, zones))!, decos);

  it("takes a woven label although no product offers woven_label as its decoration", () => {
    expect(problem([logo("a", "front"), logo("b", "label_tall")])).toBeNull();
  });
  it("checks the primary spot against the product and every spot against its own methods", () => {
    expect(problem([logo("a", "front")], { front: { method: "pvc_patch" } })).toBeNull();
    expect(problem([logo("a", "front")], { front: { method: "pvc_patch" } }, ["embroidery"])).toMatch(/PVC Patch isn't offered on the front/);
    expect(problem([logo("a", "front"), logo("b", "left")], { left: { method: "pvc_patch" } })).toMatch(/left side/);
    expect(problem([logo("a", "front")], { front: { method: "woven_label" } })).toMatch(/isn't offered/);
  });
  it("refuses art under the bill, on the bill top, or far from every spot", () => {
    // Nearest to the square label, but inside the reserved under-bill and bill-top rects.
    expect(problem([logo("a", "front"), { id: "b", type: "logo", x: 800 / 1560, y: 900 / 1296 }])).toMatch(/isn't on a spot/);
    expect(problem([logo("a", "front"), { id: "b", type: "logo", x: 340 / 1560, y: 1100 / 1296 }])).toMatch(/isn't on a spot/);
    // In the gutter beside a spot is still that spot's.
    expect(problem([logo("a", "front"), { id: "b", type: "logo", x: 975 / 1560, y: 100 / 1296 }])).toBeNull();
  });
  it("needs a spot on the outside, and one inside label shape", () => {
    expect(problem([logo("a", "label_square")])).toMatch(/front, a side or the back/);
    expect(problem([logo("a", "front"), logo("b", "label_tall"), logo("c", "label_square")])).toMatch(/one inside label/);
  });
});

describe("a logo's limits on the first die", () => {
  // The first No. 7 die: each spot's rect IS its area and its cap.
  const sized = (zone: string, wPx: number, hPx: number, dx = 0, rotation = 0) => {
    const z = DIE.zones.find((zz) => zz.id === zone)!;
    return {
      id: "big",
      type: "logo",
      x: (z.rect.x + z.rect.w / 2 + dx) / DIE.stage.width,
      y: (z.rect.y + z.rect.h / 2) / DIE.stage.height,
      rotation,
      scale: wPx / DIE.stage.width,
      naturalWidth: wPx * 10,
      naturalHeight: hPx * 10,
      mimeType: "image/png",
    };
  };
  const problem = (elements: unknown[]) => hatSpotProblem(hatPlacements(hat(elements))!, HAT_DECORATIONS);

  it("reads a logo's pose from its scale and natural aspect, and text as a point unless it is measured", () => {
    expect(elementPose(sized("front", 300, 150), DIE)).toEqual({ cx: 490, cy: 265, w: 300, h: 150, rotation: 0 });
    expect(elementPose({ ...sized("front", 300, 150), naturalHeight: undefined }, DIE)?.h).toBeCloseTo(300, 9);
    expect(elementPose(text("t", "front"), DIE)).toMatchObject({ w: 0, h: 0 });
    expect(elementPose(text("t", "front"), DIE, () => ({ w: 120, h: 40 }))).toMatchObject({ w: 120, h: 40 });
    expect(elementPose({ x: Number.NaN, y: 0.5 }, DIE)).toBeNull();
    const front = DIE.zones[0];
    expect(zoneArea(front)).toBe(front.rect);
    expect(zoneCap(front, DIE)).toEqual({ w: 900, h: 450 });
  });

  it("takes a design as the designer before E1 made it: never refused for a logo's size or turn", () => {
    // That designer confined its on-canvas handles to the spot, but not its
    // Rotate and size buttons, so carts, quantity changes and tabs opened
    // before E1 hold logos like these. The spec flags an oversize one instead
    // (hat-spec.ts "Check size").
    const made = [
      sized("front", 720, 360, 0, 15), // the default 80% logo, turned: its box is over the cap
      { ...sized("left", 420, 200), id: "l" }, // 2.1 in on a 2 in side
      { ...sized("back", 300, 150, 120), id: "b" }, // past the back's edge
    ];
    const spots = hatPlacements(hat(made))!;
    expect(spots.misfits).toEqual([]);
    expect(spots.placements.map((p) => p.zone)).toEqual(["front", "left", "back"]);
    expect(problem(made)).toBeNull();
    // the rule itself still reads it, for a host that asks
    expect(logoMisfit(made[0], DIE.zones[0], DIE)).toMatchObject({ zone: "front", overCap: expect.closeTo(0.1869, 3) });
  });
});

describe("a logo's limits on a die with areas", () => {
  // Round E1's die: the back is a rect area (558 x 195 px) round a 2.5 x 0.875 in cap.
  const V2 = HAT_NO_7_DIE as unknown as HatDie;
  const back = V2.zones.find((z) => z.id === "back")!;
  const backRight = back.rect.x + back.rect.w;
  const [bx, by] = HAT_NO_7_ANCHORS.zonesTo.back;
  const placed = (id: string, wPx: number, hPx: number, dx = 0, rotation = 0) => {
    const [x, y] = HAT_NO_7_ANCHORS.zonesTo[id as keyof typeof HAT_NO_7_ANCHORS.zonesTo];
    return {
      id: `big-${id}`,
      type: "logo",
      x: (x + dx) / V2.stage.width,
      y: y / V2.stage.height,
      rotation,
      scale: wPx / V2.stage.width,
      naturalWidth: wPx * 10,
      naturalHeight: hPx * 10,
      mimeType: "image/png",
    };
  };
  const onV2 = (elements: unknown[]) => ({ ...hat(elements), dieId: V2.id });
  const problemV2 = (elements: unknown[]) => hatSpotProblem(hatPlacements(onV2(elements))!, HAT_DECORATIONS);
  /** dx that puts a 300 px wide logo's right edge `past` px beyond the back's. */
  const pastBack = (past: number) => backRight - 150 + past - bx;

  it("takes a logo that fits, to half a pixel past the edge and half a percent over", () => {
    expect(problemV2([placed("front", 900, 450)])).toBeNull();
    expect(problemV2([placed("back", 300, 150, pastBack(0.4))])).toBeNull();
    expect(problemV2([placed("left", 400 * 1.002, 300 * 1.002)])).toBeNull();
    expect(hatPlacements(onV2([placed("front", 900, 450)]))!.misfits).toEqual([]);
  });

  it("refuses a logo bigger than its spot takes, saying the most it takes", () => {
    const msg = problemV2([placed("front", 300, 150), placed("left", 420, 200)]);
    expect(msg).toBe("Your logo on the left side is bigger than the left side can take. The largest it takes is 2 × 1.5 in. Please make it smaller and try again.");
    expect(msg).not.toMatch(/—/);
    // a turned logo is measured by its turned box: the default 80% front logo, turned 15 degrees
    expect(problemV2([placed("front", 720, 360, 0, 15)])).toMatch(/bigger than the front can take/);
  });

  it("refuses a logo that runs past its spot's edge, and leaves text to the spec's size check", () => {
    const over = placed("back", 300, 150, pastBack(2));
    expect(problemV2([over])).toBe(
      "Your logo on the back runs past the edge of the area we can print. Please move it inside and try again.",
    );
    expect(hatPlacements(onV2([over]))!.misfits).toEqual([{ id: "big-back", zone: "back", overhang: expect.closeTo(2, 6), overCap: 0 }]);
    // Text has no size the server can measure: never refused for it.
    const big = { ...text("t", "back"), x: bx / V2.stage.width, y: by / V2.stage.height, fontScale: 0.5 };
    expect(problemV2([placed("front", 300, 150), big])).toBeNull();
  });
});

describe("on a die with whole-panel areas (round E1)", () => {
  // The model build's E1 die, under the id @reel48/designer ships it as.
  const E1 = JSON.parse(readFileSync(new URL("../hat-no-7-v2.golden.json", import.meta.url), "utf8"));
  const V2 = { ...E1, id: "hat-no-7-v2", label: "No. 7" } as HatDie;
  const dieOf = (id: unknown) => (id === V2.id ? V2 : (hatDie(id) as HatDie | null));
  const zone = (id: string) => V2.zones.find((z) => z.id === id)!;
  const anchor = HAT_NO_7_ANCHORS.zonesTo;
  const v2 = (elements: unknown[], zones: Record<string, unknown> = { front: { method: "embroidery" } }) => ({ ...hat(elements, zones), dieId: V2.id });
  const logoAt = (id: string, cx: number, cy: number, wPx: number, hPx = wPx, rotation = 0) => ({
    id,
    type: "logo",
    x: cx / V2.stage.width,
    y: cy / V2.stage.height,
    rotation,
    scale: wPx / V2.stage.width,
    naturalWidth: wPx,
    naturalHeight: hPx,
    mimeType: "image/png",
  });
  const [ex, ey] = (zone("front").area as HatPolygon).holes![0].reduce(
    (s: number[], p: number[], _i: number, all: number[][]) => [s[0] + p[0] / all.length, s[1] + p[1] / all.length],
    [0, 0],
  );
  const problem = (elements: unknown[]) => hatSpotProblem(hatPlacements(v2(elements), dieOf)!, HAT_DECORATIONS);

  it("reads the spot whose area holds the centre, keep-outs and all, else the nearest area", () => {
    for (const z of V2.zones) {
      const [x, y] = anchor[z.id as keyof typeof anchor];
      expect(zoneOfElement({ x: x / V2.stage.width, y: y / V2.stage.height }, V2)?.id).toBe(z.id);
    }
    // Inside an eyelet's keep-out: in no area, nearest the front's.
    expect(distanceToArea(zoneArea(zone("front")), ex, ey)).toBeGreaterThan(50);
    expect(zoneOfElement({ x: ex / V2.stage.width, y: ey / V2.stage.height }, V2)?.id).toBe("front");
    // In the front's rect (its overlay's bounds) but 30 px off its area: still the front's, not stray.
    const left = (zone("front").area as HatPolygon).outline.reduce((m: number[], p: number[]) => (p[0] < m[0] ? p : m));
    const off = { x: (left[0] - 30) / V2.stage.width, y: left[1] / V2.stage.height };
    expect(distanceToArea(zoneArea(zone("front")), left[0] - 30, left[1])).toBeCloseTo(30, 6);
    expect(zoneOfElement(off, V2)?.id).toBe("front");
    expect(strayElement(off, V2)).toBe(false);
    // On the reserved bill top: stray.
    expect(strayElement({ x: 1488 / V2.stage.width, y: 1512 / V2.stage.height }, V2)).toBe(true);
  });

  it("prices and checks a design on the die its dieId names", () => {
    const [fx, fy] = anchor.front;
    const [lx, ly] = anchor.left;
    const [tx, ty] = anchor.label_tall;
    const spots = hatPlacements(v2([logoAt("a", fx, fy, 900, 450), logoAt("b", lx, ly, 400, 300), logoAt("c", tx, ty, 350, 200)]), dieOf)!;
    expect(spots.die).toBe(V2);
    expect(spots.placements.map((p) => p.zone)).toEqual(["front", "left", "label_tall"]);
    expect(spots.extraSpots).toBe(2);
    expect(spots.misfits).toEqual([]);
    expect(hatSpotProblem(spots, HAT_DECORATIONS)).toBeNull();
    // anywhere on the whole panel, low beside the centre seam as Brayden's hats carry it
    expect(problem([logoAt("a", 700, 1150, 300, 150)])).toBeNull();
  });

  it("refuses a logo over an eyelet's keep-out, past the panel, or past the cap", () => {
    expect(problem([logoAt("a", ex, ey + 60, 120)])).toMatch(/front runs past the edge/);
    expect(problem([logoAt("a", 1610, 1150, 200)])).toMatch(/front runs past the edge/);
    // The area takes a 5 in logo; the cap is still 4.5 x 2.25 in.
    expect(problem([logoAt("a", ...(anchor.front as unknown as [number, number]), 1000, 400)])).toMatch(
      /bigger than the front can take\. The largest it takes is 4\.5 × 2\.25 in/,
    );
    expect(problem([logoAt("a", ...(anchor.front as unknown as [number, number]), 300), logoAt("b", ...(anchor.back as unknown as [number, number]), 520, 175)])).toMatch(
      /logo on the back is bigger than the back can take\. The largest it takes is 2\.5 × 0\.875 in/,
    );
  });

  it("confines a piece into its area and under its cap, and keeps one that fits as it is", () => {
    const front = zone("front");
    const ok = logoAt("a", 700, 1150, 300, 150);
    expect(fitsSpot(ok, front, V2)).toBe(true);
    expect(confineElement(ok, front, V2)).toBe(ok);
    for (const el of [logoAt("b", ex, ey + 40, 200), logoAt("c", 1640, 1250, 1100, 500, 20)]) {
      const kept = confineElement(el, front, V2);
      expect(kept).not.toBe(el);
      expect(poseValid(elementPose(kept, V2)!, { area: zoneArea(front), cap: zoneCap(front, V2) }, 1e-3)).toBe(true);
      expect(fitsSpot(el, front, V2)).toBe(false);
      expect(fitsSpot(kept, front, V2)).toBe(true);
      expect(logoMisfit(kept, front, V2)).toBeNull();
      expect(kept.scale).toBeLessThanOrEqual(el.scale);
    }
  });
});

describe("how a line's decoration reads", () => {
  it("names a hat design's primary spot and each extra spot", () => {
    const designJson = hat([logo("a", "front"), logo("b", "left"), text("c", "label_tall")]);
    const s = spotSummary({ decorationType: "embroidery", sideEmbroidery: true, designJson });
    expect(spotLine(s)).toBe("Embroidery front + 2 more spots: left side, inside label");
    const one = spotSummary({ decorationType: "embroidery", sideEmbroidery: true, designJson: hat([logo("a", "back"), logo("b", "front")]) });
    expect(spotLine(one)).toBe("Embroidery front + 1 more spot: back");
  });
  it("leaves a catalog line as it was", () => {
    expect(spotLine(spotSummary({ decorationType: "embroidery", sideEmbroidery: true }))).toBe("Embroidery + side embroidery");
    expect(spotLine(spotSummary({ decorationType: "no_magnet", sideEmbroidery: false, designJson: { size: "standard" } }))).toBe("No Magnet");
  });
});

describe("the No. 7's frame", () => {
  // The dies come from @reel48/designer since v1.11.0 (hat-config.js). These
  // are the numbers every stored hat design is placed, priced and specced
  // against (the model build's die_no7.json, and E1's), so a package release
  // that moves them fails here before it relocates artwork on an order.
  type PkgDie = { measurements: typeof HAT_NO_7_V1_DIE; stage: unknown; productHandle: string; kind: string; supersededBy?: string };
  const pkg = (DIES as Record<string, PkgDie>)["hat-no-7"];
  const V1 = HAT_NO_7_V1_DIE;
  it("is the package's hat-no-7 die, read in the storefront's shape", () => {
    expect(pkg.kind).toBe("hat");
    expect(V1.productHandle).toBe(pkg.productHandle);
    expect(V1.stage).toEqual(pkg.stage);
    expect(V1.zones).toEqual(pkg.measurements.zones);
    expect(V1.reserved).toEqual(pkg.measurements.reserved);
    expect(V1.supersededBy).toBe("hat-no-7-v2");
  });
  it("is pinned: 1560 x 1296 at 200 px/in, these spots and these methods", () => {
    expect(V1.pxPerInch).toBe(200);
    expect(V1.stage).toEqual({ width: 1560, height: 1296 });
    expect(V1.gutterIn).toBe(0.4);
    expect(V1.zones.map((z) => [z.id, z.rect, z.maxImprint, z.methods])).toEqual([
      ["front", { x: 40, y: 40, w: 900, h: 450 }, { w: 4.5, h: 2.25 }, ["embroidery", "pvc_patch", "silicon_patch", "woven_patch"]],
      ["left", { x: 1020, y: 40, w: 400, h: 300 }, { w: 2.0, h: 1.5 }, ["embroidery"]],
      ["right", { x: 1020, y: 420, w: 400, h: 300 }, { w: 2.0, h: 1.5 }, ["embroidery"]],
      ["back", { x: 1020, y: 800, w: 500, h: 175 }, { w: 2.5, h: 0.875 }, ["embroidery"]],
      ["label_tall", { x: 1020, y: 1055, w: 350, h: 200 }, { w: 1.75, h: 1.0 }, ["woven_label"]],
      ["label_square", { x: 720, y: 1000, w: 200, h: 200 }, { w: 1.0, h: 1.0 }, ["woven_label"]],
    ]);
    expect(V1.reserved.map((r) => [r.id, r.rect])).toEqual([
      ["bill_top", { x: 40, y: 1000, w: 600, h: 200 }],
      ["under_bill", { x: 40, y: 570, w: 900, h: 350 }],
    ]);
  });

  // Round E1 (2026-10-21): the die new designs are made on.
  const V2 = HAT_NO_7_DIE;
  const pkg2 = (DIES as Record<string, PkgDie>)["hat-no-7-v2"];
  const E1 = JSON.parse(readFileSync(new URL("../hat-no-7-v2.golden.json", import.meta.url), "utf8"));
  it("makes new designs on the package's hat-no-7-v2, the model build's E1 die, areas and all", () => {
    expect(V2.id).toBe("hat-no-7-v2");
    expect(V2.supersededBy).toBeUndefined();
    expect(V2.productHandle).toBe(pkg2.productHandle);
    expect(V2.productHandle).toBe(V1.productHandle);
    expect(V2.stage).toEqual(pkg2.stage);
    expect(V2.zones).toEqual(pkg2.measurements.zones);
    expect(V2.reserved).toEqual(pkg2.measurements.reserved);
    // the frame the served 3D model's print UVs are on
    expect(V2.stage).toEqual(E1.stage);
    expect(V2.pxPerInch).toBe(E1.pxPerInch);
    expect(V2.zones.map((z) => [z.id, z.rect, z.area, z.maxImprint, z.methods])).toEqual(
      E1.zones.map((z: Record<string, unknown>) => [z.id, z.rect, z.area, z.maxImprint, z.methods]),
    );
  });
  it("is pinned: 3720 x 1808 at 200 px/in, one label, today's caps round whole-panel areas", () => {
    expect(V2.stage).toEqual({ width: 3720, height: 1808 });
    expect(V2.pxPerInch).toBe(200);
    expect(V2.zones.map((z) => [z.id, z.maxImprint, z.methods])).toEqual([
      ["front", { w: 4.5, h: 2.25 }, ["embroidery", "pvc_patch", "silicon_patch", "woven_patch"]],
      ["left", { w: 2.0, h: 1.5 }, ["embroidery"]],
      ["right", { w: 2.0, h: 1.5 }, ["embroidery"]],
      ["back", { w: 2.5, h: 0.875 }, ["embroidery"]],
      ["label_tall", { w: 1.75, h: 1.0 }, ["woven_label"]],
    ]);
    // the front's area is both panels with the two eyelets kept out, a side's its whole panel
    const front = V2.zones.find((z) => z.id === "front")!;
    expect(front.area!.holes).toHaveLength(2);
    expect(V2.zones.find((z) => z.id === "left")!.area!.holes).toHaveLength(1);
    // frozen: a reader can't move the frame under an order
    expect(Object.isFrozen(front.area!.outline)).toBe(true);
  });
  it("reads every design on its own die, the superseded one too, and nothing else", () => {
    expect(Object.keys(HAT_DIES).sort()).toEqual(["hat-no-6", "hat-no-7", "hat-no-7-v2"]);
    expect(hatDie("hat-no-7")).toBe(V1);
    expect(hatDie("hat-no-7-v2")).toBe(V2);
    expect(hatDie("constructor")).toBeNull();
    expect(hatDie(undefined)).toBeNull();
    // a v1 and a v2 design, each priced from its own die's spots
    const onV1 = hat([logo("a", "front"), text("b", "left")]);
    const z = (id: string) => V2.zones.find((zz) => zz.id === id)!;
    const home = (id: string) => {
      const [hx, hy] = HAT_NO_7_ANCHORS.zonesTo[id as keyof typeof HAT_NO_7_ANCHORS.zonesTo];
      return { x: hx / V2.stage.width, y: hy / V2.stage.height };
    };
    const onV2 = {
      ...hat([
        { id: "a", type: "logo", ...home("front"), scale: 0.05, mimeType: "image/png" },
        { id: "b", type: "text", text: "EST", ...home("left"), fontScale: 0.01 },
      ]),
      dieId: V2.id,
    };
    expect(z("front")).toBeDefined();
    for (const doc of [onV1, onV2]) {
      const spots = hatPlacements(doc)!;
      expect(spots.die.id).toBe(doc.dieId);
      expect(spots.placements.map((p) => p.zone)).toEqual(["front", "left"]);
      expect(spots.extraSpots).toBe(1);
      expect(hatSpotProblem(spots, HAT_DECORATIONS)).toBeNull();
    }
    // the same fractions read on the other die are other spots
    expect(hatPlacements({ ...onV1, dieId: V2.id })!.placements.map((p) => p.zone)).not.toEqual(["front", "left"]);
  });
});
