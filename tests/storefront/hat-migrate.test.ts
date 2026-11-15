// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-migrate.test.ts (origin/main d78d90ee); imports point into this package.
/**
 * A No. 7 design moved from the first die (hat-no-7) to round E1's
 * whole-panel die (hat-no-7-v2, 2026-10-21): every piece's centre at the same
 * point on the hat, the same size in inches, the square label's art on the
 * tall label, and every piece valid on the new die. The dies are the real
 * ones: the storefront's hat-no-7 and the model build's E1 die
 * (scripts/blender/hat-no7/e1/die_no7.json) under the id the package ships it
 * as (hat-config.js HAT_NO_7_DIE; tests/hat-placements.test.ts holds the two
 * equal). "The same point on the hat" is checked against E1's shipped surface,
 * from 3-D points read off the first model.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HAT_NO_7_V1_DIE, hatDie } from "../../src/core/hat-config.js";
import { HAT_NO_7_ANCHORS, ZONE_SUCCESSORS, migrateHatDoc, zoneAnchors } from "../../src/core/hat-migrate.js";
import { elementPose, hatPlacements, hatSpotProblem, zoneArea, zoneCap, zoneOfElement } from "../../src/core/hat-placements.js";
import type { HatDie } from "../../src/core/hat-placements.js";
import { poseValid } from "../../src/core/region.js";
import { createSurface } from "../../src/viewer/hat-surface.js";

// Adapted: the storefront's scripts/blender/hat-no7 files are read from the package: the E1 die is tests/hat-no-7-v2.golden.json, the two zones files are byte copies in fixtures/core/, and the shipped surface is models/hat-no-7-surface.json.
const json = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/core/hat-no7-${path.replace("/", "-")}`, import.meta.url), "utf8"));
const V1 = HAT_NO_7_V1_DIE as unknown as HatDie;
const V2 = { ...JSON.parse(readFileSync(new URL("../hat-no-7-v2.golden.json", import.meta.url), "utf8")), id: "hat-no-7-v2", label: "No. 7" } as HatDie;
const dieOf = (id: unknown) => (id === V2.id ? V2 : (hatDie(id) as HatDie | null));
const MIGRATE = { from: V1, to: V2, ...HAT_NO_7_ANCHORS };
const DECOS = ["embroidery", "pvc_patch", "silicon_patch", "woven_patch"];

type El = Record<string, unknown> & { id: string; x: number; y: number };
const zoneOf = (die: HatDie, id: string) => die.zones.find((z) => z.id === id)!;
const rectCentre = (die: HatDie, id: string) => {
  const r = zoneOf(die, id).rect;
  return [r.x + r.w / 2, r.y + r.h / 2];
};

/** A logo on the first die at die px (cx, cy), `wIn` x `hIn` inches. */
function logoAt(id: string, cx: number, cy: number, wIn: number, hIn: number, rotation = 0): El {
  return {
    id,
    type: "logo",
    x: cx / V1.stage.width,
    y: cy / V1.stage.height,
    rotation,
    opacity: 1,
    fileName: "Acme.png",
    mimeType: "image/png",
    naturalWidth: Math.round(wIn * 1000),
    naturalHeight: Math.round(hIn * 1000),
    scale: (wIn * V1.pxPerInch) / V1.stage.width,
  };
}
const textAt = (id: string, cx: number, cy: number): El => ({
  id,
  type: "text",
  x: cx / V1.stage.width,
  y: cy / V1.stage.height,
  rotation: 0,
  opacity: 1,
  text: "EST 1999",
  fontFamily: "Arial, sans-serif",
  fontStyle: "normal",
  fill: "#FFFFFF",
  align: "center",
  fontScale: 0.03,
});
function v1Doc(elements: El[], zones: Record<string, unknown> = { front: { method: "embroidery" } }) {
  return { schemaVersion: 4, kind: "hat", dieId: "hat-no-7", parts: { crown_FL: "#1F2A44" }, zones, elements, selectedId: null };
}
/** A migrated element's centre on the new die, die px. */
const at2 = (el: El) => [el.x * V2.stage.width, el.y * V2.stage.height];
const find = (doc: { elements: El[] }, id: string) => doc.elements.find((e) => e.id === id)!;
/** Whether a migrated element keeps its spot's area and cap on the new die. */
function validOnV2(el: El) {
  const zone = zoneOfElement(el, V2)!;
  return poseValid(elementPose(el, V2)!, { area: zoneArea(zone), cap: zoneCap(zone, V2) }, 1e-3);
}

describe("the anchors", () => {
  it("are read from the model build's zones files", () => {
    const from = zoneAnchors(json("zones_no7.json"));
    const to = zoneAnchors(json("e1/zones_no7.json"));
    for (const [map, want] of [
      [from, HAT_NO_7_ANCHORS.zonesFrom],
      [to, HAT_NO_7_ANCHORS.zonesTo],
    ] as const) {
      expect(Object.keys(map).sort()).toEqual(Object.keys(want).sort());
      for (const [id, [x, y]] of Object.entries(want)) {
        expect(map[id][0]).toBeCloseTo(x, 9);
        expect(map[id][1]).toBeCloseTo(y, 9);
      }
    }
  });
  it("are each first-die spot's rect centre, and the E1 back is today's centre below its raised one", () => {
    for (const z of V1.zones) expect(HAT_NO_7_ANCHORS.zonesFrom[z.id as keyof typeof HAT_NO_7_ANCHORS.zonesFrom]).toEqual(rectCentre(V1, z.id));
    // 2.4 mm up the back seam: the E1 back's chart origin is (359, 1549.5).
    expect(HAT_NO_7_ANCHORS.zonesTo.back[0]).toBe(359);
    expect(HAT_NO_7_ANCHORS.zonesTo.back[1] - 1549.5).toBeCloseTo(2.4 * (200 / 25.4), 3);
    // label_tall and every successor are on the new die; label_square is not.
    expect(V2.zones.map((z) => z.id)).toEqual(["front", "left", "right", "back", "label_tall"]);
    expect(ZONE_SUCCESSORS).toEqual({ label_square: "label_tall" });
  });
  it("lie inside their spot's area on the new die", () => {
    for (const z of V2.zones) {
      const [x, y] = HAT_NO_7_ANCHORS.zonesTo[z.id as keyof typeof HAT_NO_7_ANCHORS.zonesTo];
      expect(zoneOfElement({ x: x / V2.stage.width, y: y / V2.stage.height }, V2)?.id).toBe(z.id);
    }
  });
});

/**
 * First-die points inside each old rect (inset 5% on the front, 10% elsewhere)
 * and the model point (metres, the hotspot frame) the first model printed each
 * at: hat-surface.js createSurface(...).dieToModel on the first model's surface
 * (public/3d/hats/hat-no7.ab4afb7d.glb at d7d96bf, before E1 replaced it, run
 * through scripts/blender/hat-no7/lab/extract_surface.mjs on its 1560 x 1296
 * frame). [old spot, die x, die y, X, Y, Z].
 */
const FIRST_MODEL: [string, number, number, number, number, number][] = [
  ["front", 85, 62.5, -0.0478874, 0.0460615, 0.0300193],
  ["front", 186.25, 62.5, -0.0367782, 0.0490006, 0.0357941],
  ["front", 287.5, 62.5, -0.0250193, 0.0513924, 0.040446],
  ["front", 388.75, 62.5, -0.0127643, 0.0532314, 0.0438394],
  ["front", 490, 62.5, 0.0000143, 0.053923, 0.0451047],
  ["front", 591.25, 62.5, 0.0128215, 0.0532592, 0.0439201],
  ["front", 692.5, 62.5, 0.0250717, 0.0513486, 0.0404605],
  ["front", 793.75, 62.5, 0.0367297, 0.0488595, 0.0356701],
  ["front", 895, 62.5, 0.0479966, 0.0460385, 0.0301511],
  ["front", 85, 163.75, -0.048259, 0.0349974, 0.0365915],
  ["front", 186.25, 163.75, -0.0371367, 0.0380172, 0.0424925],
  ["front", 287.5, 163.75, -0.0253198, 0.0405106, 0.0472917],
  ["front", 388.75, 163.75, -0.0129268, 0.042405, 0.0508727],
  ["front", 490, 163.75, 0.0000212, 0.043087, 0.0522062],
  ["front", 591.25, 163.75, 0.0129584, 0.04237, 0.0508718],
  ["front", 692.5, 163.75, 0.0253465, 0.040464, 0.047303],
  ["front", 793.75, 163.75, 0.0371667, 0.0379761, 0.0425192],
  ["front", 895, 163.75, 0.0483955, 0.0350493, 0.0368451],
  ["front", 85, 265, -0.0482552, 0.0235638, 0.0424596],
  ["front", 186.25, 265, -0.0371843, 0.0266175, 0.0484382],
  ["front", 287.5, 265, -0.0253835, 0.0291087, 0.0533137],
  ["front", 388.75, 265, -0.0129721, 0.0309835, 0.0569578],
  ["front", 490, 265, -0.0000041, 0.031608, 0.0581608],
  ["front", 591.25, 265, 0.0129662, 0.03098, 0.0569514],
  ["front", 692.5, 265, 0.0254172, 0.0291289, 0.0534305],
  ["front", 793.75, 265, 0.0372057, 0.0266041, 0.0485579],
  ["front", 895, 265, 0.0483132, 0.0235824, 0.0426687],
  ["front", 85, 366.25, -0.0479264, 0.0118437, 0.0477098],
  ["front", 186.25, 366.25, -0.0369945, 0.0149667, 0.0539043],
  ["front", 287.5, 366.25, -0.025284, 0.017483, 0.0588369],
  ["front", 388.75, 366.25, -0.0128944, 0.019236, 0.0622915],
  ["front", 490, 366.25, 9e-7, 0.0198033, 0.0634154],
  ["front", 591.25, 366.25, 0.0128976, 0.0192325, 0.0623131],
  ["front", 692.5, 366.25, 0.0253096, 0.0174865, 0.0589322],
  ["front", 793.75, 366.25, 0.0370196, 0.0149689, 0.0540525],
  ["front", 895, 366.25, 0.0479907, 0.0118875, 0.0479711],
  ["front", 85, 467.5, -0.0472975, -0.0001217, 0.0523933],
  ["front", 186.25, 467.5, -0.0366146, 0.0030651, 0.0588676],
  ["front", 287.5, 467.5, -0.0250324, 0.0056031, 0.0638582],
  ["front", 388.75, 467.5, -0.0127343, 0.0072459, 0.067088],
  ["front", 490, 467.5, 0.0000173, 0.0078511, 0.0682177],
  ["front", 591.25, 467.5, 0.0127447, 0.0073173, 0.0672125],
  ["front", 692.5, 467.5, 0.0250145, 0.0056254, 0.0639519],
  ["front", 793.75, 467.5, 0.0366259, 0.0031054, 0.0590086],
  ["front", 895, 467.5, 0.047358, -0.0000749, 0.0526555],
  ["left", 1060, 70, 0.076309, 0.0392809, -0.0072407],
  ["left", 1220, 70, 0.0798633, 0.039337, -0.0272873],
  ["left", 1380, 70, 0.0816318, 0.038909, -0.0475564],
  ["left", 1060, 190, 0.0806646, 0.0246662, -0.0065324],
  ["left", 1220, 190, 0.0847546, 0.024895, -0.0264914],
  ["left", 1380, 190, 0.0864558, 0.0244083, -0.0468255],
  ["left", 1060, 310, 0.0833901, 0.0096326, -0.0061395],
  ["left", 1220, 310, 0.0882623, 0.0100332, -0.0258884],
  ["left", 1380, 310, 0.0900392, 0.0095841, -0.0461731],
  ["right", 1060, 450, -0.0822397, 0.0379975, -0.049693],
  ["right", 1220, 450, -0.0806054, 0.0384299, -0.0293965],
  ["right", 1380, 450, -0.077026, 0.0382954, -0.0093753],
  ["right", 1060, 570, -0.0870343, 0.023521, -0.049017],
  ["right", 1220, 570, -0.0855191, 0.023972, -0.0286857],
  ["right", 1380, 570, -0.0813162, 0.0236505, -0.0087187],
  ["right", 1060, 690, -0.0906024, 0.0086568, -0.0483977],
  ["right", 1220, 690, -0.088864, 0.0090522, -0.0281278],
  ["right", 1380, 690, -0.084504, 0.0087354, -0.0082411],
  ["back", 1070, 817.5, 0.0251805, 0.0594103, -0.1146626],
  ["back", 1270, 817.5, -0.0000261, 0.0618805, -0.117461],
  ["back", 1470, 817.5, -0.025198, 0.0595595, -0.1148591],
  ["back", 1070, 887.5, 0.025115, 0.0525673, -0.1203551],
  ["back", 1270, 887.5, -0.0000174, 0.0553265, -0.1234896],
  ["back", 1470, 887.5, -0.0253115, 0.0532161, -0.1211046],
  ["back", 1070, 957.5, 0.0249535, 0.0454967, -0.1257021],
  ["back", 1270, 957.5, -0.0000591, 0.048228, -0.1288972],
  ["back", 1470, 957.5, -0.0252643, 0.0464782, -0.1269439],
  ["label_tall", 1055, 1075, -0.0827837, 0.0110953, -0.0576813],
  ["label_tall", 1195, 1075, -0.0774657, 0.0111745, -0.0745895],
  ["label_tall", 1335, 1075, -0.0705058, 0.0110935, -0.0909197],
  ["label_tall", 1055, 1155, -0.0841459, 0.0010158, -0.0581279],
  ["label_tall", 1195, 1155, -0.078601, 0.0011028, -0.074971],
  ["label_tall", 1335, 1155, -0.0719346, 0.0010688, -0.0914751],
  ["label_tall", 1055, 1235, -0.0850527, -0.009088, -0.0584426],
  ["label_tall", 1195, 1235, -0.0791839, -0.0090348, -0.0752018],
  ["label_tall", 1335, 1235, -0.0728221, -0.0090432, -0.0918051],
  ["label_square", 740, 1020, -0.080965, 0.0109591, -0.0650001],
  ["label_square", 820, 1020, -0.0775236, 0.0109492, -0.0745716],
  ["label_square", 900, 1020, -0.0736494, 0.0109482, -0.0839815],
  ["label_square", 740, 1100, -0.0821734, 0.0008618, -0.0654921],
  ["label_square", 820, 1100, -0.0786233, 0.0008655, -0.074989],
  ["label_square", 900, 1100, -0.0750174, 0.0008637, -0.0844674],
  ["label_square", 740, 1180, -0.0827731, -0.0092938, -0.0656881],
  ["label_square", 820, 1180, -0.0791813, -0.0092683, -0.0751987],
  ["label_square", 900, 1180, -0.0757095, -0.0092801, -0.084759],
];

describe("the same point on the hat", () => {
  const e1 = createSurface(JSON.parse(readFileSync("models/hat-no-7-surface.json", "utf8")));
  /** For each reference point, how far (mm) its piece lands from it on E1, migrated with `opts`. */
  function drift(opts: Omit<typeof MIGRATE, "grids"> & { grids: Record<string, object> }) {
    const elements = FIRST_MODEL.map(([, x, y], i) => logoAt(`p${i}`, x, y, 0.05, 0.05));
    const out = migrateHatDoc(v1Doc(elements, {}), opts)!;
    return FIRST_MODEL.map(([zone, x, y, ...ref], i) => {
      const el = find(out, `p${i}`);
      const target = zone === "label_square" ? "label_tall" : zone;
      expect(zoneOfElement(el, V2)?.id).toBe(target);
      expect(validOnV2(el)).toBe(true);
      const p = e1.dieToModel(target, ...(at2(el) as [number, number]));
      expect(p, `${zone} ${x} ${y}`).not.toBeNull();
      return { zone, at: [x, y], mm: 1000 * Math.hypot(p![0] - ref[0], p![1] - ref[1], p![2] - ref[2]) };
    });
  }
  const worst = (rows: { zone: string; mm: number }[], keep: (zone: string) => boolean) =>
    Math.max(...rows.filter((r) => keep(r.zone)).map((r) => r.mm));

  // Over the whole of each old rect: 0.25 mm on the front (0.17 at these
  // points), 0.25 on the sides and back, 0.61 on the label (hat-migrate.js).
  it("is within 0.25 mm on the front and 0.65 mm everywhere else", () => {
    const rows = drift(MIGRATE);
    expect(worst(rows, (z) => z === "front")).toBeLessThan(0.25);
    expect(worst(rows, (z) => z !== "front")).toBeLessThan(0.65);
  });

  it("needs the front's correction: the offset alone lands over 3 mm off toward the old front's sides", () => {
    const rows = drift({ ...MIGRATE, grids: {} });
    expect(worst(rows, (z) => z === "front")).toBeGreaterThan(3);
    // The other spots never needed one.
    expect(worst(rows, (z) => z !== "front")).toBeLessThan(0.65);
  });

  it("refuses a correction that is not a grid", () => {
    const doc = v1Doc([logoAt("a", 490, 265, 2, 1)]);
    expect(() => migrateHatDoc(doc, { ...MIGRATE, grids: { front: { x0: 40, y0: 40, step: 75, cols: 13, rows: 7, d: [1, 2] } } })).toThrow(
      /correction for the front spot/,
    );
  });
});

describe("moving a design to the E1 die", () => {
  it("puts a front logo at today's centre on the new front's centre point, the same size in inches", () => {
    const [cx, cy] = rectCentre(V1, "front");
    const out = migrateHatDoc(v1Doc([logoAt("a", cx, cy, 3, 1.5)]), MIGRATE)!;
    const a = find(out, "a");
    const [x, y] = at2(a);
    expect(x).toBeCloseTo(874.853, 6);
    expect(y).toBeCloseTo(957.004, 6);
    expect(((a.scale as number) * V2.stage.width) / V2.pxPerInch).toBeCloseTo(3, 9);
    expect(a.rotation).toBe(0);
    expect(validOnV2(a)).toBe(true);
  });

  it("keeps a side logo's offset from its centre, in die px (same px/in)", () => {
    const [lx, ly] = rectCentre(V1, "left");
    const [rx, ry] = rectCentre(V1, "right");
    const out = migrateHatDoc(
      v1Doc([logoAt("l", lx + 60, ly + 40, 1.2, 0.8, 10), logoAt("r", rx - 50, ry - 30, 1, 1)], {}),
      MIGRATE,
    )!;
    const [x1, y1] = at2(find(out, "l"));
    expect(x1 - 2227.128).toBeCloseTo(60, 6);
    expect(y1 - 940.336).toBeCloseTo(40, 6);
    expect(find(out, "l").rotation).toBe(10);
    const [x2, y2] = at2(find(out, "r"));
    expect(x2 - 3226.101).toBeCloseTo(-50, 6);
    expect(y2 - 925.402).toBeCloseTo(-30, 6);
    expect(out.elements.every(validOnV2)).toBe(true);
  });

  it("keeps a back logo where it was on the hat, confined up into the raised back when it would overhang", () => {
    const [bx, by] = rectCentre(V1, "back");
    const out = migrateHatDoc(v1Doc([logoAt("small", bx, by - 20, 1, 0.3), logoAt("max", bx, by, 2.5, 0.875)]), MIGRATE)!;
    const [sx, sy] = at2(find(out, "small"));
    expect(sx).toBeCloseTo(359, 6);
    expect(sy).toBeCloseTo(1568.3976 - 20, 3);
    // The largest back logo, centred where today's was: its bottom would sit
    // 1656.4, past the area's 1647, so it moves up by the difference.
    const max = find(out, "max");
    const [mx, my] = at2(max);
    expect(mx).toBeCloseTo(359, 6);
    expect(my).toBeCloseTo(1647 - 87.5, 6);
    expect(((max.scale as number) * V2.stage.width) / V2.pxPerInch).toBeCloseTo(2.5, 9);
    expect(out.elements.every(validOnV2)).toBe(true);
  });

  it("moves square-label art onto the tall label, fitted, with the label's choices", () => {
    const [qx, qy] = rectCentre(V1, "label_square");
    const doc = v1Doc([logoAt("f", ...(rectCentre(V1, "front") as [number, number]), 2, 1), logoAt("q", qx + 10, qy - 5, 0.9, 0.9)], {
      front: { method: "embroidery" },
      label_square: { method: "woven_label", shape: "square", ground: "#1F2A44" },
    });
    const out = migrateHatDoc(doc, MIGRATE)!;
    const q = find(out, "q");
    const [x, y] = at2(q);
    expect(x).toBeCloseTo(933 + 10, 6);
    expect(y).toBeCloseTo(1512 - 5, 6);
    expect(((q.scale as number) * V2.stage.width) / V2.pxPerInch).toBeCloseTo(0.9, 9);
    expect(zoneOfElement(q, V2)?.id).toBe("label_tall");
    expect(validOnV2(q)).toBe(true);
    expect(out.zones).toEqual({ front: { method: "embroidery" }, label_tall: { method: "woven_label", shape: "tall", ground: "#1F2A44" } });
    expect(hatSpotProblem(hatPlacements(out, dieOf)!, DECOS)).toBeNull();
  });

  it("moves text by its centre and keeps its size in inches", () => {
    const [cx, cy] = rectCentre(V1, "left");
    const out = migrateHatDoc(v1Doc([logoAt("a", ...(rectCentre(V1, "front") as [number, number]), 2, 1), textAt("t", cx, cy + 30)]), MIGRATE)!;
    const t = find(out, "t");
    const [x, y] = at2(t);
    expect(x).toBeCloseTo(2227.128, 6);
    expect(y).toBeCloseTo(940.336 + 30, 6);
    expect(((t.fontScale as number) * V2.stage.width) / V2.pxPerInch).toBeCloseTo((0.03 * V1.stage.width) / V1.pxPerInch, 9);
  });

  it("names the new die and keeps the rest of the document", () => {
    const doc = v1Doc([logoAt("a", ...(rectCentre(V1, "front") as [number, number]), 2, 1)]);
    const out = migrateHatDoc(doc, MIGRATE)!;
    expect(out.dieId).toBe("hat-no-7-v2");
    expect(out).toMatchObject({ schemaVersion: 4, kind: "hat", parts: { crown_FL: "#1F2A44" }, selectedId: null });
    expect(doc.dieId).toBe("hat-no-7"); // not mutated
    // already on the new die: itself; not a design on the first die: null
    expect(migrateHatDoc(out, MIGRATE)).toBe(out);
    expect(migrateHatDoc({ ...doc, dieId: "hat-no-9" }, MIGRATE)).toBeNull();
    expect(migrateHatDoc(null as never, MIGRATE)).toBeNull();
  });

  it("refuses a die pair it has no anchors for", () => {
    const doc = v1Doc([logoAt("a", ...(rectCentre(V1, "front") as [number, number]), 2, 1)]);
    const noFront = Object.fromEntries(Object.entries(HAT_NO_7_ANCHORS.zonesTo).filter(([id]) => id !== "front"));
    expect(() => migrateHatDoc(doc, { ...MIGRATE, zonesTo: noFront })).toThrow(/No anchor for the front/);
  });

  it("leaves every piece valid on the new die, and does it the same way every time", () => {
    // A small seeded PRNG (mulberry32), so a failure reproduces.
    let seed = 7;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let round = 0; round < 40; round++) {
      const elements: El[] = [];
      for (const z of V1.zones) {
        // A piece anywhere a first-die design could hold it: inside its rect, within its cap, turned a little.
        const cap = z.maxImprint;
        const wIn = cap.w * (0.15 + 0.85 * rnd());
        const hIn = Math.min(cap.h, wIn * (0.2 + rnd()));
        const rot = rnd() < 0.5 ? 0 : (rnd() - 0.5) * 20;
        const r = z.rect;
        const cx = r.x + r.w * (0.1 + 0.8 * rnd());
        const cy = r.y + r.h * (0.1 + 0.8 * rnd());
        if (z.id === "label_tall") continue; // one label shape a design
        elements.push(logoAt(`${z.id}-${round}`, cx, cy, wIn, hIn, rot));
      }
      elements.push(textAt(`t-${round}`, ...(rectCentre(V1, "back") as [number, number])));
      const doc = v1Doc(elements, { front: { method: "embroidery" }, label_square: { method: "woven_label", shape: "square" } });
      const out = migrateHatDoc(doc, MIGRATE)!;
      expect(migrateHatDoc(doc, MIGRATE)).toEqual(out);
      for (const el of out.elements) expect(validOnV2(el), `${el.id} ${JSON.stringify(at2(el))}`).toBe(true);
      const spots = hatPlacements(out, dieOf)!;
      expect(spots.stray).toBe(0);
      expect(spots.misfits).toEqual([]);
      expect(hatSpotProblem(spots, DECOS)).toBeNull();
      // each piece stays on its own spot (the square label's on the tall one)
      for (const el of out.elements) {
        const was = zoneOfElement(find(doc, el.id), V1)!.id;
        expect(zoneOfElement(el, V2)?.id).toBe(was === "label_square" ? "label_tall" : was);
      }
    }
  });
});
