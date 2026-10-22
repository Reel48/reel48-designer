import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIES, dieGeometry, diesOfKind, resolveDie } from "../src/core/dies.js";
import { elementFits, faceAt, faceClipRegion, faceRegions, zoneOfElement } from "../src/core/confine.js";
import { artExportRect } from "../src/core/camera.js";
import { areaHome, overhang, pointInArea, poseValid, rotatedSize } from "../src/core/region.js";
import { designReducer, initialDesignState, moveToZone, toDesignDescription } from "../src/core/design.js";
import * as core from "../src/core/index.js";

// A byte copy of Reel48-Storefront scripts/blender/hat-no7/e1/die_no7.json,
// round E1's whole-panel die (sha256 5c2e73f0…eae34, 2026-10-21). The file
// names its die "hat-no-7", the product's; the package registers it as
// "hat-no-7-v2", because "hat-no-7" is the v1.11.0 frame that documents
// already reference. Everything else must match exactly.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./hat-no-7-v2.golden.json", import.meta.url)), "utf8"),
);

const DIE = DIES["hat-no-7-v2"];
const GEOM = dieGeometry("hat-no-7-v2");
const { width: W, height: H } = DIE.stage;
const zone = (id) => GEOM.zones.find((z) => z.id === id);
const region = (id) => faceRegions(GEOM)[id];
const rectOf = ({ bounds: b }) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
const at = ([x, y]) => ({ x: x / W, y: y / H });
const LOGO = {
  type: "ADD_LOGO", id: "l1", fileName: "mark.png", mimeType: "image/png",
  naturalWidth: 400, naturalHeight: 200,
};
/** An element's pose, native px, for region.js. */
const poseOfLogo = (el) => {
  const w = el.scale * W;
  return { cx: el.x * W, cy: el.y * H, w, h: w * (el.naturalHeight / el.naturalWidth), rotation: el.rotation };
};

describe("the hat-no-7-v2 die", () => {
  it("rebuilds e1/die_no7.json exactly, under its own id", () => {
    const rebuilt = {
      id: GOLDEN.id,
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
        area: z.area,
      })),
      reserved: GEOM.reserved.map((r) => ({ id: r.id, label: r.label, rect: rectOf(r), maxImprint: r.maxImprint })),
      gutterIn: GEOM.gutterIn,
    };
    expect(rebuilt).toEqual(GOLDEN);
    expect(GOLDEN.id).toBe("hat-no-7");
    expect(DIE.id).toBe("hat-no-7-v2");
  });

  it("sits beside the first No. 7 die, which is unchanged and still opens", () => {
    expect(diesOfKind("hat").map((d) => d.id)).toEqual(["hat-no-7", "hat-no-7-v2"]);
    expect(DIES["hat-no-7"].supersededBy).toBe("hat-no-7-v2");
    expect(DIES["hat-no-7"].stage).toEqual({ width: 1560, height: 1296 });
    expect(dieGeometry("hat-no-7").zones.some((z) => z.area)).toBe(false);
    expect(resolveDie("hat-no-7-v2", { kind: "hat" })).toBe(DIE);
    expect(DIE.stage).toEqual({ width: 3720, height: 1808 });
  });

  it("cuts each area with its holes wound against the outline", () => {
    const rings = [];
    for (const c of GEOM.cmds) {
      if (c[0] === "M") rings.push([[c[1], c[2]]]);
      else if (c[0] === "L") rings[rings.length - 1].push([c[1], c[2]]);
    }
    const sign = (r) => Math.sign(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0));
    // front (outline + 2 eyelets), left (+1), right (+1), back, label: 9 rings.
    expect(rings).toHaveLength(9);
    const [front, eyeA, eyeB] = rings;
    expect(sign(eyeA)).toBe(-sign(front));
    expect(sign(eyeB)).toBe(-sign(front));
  });
});

describe("area sides", () => {
  it("are the area and its cap, not a cap-sized box in the rect", () => {
    const front = region("front");
    expect(front.kind).toBe("area");
    expect(front.area).toBe(zone("front").area);
    expect(front.cap).toEqual({ w: 900, h: 450 });
    expect(front.x1 - front.x0).toBeGreaterThan(900); // the whole of both panels
    expect(region("front")).toBe(front); // the same object every time
    expect(faceClipRegion(GEOM, "left")).toBe(region("left"));
  });

  it("reads each zone's home as that zone, and a gutter as the nearest", () => {
    for (const z of GEOM.zones) expect(faceAt(GEOM, DIE.stage, at(areaHome(z.area)))).toBe(z.id);
    expect(faceAt(GEOM, DIE.stage, at([1700, 600]))).toBe("front");
  });

  it("elementFits is inside the area, clear of the holes, and within the cap", () => {
    const [hx, hy] = areaHome(zone("left").area);
    const el = { type: "logo", x: hx / W, y: hy / H, scale: 300 / W, naturalWidth: 2, naturalHeight: 1, rotation: 0 };
    expect(elementFits(GEOM, DIE.stage, el)).toBe(true);
    // 420 x 210: inside the whole panel, but over the 400 px cap.
    expect(elementFits(GEOM, DIE.stage, { ...el, scale: 420 / W })).toBe(false);
    // Centred on the eyelet's keep-out.
    const hole = zone("left").area.holes[0];
    const c = hole.reduce((s, p) => [s[0] + p[0] / hole.length, s[1] + p[1] / hole.length], [0, 0]);
    expect(pointInArea(zone("left").area, c[0], c[1])).toBe(false);
    expect(elementFits(GEOM, DIE.stage, { ...el, scale: 60 / W, x: c[0] / W, y: c[1] / H })).toBe(false);
  });
});

describe("placing on an area", () => {
  const hat = () => initialDesignState("hat-no-7-v2");

  it("fitToZone puts a new logo at the area's home at 80% of the cap", () => {
    const el = designReducer(hat(), { ...LOGO, fitToZone: "front" }).elements[0];
    const [hx, hy] = areaHome(zone("front").area);
    // 2:1 into the 900 x 450 cap: 720 wide, not 80% of the whole panel.
    expect(el.scale * W).toBeCloseTo(720, 6);
    expect(el.x * W).toBeCloseTo(hx, 6);
    expect(el.y * H).toBeCloseTo(hy, 6);
    expect(poseValid(poseOfLogo(el), { area: zone("front").area, cap: region("front").cap })).toBe(true);
  });

  it("keeps an explicit point, then confines it: a logo asked onto an eyelet is moved off it", () => {
    const hole = zone("left").area.holes[0];
    const c = hole.reduce((s, p) => [s[0] + p[0] / hole.length, s[1] + p[1] / hole.length], [0, 0]);
    const el = designReducer(hat(), { ...LOGO, fitToZone: "left", x: c[0] / W, y: c[1] / H }).elements[0];
    const pose = poseOfLogo(el);
    expect(poseValid(pose, { area: zone("left").area, cap: region("left").cap })).toBe(true);
    expect(overhang(pose, { area: zone("left").area, cap: region("left").cap })).toEqual({ area: 0, cap: 0 });
    // Moved only as far as it had to: still near where it was asked.
    expect(Math.hypot(pose.cx - c[0], pose.cy - c[1])).toBeLessThan(400);
  });

  it("an explicit size over the cap is shrunk to it", () => {
    const el = designReducer(hat(), { ...LOGO, fitToZone: "back", scale: 900 / W }).elements[0];
    const e = rotatedSize(el.scale * W, (el.scale * W) / 2, 0);
    expect(e.w).toBeLessThanOrEqual(500 + 1e-6);
    expect(e.h).toBeLessThanOrEqual(175 + 1e-6);
  });

  it("moveToZone scales by the caps and lands inside the new area", () => {
    let s = designReducer(hat(), { ...LOGO, fitToZone: "front" });
    s = moveToZone(s, "front", "left");
    const el = s.elements[0];
    expect(zoneOfElement(GEOM, DIE.stage, el)).toBe("left");
    // 720 x 360 by min(400/900, 300/450) = 4/9: 320 x 160.
    expect(el.scale * W).toBeCloseTo(320, 6);
    expect(poseValid(poseOfLogo(el), { area: zone("left").area, cap: region("left").cap })).toBe(true);
  });

  it("a version 4 document on the new die round-trips", () => {
    let s = hat();
    s = designReducer(s, { type: "SET_ZONE", zone: "front", method: "embroidery", threads: ["1801"] });
    s = designReducer(s, { ...LOGO, fitToZone: "front" });
    s = designReducer(s, { type: "SET_ZONE", zone: "label_tall", ground: "#F5F1E8" });
    const d = toDesignDescription(s);
    expect(d).toMatchObject({ schemaVersion: 4, kind: "hat", dieId: "hat-no-7-v2" });
    expect(d.zones.label_tall).toEqual({ method: "woven_label", shape: "tall", ground: "#F5F1E8" });
    expect(toDesignDescription({ ...JSON.parse(JSON.stringify(d)), selectedId: null })).toEqual(d);
    // There is no square label on this die.
    expect(designReducer(s, { type: "SET_ZONE", zone: "label_tall", shape: "square" })).toBe(s);
  });
});

describe("artExportRect (v1.12.0)", () => {
  it("is v1.8.0's answer without rect or scale", () => {
    expect(artExportRect({ displayW: 372, displayH: 180.8, nativeW: 3720 })).toEqual({
      x: 0, y: 0, width: 372, height: 180.8, pixelRatio: 10,
    });
  });

  it("takes one part of the die, in native px, at a chosen output scale", () => {
    const r = artExportRect({ displayW: 372, displayH: 180.8, nativeW: 3720, rect: { x: 1764, y: 40, w: 912, h: 1292 }, scale: 0.5 });
    expect(r.x).toBeCloseTo(176.4, 9);
    expect(r.y).toBeCloseTo(4, 9);
    expect(r.width).toBeCloseTo(91.2, 9);
    expect(r.height).toBeCloseTo(129.2, 9);
    expect(r.pixelRatio).toBe(5);
    // 91.2 display px at 5 output px each: 456 = 912 die px at half scale.
    expect(r.width * r.pixelRatio).toBeCloseTo(456, 6);
  });

  it("refuses a bad rect or scale", () => {
    const base = { displayW: 372, displayH: 180.8, nativeW: 3720 };
    for (const rect of [{ x: 0, y: 0, w: 0, h: 10 }, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 5 }]) {
      expect(artExportRect({ ...base, rect })).toBeNull();
    }
    for (const scale of [0, -1, NaN, "2"]) expect(artExportRect({ ...base, scale })).toBeNull();
  });
});

it("exports the area rule from core", () => {
  for (const k of ["confinePose", "bandPose", "poseValid", "overhang", "areaHome", "areaRings", "areaBounds", "areaRect", "pointInArea", "rotatedSize", "areaRubberBand"]) {
    expect(typeof core[k], k).toBe("function");
  }
  // confine.js's own band, used by the koozie stage since v1.7.0, is untouched.
  expect(core.rubberBand(30, 24)).not.toBe(core.areaRubberBand(30, 24));
});
