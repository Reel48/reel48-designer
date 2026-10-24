import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIES, dieGeometry, diesOfKind, resolveDie } from "../src/core/dies.js";
import { elementFits, faceAt, faceRegions, zoneOfElement } from "../src/core/confine.js";
import { areaHome, poseValid } from "../src/core/region.js";
import { designReducer, initialDesignState, moveToZone, toDesignDescription } from "../src/core/design.js";

// A byte copy of Reel48-Storefront scripts/blender/hat-no6/die_no6.json, the
// No. 6's die (sha256 db9cfd2c…f5bde0c, 2026-10-23), signed off with its model
// on 2026-10-24. The package registers it under the file's own id.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./hat-no-6.golden.json", import.meta.url)), "utf8"),
);

const DIE = DIES["hat-no-6"];
const GEOM = dieGeometry("hat-no-6");
const { width: W, height: H } = DIE.stage;
const zone = (id) => GEOM.zones.find((z) => z.id === id);
const rectOf = ({ bounds: b }) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
const at = ([x, y]) => ({ x: x / W, y: y / H });
const LOGO = {
  type: "ADD_LOGO", id: "l1", fileName: "mark.png", mimeType: "image/png",
  naturalWidth: 400, naturalHeight: 200,
};
const poseOfLogo = (el) => {
  const w = el.scale * W;
  return { cx: el.x * W, cy: el.y * H, w, h: w * (el.naturalHeight / el.naturalWidth), rotation: el.rotation };
};

describe("the hat-no-6 die", () => {
  it("rebuilds die_no6.json exactly, levels included", () => {
    const rebuilt = {
      id: DIE.id,
      kind: DIE.kind,
      productHandle: DIE.productHandle,
      status: DIE.status,
      pxPerInch: GEOM.pxPerInch,
      stage: DIE.stage,
      zones: GEOM.zones.map((z) => ({
        id: z.id,
        label: z.label,
        rect: rectOf(z),
        maxImprint: z.maxImprint,
        methods: z.methods,
        level: z.level,
        area: z.area,
      })),
      reserved: GEOM.reserved.map((r) => ({ id: r.id, label: r.label, rect: rectOf(r), maxImprint: r.maxImprint })),
      gutterIn: GEOM.gutterIn,
    };
    expect(rebuilt).toEqual(GOLDEN);
  });

  it("is the No. 6's own style beside both No. 7 dies, which are unchanged", () => {
    expect(diesOfKind("hat").map((d) => d.id)).toEqual(["hat-no-7", "hat-no-7-v2", "hat-no-6"]);
    expect(DIE).toMatchObject({ kind: "hat", label: "No. 6", productHandle: "no-6" });
    expect(DIE.supersededBy).toBeUndefined();
    expect(resolveDie("hat-no-6", { kind: "hat" })).toBe(DIE);
    expect(() => resolveDie("hat-no-6", { kind: "koozie" })).toThrow();
    // The No. 7's dies carry no level: their geometry is as v1.12.0 made it.
    for (const id of ["hat-no-7", "hat-no-7-v2"]) {
      expect(dieGeometry(id).zones.some((z) => "level" in z), id).toBe(false);
    }
  });

  it("levels the sides by the model's bottom edges, and nothing else", () => {
    expect(Object.fromEntries(GEOM.zones.map((z) => [z.id, z.level]))).toEqual({
      front: 0, left: -6, right: 6, back: 0, label_tall: 0,
    });
  });

  it("cuts each area with its eyelet keep-outs wound against the outline", () => {
    const rings = [];
    for (const c of GEOM.cmds) {
      if (c[0] === "M") rings.push([[c[1], c[2]]]);
      else if (c[0] === "L") rings[rings.length - 1].push([c[1], c[2]]);
    }
    // front (no eyelets on the No. 6's front), left (+1), right (+1), back (+2), label: 9 rings.
    expect(rings).toHaveLength(9);
    const sign = (r) => Math.sign(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0));
    const [, left, leftEye, right, rightEye, back, backEyeA, backEyeB] = rings;
    expect(sign(leftEye)).toBe(-sign(left));
    expect(sign(rightEye)).toBe(-sign(right));
    expect(sign(backEyeA)).toBe(-sign(back));
    expect(sign(backEyeB)).toBe(-sign(back));
  });
});

describe("placing on the No. 6", () => {
  const hat = () => initialDesignState("hat-no-6");

  it("reads each zone's home as that zone, inside its area and under its cap", () => {
    const caps = { front: [900, 450], left: [400, 300], right: [400, 300], back: [500, 175], label_tall: [350, 200] };
    for (const z of GEOM.zones) {
      expect(faceAt(GEOM, DIE.stage, at(areaHome(z.area))), z.id).toBe(z.id);
      expect(faceRegions(GEOM)[z.id].cap, z.id).toEqual({ w: caps[z.id][0], h: caps[z.id][1] });
    }
  });

  it("fits a new logo inside each area, and moves one between spots by the caps", () => {
    let s = designReducer(hat(), { ...LOGO, fitToZone: "front" });
    const el = s.elements[0];
    expect(elementFits(GEOM, DIE.stage, el)).toBe(true);
    expect(poseValid(poseOfLogo(el), { area: zone("front").area, cap: faceRegions(GEOM).front.cap })).toBe(true);
    s = moveToZone(s, "front", "back");
    expect(zoneOfElement(GEOM, DIE.stage, s.elements[0])).toBe("back");
    expect(elementFits(GEOM, DIE.stage, s.elements[0])).toBe(true);
  });

  it("a version 4 document on it round-trips, with the rectangle label only", () => {
    let s = hat();
    s = designReducer(s, { type: "SET_ZONE", zone: "front", method: "embroidery" });
    s = designReducer(s, { ...LOGO, fitToZone: "front" });
    s = designReducer(s, { type: "SET_ZONE", zone: "label_tall", ground: "#F5F1E8" });
    const d = toDesignDescription(s);
    expect(d).toMatchObject({ schemaVersion: 4, kind: "hat", dieId: "hat-no-6" });
    expect(d.zones.label_tall).toEqual({ method: "woven_label", shape: "tall", ground: "#F5F1E8" });
    expect(toDesignDescription({ ...JSON.parse(JSON.stringify(d)), selectedId: null })).toEqual(d);
    expect(designReducer(s, { type: "SET_ZONE", zone: "label_tall", shape: "square" })).toBe(s);
  });
});
