import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIES, dieGeometry, diesOfKind, nearestZone, resolveDie } from "../src/core/dies.js";
import {
  elementFits,
  faceAt,
  faceClipRegion,
  faceRegions,
  zoneOfElement,
} from "../src/core/confine.js";
import { focusRects } from "../src/core/camera.js";
import { magnetRect } from "../src/core/magnet.js";
import {
  ZONED_SCHEMA_VERSION,
  designDie,
  designReducer,
  historyReducer,
  initialDesignState,
  initialHistoryState,
  moveToZone,
  toDesignDescription,
} from "../src/core/design.js";
import * as core from "../src/core/index.js";

// A byte copy of Reel48-Storefront scripts/blender/hat-no7/die_no7.json, the
// die the No. 7 model build (step 05z) wrote: sha256 81cba6b8…3af9 on
// 2026-10-20. The model's print UVs are this frame, so the package must
// reproduce it exactly. Once an order exists against it, it is pinned like the
// koozie frames (README, "Stage frames are pinned"). Until then a new 05z run
// after the fit test replaces both this file and src/core/hats.js together.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./hat-no-7.golden.json", import.meta.url)), "utf8"),
);

const DIE = DIES["hat-no-7"];
const GEOM = dieGeometry("hat-no-7");
const { width: W, height: H } = DIE.stage;
const zone = (id) => GEOM.zones.find((z) => z.id === id);
const centre = (id) => {
  const b = zone(id).bounds;
  return { x: (b.x0 + b.x1) / 2 / W, y: (b.y0 + b.y1) / 2 / H };
};
const rectOf = ({ bounds: b }) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

describe("the hat-no-7 die", () => {
  it("rebuilds die_no7.json exactly", () => {
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
      })),
      reserved: GEOM.reserved.map((r) => ({ id: r.id, label: r.label, rect: rectOf(r), maxImprint: r.maxImprint })),
      gutterIn: GEOM.gutterIn,
    };
    expect(rebuilt).toEqual(GOLDEN);
  });

  it("is a hat, found by kind, and never falls back to a koozie", () => {
    expect(resolveDie("hat-no-7", { kind: "hat" })).toBe(DIE);
    expect(() => resolveDie("hat-no-7", { kind: "koozie" })).toThrow();
    expect(diesOfKind("hat").map((d) => d.id)).toEqual(["hat-no-7", "hat-no-7-v2", "hat-no-6"]);
    expect(diesOfKind("koozie").map((d) => d.id)).toEqual(["koozie-standard", "koozie-slim"]);
  });

  it("has each zone's rect equal to its max imprint, inside the stage, with the gutters between", () => {
    const k = GEOM.pxPerInch;
    const all = [...GEOM.zones, ...GEOM.reserved];
    for (const z of all) {
      const r = rectOf(z);
      expect(r.w, z.id).toBeCloseTo(z.maxImprint.w * k, 9);
      expect(r.h, z.id).toBeCloseTo(z.maxImprint.h * k, 9);
      expect(z.bounds.x0 >= 0 && z.bounds.y0 >= 0 && z.bounds.x1 <= W && z.bounds.y1 <= H, z.id).toBe(true);
    }
    const gutter = GEOM.gutterIn * k;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i].bounds;
        const b = all[j].bounds;
        const gap = Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
        expect(gap, `${all[i].id} / ${all[j].id}`).toBeGreaterThanOrEqual(gutter);
      }
    }
  });

  it("draws one rect island per zone and keeps the reserved rects out of the cut", () => {
    expect(GEOM.cmds.filter((c) => c[0] === "M")).toHaveLength(GEOM.zones.length);
    expect(GEOM.zones.map((z) => z.id)).toEqual(["front", "left", "right", "back", "label_tall", "label_square"]);
    expect(Object.keys(focusRects(GEOM))).toEqual(GEOM.zones.map((z) => z.id));
    expect(zone("label_tall").shape).toBe("tall");
    expect(zone("label_square").shape).toBe("square");
    expect(zone("front").shape).toBeUndefined();
  });

  it("has no magnet, though it has a zone named back", () => {
    expect(zone("back")).toBeTruthy();
    expect(magnetRect(GEOM)).toBeNull();
  });
});

describe("hat sides are its zones", () => {
  it("faceRegions and faceClipRegion are the zone rects, by id", () => {
    const regions = faceRegions(GEOM);
    expect(Object.keys(regions)).toEqual(GEOM.zones.map((z) => z.id));
    const { x0, y0, x1, y1 } = zone("left").bounds;
    expect(regions.left).toEqual({ kind: "rect", x0, y0, x1, y1 });
    expect(faceClipRegion(GEOM, "left")).toEqual({ kind: "rect", x0, y0, x1, y1 });
    expect(faceClipRegion(GEOM, "bill_top")).toBeNull();
  });

  it("faceAt reads each zone's centre as that zone, and a gutter as the nearest", () => {
    for (const z of GEOM.zones) expect(faceAt(GEOM, DIE.stage, centre(z.id))).toBe(z.id);
    // 10 px right of the front's edge, in the 80 px gutter before the left side.
    expect(faceAt(GEOM, DIE.stage, { x: 950 / W, y: 100 / H })).toBe("front");
    expect(faceAt(GEOM, DIE.stage, { x: 1010 / W, y: 100 / H })).toBe("left");
    // Off the stage entirely still has a nearest zone.
    expect(nearestZone(GEOM, 1.2, -0.1, DIE.stage).id).toBe("left");
  });

  it("an element's zone is its centre's, or the zone it is trimmed to", () => {
    const el = { type: "logo", ...centre("right"), scale: 0.1, naturalWidth: 2, naturalHeight: 1, rotation: 0 };
    expect(zoneOfElement(GEOM, DIE.stage, el)).toBe("right");
    expect(zoneOfElement(GEOM, DIE.stage, { ...el, clip: "back" })).toBe("back");
  });

  it("elementFits measures a logo by its turned box against the zone's imprint", () => {
    // The left zone is 400 x 300 px. A 2:1 logo 380 px wide is 190 tall.
    const logo = { type: "logo", ...centre("left"), scale: 380 / W, naturalWidth: 2, naturalHeight: 1, rotation: 0 };
    expect(elementFits(GEOM, DIE.stage, logo)).toBe(true);
    // Turned 90 it is 380 tall: past the 300 px imprint.
    expect(elementFits(GEOM, DIE.stage, { ...logo, rotation: 90 })).toBe(false);
    expect(elementFits(GEOM, DIE.stage, { ...logo, scale: 420 / W })).toBe(false);
    // Trimmed artwork prints only what is inside.
    expect(elementFits(GEOM, DIE.stage, { ...logo, scale: 420 / W, clip: "left" })).toBe(true);
  });

  it("elementFits needs text's measured size, and says null without it", () => {
    const text = { type: "text", ...centre("back"), fontScale: 0.05, rotation: 0 };
    expect(elementFits(GEOM, DIE.stage, text)).toBeNull();
    expect(elementFits(GEOM, DIE.stage, text, { width: 480, height: 80 })).toBe(true);
    expect(elementFits(GEOM, DIE.stage, text, { width: 520, height: 80 })).toBe(false);
  });
});

describe("schema version 4", () => {
  it("a hat starts as a version 4 document naming its die", () => {
    expect(initialDesignState("hat-no-7")).toEqual({
      schemaVersion: 4,
      kind: "hat",
      dieId: "hat-no-7",
      parts: {},
      zones: {},
      elements: [],
      selectedId: null,
    });
    expect(ZONED_SCHEMA_VERSION).toBe(4);
  });

  it("a koozie still starts as version 3, with no version 4 keys", () => {
    const s = initialDesignState("slim");
    expect(s.schemaVersion).toBe(3);
    expect(s.size).toBe("slim");
    for (const k of ["kind", "dieId", "parts", "zones"]) expect(k in s, k).toBe(false);
  });

  it("SET_SIZE refuses a switch across kinds, either way", () => {
    const hat = initialDesignState("hat-no-7");
    expect(designReducer(hat, { type: "SET_SIZE", size: "slim" })).toBe(hat);
    const koozie = initialDesignState("slim");
    // v1.10 wrote "standard" here: a hat id read as the standard can.
    expect(designReducer(koozie, { type: "SET_SIZE", size: "hat-no-7" })).toBe(koozie);
    expect(designReducer(koozie, { type: "SET_SIZE", size: "standard" }).size).toBe("standard");
  });

  it("refuses a ground colour or pattern, and koozies refuse the hat actions", () => {
    const hat = initialDesignState("hat-no-7");
    expect(designReducer(hat, { type: "SET_COLOR", color: "#111111" })).toBe(hat);
    expect(designReducer(hat, { type: "SET_PATTERN", patternId: "camo" })).toBe(hat);
    const koozie = initialDesignState("standard");
    for (const action of [
      { type: "SET_PARTS", parts: { crown: "#111111" } },
      { type: "SET_PART_COLOR", part: "crown", color: "#111111" },
      { type: "SET_ZONE", zone: "front", method: "embroidery" },
    ]) {
      expect(designReducer(koozie, action), action.type).toBe(koozie);
    }
  });

  it("a document on a die this build lacks throws rather than opening on a koozie", () => {
    const stored = { ...initialDesignState("hat-no-7"), dieId: "hat-no-99" };
    expect(designDie(initialDesignState("hat-no-7"))).toBe(DIE);
    expect(() => designDie(stored)).toThrow();
    expect(() => designDie({ ...initialDesignState("hat-no-7"), kind: "koozie" })).toThrow();
    expect(() => designDie({ ...initialDesignState("hat-no-7"), kind: undefined })).toThrow();
    expect(() => designReducer(stored, { type: "ADD_TEXT", id: "t1", fitToZone: "front" })).toThrow();
    // A koozie document keeps its fallback.
    expect(designDie({ size: "nonsense" }).id).toBe("koozie-standard");
  });

  it("NUDGE converts dy by the hat frame's aspect", () => {
    let s = designReducer(initialDesignState("hat-no-7"), { type: "ADD_TEXT", id: "t1" });
    s = designReducer(s, { type: "NUDGE_ELEMENT", id: "t1", dy: 0.01 });
    expect(s.elements[0].y).toBeCloseTo(0.5 + 0.01 * (W / H), 12);
  });
});

describe("parts", () => {
  const hat = () => initialDesignState("hat-no-7");

  it("SET_PARTS lays a preset down as ONE undo step, replacing the last", () => {
    let h = initialHistoryState("hat-no-7");
    h = historyReducer(h, { type: "SET_PARTS", parts: { crown_front: "#1C2E4A", bill_top: "navy", button: "#FFFFFF" } });
    expect(h.past).toHaveLength(1);
    expect(h.present.parts).toEqual({ crown_front: "#1C2E4A", bill_top: "navy", button: "#FFFFFF" });
    h = historyReducer(h, { type: "SET_PARTS", parts: { crown_front: "#000000" } });
    expect(h.present.parts).toEqual({ crown_front: "#000000" });
    h = historyReducer(h, { type: "UNDO" });
    expect(h.present.parts.bill_top).toBe("navy");
  });

  it("refuses a preset with any bad entry, and a repeat of the same one costs nothing", () => {
    const s = designReducer(hat(), { type: "SET_PARTS", parts: { crown: "#111111" } });
    expect(designReducer(s, { type: "SET_PARTS", parts: { crown: "#111111" } })).toBe(s);
    for (const parts of [null, [], { crown: 7 }, { crown: "" }, { "bad id": "#111111" }, { __proto__x: "#111" }, { crown: "rgb(0,0,0)" }]) {
      expect(designReducer(s, { type: "SET_PARTS", parts }), JSON.stringify(parts)).toBe(s);
    }
  });

  it("SET_PART_COLOR sets one part, and null takes it off", () => {
    let s = designReducer(hat(), { type: "SET_PART_COLOR", part: "strap", color: "#C13232" });
    expect(s.parts).toEqual({ strap: "#C13232" });
    expect(designReducer(s, { type: "SET_PART_COLOR", part: "strap", color: "#C13232" })).toBe(s);
    expect(designReducer(s, { type: "SET_PART_COLOR", part: "strap", color: 12 })).toBe(s);
    s = designReducer(s, { type: "SET_PART_COLOR", part: "strap", color: null });
    expect(s.parts).toEqual({});
  });
});

describe("SET_ZONE", () => {
  const hat = () => initialDesignState("hat-no-7");

  it("takes only a method the zone lists", () => {
    const s = hat();
    expect(designReducer(s, { type: "SET_ZONE", zone: "left", method: "pvc_patch" })).toBe(s);
    expect(designReducer(s, { type: "SET_ZONE", zone: "bill_top", method: "embroidery" })).toBe(s);
    expect(designReducer(s, { type: "SET_ZONE", zone: "front", method: "screen_print" })).toBe(s);
    expect(designReducer(s, { type: "SET_ZONE", zone: "front", threads: ["1801"] })).toBe(s); // no method yet
    const t = designReducer(s, { type: "SET_ZONE", zone: "front", method: "pvc_patch" });
    expect(t.zones).toEqual({ front: { method: "pvc_patch" } });
  });

  it("merges threads and ground into the spot, and null takes one off", () => {
    let s = designReducer(hat(), { type: "SET_ZONE", zone: "front", method: "embroidery", threads: ["1801", "1000"] });
    s = designReducer(s, { type: "SET_ZONE", zone: "front", ground: "#FFFFFF" });
    expect(s.zones.front).toEqual({ method: "embroidery", threads: ["1801", "1000"], ground: "#FFFFFF" });
    expect(designReducer(s, { type: "SET_ZONE", zone: "front", threads: ["1801", "1000"] })).toBe(s);
    expect(designReducer(s, { type: "SET_ZONE", zone: "front", threads: "1801" })).toBe(s);
    s = designReducer(s, { type: "SET_ZONE", zone: "front", ground: null });
    expect(s.zones.front).toEqual({ method: "embroidery", threads: ["1801", "1000"] });
    s = designReducer(s, { type: "SET_ZONE", zone: "front", method: null });
    expect(s.zones).toEqual({});
  });

  it("keeps one label shape at a time, carrying its settings and moving its art, as one undo step", () => {
    let h = initialHistoryState("hat-no-7");
    h = historyReducer(h, { type: "SET_ZONE", zone: "label_tall", method: "woven_label", ground: "#F5F1E8" });
    expect(h.present.zones).toEqual({ label_tall: { method: "woven_label", shape: "tall", ground: "#F5F1E8" } });
    h = historyReducer(h, {
      type: "ADD_LOGO", id: "l1", fileName: "delta.png", mimeType: "image/png",
      naturalWidth: 700, naturalHeight: 400, fitToZone: "label_tall",
    });
    const depth = h.past.length;
    const before = h.present.elements[0];

    h = historyReducer(h, { type: "SET_ZONE", zone: "label_tall", shape: "square" });
    expect(h.past).toHaveLength(depth + 1);
    expect(h.present.zones).toEqual({ label_square: { method: "woven_label", shape: "square", ground: "#F5F1E8" } });
    const after = h.present.elements[0];
    expect(zoneOfElement(GEOM, DIE.stage, after)).toBe("label_square");
    // 350 x 200 into 200 x 200: the art shrinks by 200/350 about the centres.
    expect(after.scale).toBeCloseTo(before.scale * (200 / 350), 12);
    expect(after.x).toBeCloseTo(centre("label_square").x, 12);
    expect(elementFits(GEOM, DIE.stage, after)).toBe(true);

    h = historyReducer(h, { type: "UNDO" });
    expect(h.present.zones).toEqual({ label_tall: { method: "woven_label", shape: "tall", ground: "#F5F1E8" } });
    expect(h.present.elements[0]).toEqual(before);
  });

  it("a shape switch before the label has settings still moves its art (one method, no choice)", () => {
    let s = designReducer(hat(), {
      type: "ADD_LOGO", id: "l1", fileName: "a.png", mimeType: "image/png",
      naturalWidth: 700, naturalHeight: 400, fitToZone: "label_tall",
    });
    s = designReducer(s, { type: "SET_ZONE", zone: "label_tall", shape: "square" });
    expect(s.zones).toEqual({ label_square: { method: "woven_label", shape: "square" } });
    expect(zoneOfElement(GEOM, DIE.stage, s.elements[0])).toBe("label_square");
    // A zone with several methods still has to be told which.
    expect(designReducer(hat(), { type: "SET_ZONE", zone: "front", ground: "#FFFFFF" }).zones).toEqual({});
  });

  it("naming the other label zone directly switches the same way", () => {
    let s = designReducer(hat(), { type: "SET_ZONE", zone: "label_square", method: "woven_label" });
    s = designReducer(s, { type: "SET_ZONE", zone: "label_tall", method: "woven_label" });
    expect(Object.keys(s.zones)).toEqual(["label_tall"]);
    expect(designReducer(s, { type: "SET_ZONE", zone: "front", shape: "square" })).toBe(s);
    expect(designReducer(s, { type: "SET_ZONE", zone: "label_tall", shape: "round" })).toBe(s);
  });

  it("moveToZone never grows art and leaves other zones alone", () => {
    let s = designReducer(hat(), {
      type: "ADD_TEXT", id: "t1", fitToZone: "label_square",
    });
    s = designReducer(s, { type: "ADD_TEXT", id: "t2", fitToZone: "front" });
    const moved = moveToZone(s, "label_square", "label_tall");
    expect(moved.elements[0].fontScale).toBe(s.elements[0].fontScale);
    expect(moved.elements[0].x).toBeCloseTo(centre("label_tall").x, 12);
    expect(moved.elements[1]).toBe(s.elements[1]);
    expect(moveToZone(s, "left", "right")).toBe(s); // nothing there
  });
});

describe("placed sizes (v1.11.0)", () => {
  const LOGO = {
    type: "ADD_LOGO", id: "l1", fileName: "mark.png", mimeType: "image/png",
    naturalWidth: 400, naturalHeight: 200,
  };

  it("ADD_LOGO and ADD_TEXT take a finite positive scale, and nothing else", () => {
    const k = initialDesignState("hat-no-7");
    expect(designReducer(k, { ...LOGO, scale: 0.25 }).elements[0].scale).toBe(0.25);
    expect(designReducer(k, { type: "ADD_TEXT", id: "t1", fontScale: 0.03 }).elements[0].fontScale).toBe(0.03);
    for (const bad of [0, -1, NaN, Infinity, "0.2", null]) {
      expect(designReducer(k, { ...LOGO, scale: bad }).elements[0].scale).toBe(0.4);
      expect(designReducer(k, { type: "ADD_TEXT", id: "t1", fontScale: bad }).elements[0].fontScale).toBe(0.07);
    }
    // fontScale keeps DEFAULT_TEXT's key order.
    const text = designReducer(k, { type: "ADD_TEXT", id: "t1", fontScale: 0.03 }).elements[0];
    expect(Object.keys(text)).toEqual(
      ["id", "type", "text", "fontFamily", "fontStyle", "fill", "align", "fontScale", "x", "y", "rotation", "opacity"],
    );
  });

  it("a koozie add ignores them, as v1.10.0 did: the storefront already sends a scale", () => {
    const k = initialDesignState("standard");
    const logo = designReducer(k, { ...LOGO, scale: 0.25, fitToZone: "front" }).elements[0];
    expect(logo).toMatchObject({ x: 0.5, y: 0.5, scale: 0.4 });
    const text = designReducer(k, { type: "ADD_TEXT", id: "t1", fontScale: 0.03, fitToZone: true }).elements[0];
    expect(text).toMatchObject({ x: 0.5, y: 0.5, fontScale: 0.07 });
  });

  it("fitToZone centres a logo in its zone at 80% of it", () => {
    const s = designReducer(initialDesignState("hat-no-7"), { ...LOGO, fitToZone: "left" });
    const el = s.elements[0];
    // 2:1 into 400 x 300: width-bound, 320 px wide.
    expect(el.scale * W).toBeCloseTo(320, 9);
    expect(el.x).toBeCloseTo(centre("left").x, 12);
    expect(el.y).toBeCloseTo(centre("left").y, 12);
    // Turned 90, it is height-bound: 240 px tall, so 240 px "wide" before turning.
    const turned = designReducer(initialDesignState("hat-no-7"), { ...LOGO, fitToZone: "left", rotation: 90 }).elements[0];
    expect(turned.scale * W).toBeCloseTo(240, 9);
    expect(elementFits(GEOM, DIE.stage, el)).toBe(true);
  });

  it("fitToZone: true fits the zone at the placed point; explicit values win; an unknown zone is ignored", () => {
    const at = centre("back");
    const fit = designReducer(initialDesignState("hat-no-7"), { ...LOGO, fitToZone: true, ...at }).elements[0];
    // 2:1 into 500 x 175: height-bound, 140 tall, 280 wide.
    expect(fit.scale * W).toBeCloseTo(280, 9);
    const mine = designReducer(initialDesignState("hat-no-7"), { ...LOGO, fitToZone: "back", scale: 0.05, x: 0.7 }).elements[0];
    expect(mine.scale).toBe(0.05);
    expect(mine.x).toBe(0.7);
    expect(mine.y).toBeCloseTo(at.y, 12);
    const none = designReducer(initialDesignState("hat-no-7"), { ...LOGO, fitToZone: "under_bill" }).elements[0];
    expect(none).toMatchObject({ x: 0.5, y: 0.5, scale: 0.4 });
  });

  it("fitToZone sizes the new text by its Arial box", () => {
    const el = designReducer(initialDesignState("hat-no-7"), { type: "ADD_TEXT", id: "t1", fitToZone: "back" }).elements[0];
    // "Your text" is 4.002 em by 1 em: 500 x 175 is width-bound at 80%.
    expect(el.fontScale * W * 4.002).toBeCloseTo(400, 9);
    expect(elementFits(GEOM, DIE.stage, el, { width: el.fontScale * W * 4.002, height: el.fontScale * W })).toBe(true);
  });
});

describe("a version 4 document round-trips", () => {
  function build() {
    let s = initialDesignState("hat-no-7");
    s = designReducer(s, { type: "SET_PARTS", parts: { crown_front: "#1C2E4A", bill_top: "#1C2E4A", strap: "#C13232" } });
    s = designReducer(s, { type: "SET_ZONE", zone: "front", method: "embroidery", threads: ["1801", "1000"] });
    s = designReducer(s, {
      type: "ADD_LOGO", id: "l1", fileName: "mark.png", mimeType: "image/png",
      naturalWidth: 400, naturalHeight: 200, fitToZone: "front",
    });
    s = designReducer(s, { type: "SET_ZONE", zone: "label_square", method: "woven_label", ground: "#F5F1E8" });
    s = designReducer(s, { type: "ADD_TEXT", id: "t1", fitToZone: "label_square" });
    return s;
  }

  it("serializes to exactly the version 4 shape", () => {
    const d = toDesignDescription(build());
    expect(Object.keys(d)).toEqual(["schemaVersion", "kind", "dieId", "parts", "zones", "elements"]);
    expect(d).toMatchObject({
      schemaVersion: 4,
      kind: "hat",
      dieId: "hat-no-7",
      parts: { crown_front: "#1C2E4A", bill_top: "#1C2E4A", strap: "#C13232" },
      zones: {
        front: { method: "embroidery", threads: ["1801", "1000"] },
        label_square: { method: "woven_label", shape: "square", ground: "#F5F1E8" },
      },
    });
    expect(Object.keys(d.elements[0])).toEqual(
      ["id", "type", "x", "y", "rotation", "opacity", "fileName", "mimeType", "naturalWidth", "naturalHeight", "scale"],
    );
    expect(d.elements.map((el) => zoneOfElement(GEOM, DIE.stage, el))).toEqual(["front", "label_square"]);
    expect("size" in d || "color" in d || "patternId" in d || "selectedId" in d).toBe(false);
  });

  it("reads back from JSON as a document that edits and serializes the same", () => {
    const d = toDesignDescription(build());
    const stored = JSON.parse(JSON.stringify(d));
    const state = { ...stored, selectedId: null };
    expect(toDesignDescription(state)).toEqual(d);
    // And keeps working as a document: still on its die, still checked.
    const nudged = designReducer(state, { type: "NUDGE_ELEMENT", id: "l1", dx: 0.01 });
    expect(nudged.elements[0].x).toBeCloseTo(d.elements[0].x + 0.01, 12);
    expect(designReducer(state, { type: "SET_ZONE", zone: "left", method: "woven_patch" })).toBe(state);
    expect(toDesignDescription(designReducer(state, { type: "SET_ZONE", zone: "label_square", shape: "tall" })).zones)
      .toEqual({ front: d.zones.front, label_tall: { method: "woven_label", shape: "tall", ground: "#F5F1E8" } });
  });
});

it("is exported from core", () => {
  for (const k of ["hatOutline", "nearestZone", "isKoozieGeometry", "zoneOfElement", "elementFits", "moveToZone", "designDie"]) {
    expect(typeof core[k], k).toBe("function");
  }
  expect(core.ZONED_SCHEMA_VERSION).toBe(4);
});

it("nearestZone and moveToZone leave what they cannot handle alone", () => {
  expect(nearestZone({}, 0.5, 0.5, DIE.stage)).toBeNull();
  expect(nearestZone({ zones: [] }, 0.5, 0.5, DIE.stage)).toBeNull();
  // A koozie's back panel is turned over; a similarity cannot move art there.
  const koozie = designReducer(initialDesignState("standard"), { type: "ADD_TEXT", id: "t1", y: 0.2 });
  expect(moveToZone(koozie, "front", "back")).toBe(koozie);
  expect(designReducer(koozie, { type: "MOVE_TO_ZONE", from: "front", to: "back" })).toBe(koozie);
});
