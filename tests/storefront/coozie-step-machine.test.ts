// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/coozie-step-machine.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, expect, it } from "vitest";
import {
  COUNTED_STEPS,
  DONE_STEP,
  FIRST_STEP,
  LAST_STEP,
  STEPS,
  STEP_IDS,
  copyFrontActions,
  copyPlacement,
  faceOf,
  faceRect,
  formatStepHash,
  historyStateFor,
  logoScaleFor,
  magnetOnStage,
  nextStep,
  parseStepHash,
  placementFor,
  prevStep,
  readHistoryState,
  viewForStep,
  clipNote,
  confineNote,
  isCountedStep,
  sidesFor,
  stepPosition,
} from "../../src/core/coozie-step-machine.js";
import { NEW_DESIGN_HASH, normalizeStepId } from "../../src/core/coozie-step-machine.js";
import { dieGeometry, resolveSize } from "../../src/core/coozie-config.js";
// Dropped (storefront-only code, not in the package): "is one undo step, and the copies keep everything but where they are" (needs the storefront assetHistoryReducer), "the radio groups' arrow keys" (radio-keys.ts, a React helper) and "the confetti on the share page" (lib/confetti.ts).
import { faceAt } from "../../src/core/index.js";

describe("the mobile form's steps", () => {
  it("runs in Brayden's order, one decision each, ending at checkout", () => {
    // Magnet and speed are switches on the quantity step since 2026-10-18.
    expect(STEP_IDS).toEqual(["size", "color", "logo", "text", "quantity", "share", "checkout"]);
    expect(FIRST_STEP).toBe("size");
    expect(LAST_STEP).toBe("checkout");
  });

  it("asks each question in sentence case, without em dashes or the restricted word", () => {
    for (const step of STEPS) {
      expect(step.title[0]).toBe(step.title[0].toUpperCase());
      expect(step.title.slice(1)).toBe(step.title.slice(1).toLowerCase());
      expect(step.title).not.toMatch(/—/);
      expect(step.title.toLowerCase()).not.toMatch(/koozie|coozie/);
    }
  });

  it("only the logo and text steps zoom into a face", () => {
    expect(STEPS.filter((s) => s.camera === "face").map((s) => s.id)).toEqual(["logo", "text"]);
  });

  it("stops the count at the share page, where the design is done (Brayden, 2026-10-17)", () => {
    expect(DONE_STEP).toBe("share");
    expect(COUNTED_STEPS).toBe(5);
    expect(stepPosition("size")).toBe("Step 1 of 5.");
    expect(stepPosition("quantity")).toBe("Step 5 of 5.");
    expect(stepPosition("share")).toBe("");
    expect(stepPosition("checkout")).toBe("");
    expect(STEP_IDS.filter(isCountedStep)).toEqual(["size", "color", "logo", "text", "quantity"]);
    expect(isCountedStep("nope")).toBe(false);
  });

  it("walks forward and back, stopping at both ends", () => {
    expect(nextStep("size")).toBe("color");
    expect(nextStep("checkout")).toBeNull();
    expect(prevStep("color")).toBe("size");
    expect(prevStep("size")).toBeNull();
    expect(nextStep("nope")).toBeNull();
    expect(prevStep("nope")).toBeNull();
  });
});

describe("the URL and history entries", () => {
  it("writes and reads a hash per step", () => {
    for (const id of STEP_IDS) expect(parseStepHash(formatStepHash(id))).toBe(id);
    expect(parseStepHash("#design")).toBe(FIRST_STEP);
    expect(parseStepHash("#design/teleport")).toBeNull();
    expect(parseStepHash("#can-coolers")).toBeNull();
    expect(parseStepHash("")).toBeNull();
    expect(parseStepHash(undefined)).toBeNull();
  });

  it("round-trips the state object and survives Next's own keys beside it", () => {
    const state = { ...historyStateFor("logo", 3), __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] };
    expect(readHistoryState(state)).toEqual({ step: "logo", depth: 3, returnTo: null });
    expect(readHistoryState(historyStateFor("color", 3, { step: "checkout", depth: 2 }))).toEqual({
      step: "color",
      depth: 3,
      returnTo: { step: "checkout", depth: 2 },
    });
    // A return point at or above the entry itself is nonsense, so it is dropped.
    expect(readHistoryState(historyStateFor("color", 2, { step: "checkout", depth: 2 }))?.returnTo).toBeNull();
    // @ts-expect-error a bare step id is the old shape, and is ignored
    expect(readHistoryState(historyStateFor("color", 2, "checkout"))?.returnTo).toBeNull();
  });

  it("ignores entries that are not the form's", () => {
    expect(readHistoryState(null)).toBeNull();
    expect(readHistoryState({ __NA: true })).toBeNull();
    expect(readHistoryState({ coozieForm: { step: "teleport", depth: 1 } })).toBeNull();
    expect(readHistoryState({ coozieForm: { step: "size", depth: -2 } })).toEqual({
      step: "size",
      depth: 0,
      returnTo: null,
    });
  });
});

describe("the camera and placement", () => {
  it("frames the whole die off the face steps, and turns only the back", () => {
    expect(viewForStep("size")).toEqual({ focus: null, rotate180: false });
    expect(viewForStep("checkout", "back")).toEqual({ focus: null, rotate180: false });
    expect(viewForStep("logo")).toEqual({ focus: "front", rotate180: false });
    expect(viewForStep("text", "base")).toEqual({ focus: "base", rotate180: false });
    expect(viewForStep("logo", "back")).toEqual({ focus: "back", rotate180: true });
    expect(viewForStep("logo", "sideways")).toEqual({ focus: "front", rotate180: false });
  });

  for (const sizeId of ["standard", "slim"]) {
    const size = resolveSize(sizeId);
    const geom = dieGeometry(size);

    it(`centres new artwork on each face of the ${sizeId} die`, () => {
      const front = placementFor("front", geom, size.stage);
      const back = placementFor("back", geom, size.stage);
      const base = placementFor("base", geom, size.stage);
      expect(front.x).toBeCloseTo(0.5, 6);
      expect(back.x).toBeCloseTo(0.5, 6);
      expect(base).toEqual({ x: 0.5, y: geom.cy / size.stage.height, rotation: 0 });
      // Front above the base, back below it, and only the back turned.
      expect(front.y).toBeLessThan(base.y);
      expect(back.y).toBeGreaterThan(base.y);
      expect(front.rotation).toBe(0);
      expect(back.rotation).toBe(180);
      // The back's centre is below the fold the upside-down warning reads.
      expect(back.y).toBeGreaterThan(geom.bottomPanelStartY);
    });

    it(`reads each placement back as the face it was placed on (${sizeId})`, () => {
      for (const face of ["front", "base", "back"] as const) {
        expect(faceOf(placementFor(face, geom, size.stage), geom, size.stage)).toBe(face);
      }
    });

    it(`the ${sizeId} base rect is the disc's bounding box`, () => {
      const rect = faceRect(geom, "base");
      expect(rect.x1 - rect.x0).toBeCloseTo(2 * geom.r, 6);
      expect(rect.y1 - rect.y0).toBeCloseTo(2 * geom.r, 6);
    });
  }
});

describe("copying a logo to another side", () => {
  for (const sizeId of ["standard", "slim"]) {
    const size = resolveSize(sizeId);
    const geom = dieGeometry(size);
    const front = { x: 0.62, y: 0.22, rotation: 12, scale: 0.35, naturalWidth: 400, naturalHeight: 200 };

    it(`puts the back copy where the front one is, as seen on the can (${sizeId})`, () => {
      const back = copyPlacement(front, "back", geom, size.stage);
      expect(faceOf(back, geom, size.stage)).toBe("back");
      // Mirrored through the panel centres: the same offset, turned over.
      const f = faceRect(geom, "front");
      const b = faceRect(geom, "back");
      const fx = front.x * size.stage.width - (f.x0 + f.x1) / 2;
      const fy = front.y * size.stage.height - (f.y0 + f.y1) / 2;
      expect(back.x * size.stage.width - (b.x0 + b.x1) / 2).toBeCloseTo(-fx, 6);
      expect(back.y * size.stage.height - (b.y0 + b.y1) / 2).toBeCloseTo(-fy, 6);
      expect(back.rotation).toBe(-168);
      // Same size: a copy keeps the source's own (DUPLICATE_ELEMENT carries it).
      expect(back).not.toHaveProperty("scale");
      // And copied back again, it is the original.
      const again = copyPlacement({ ...front, ...back }, "front", geom, size.stage);
      expect(again.x).toBeCloseTo(front.x, 9);
      expect(again.y).toBeCloseTo(front.y, 9);
      expect(again.rotation).toBe(front.rotation);
    });

    it(`centres the base copy upright and shrinks it only to fit the disc (${sizeId})`, () => {
      const base = copyPlacement(front, "base", geom, size.stage);
      expect(faceOf(base, geom, size.stage)).toBe("base");
      expect(base.x).toBeCloseTo(geom.cx / size.stage.width, 9);
      expect(base.y).toBeCloseTo(geom.cy / size.stage.height, 9);
      expect(base.rotation).toBe(12);
      expect(base.scale).toBe(front.scale);
      // A wide logo is shrunk until its diagonal clears the disc's edge.
      const wide = copyPlacement({ ...front, scale: 0.9 }, "base", geom, size.stage);
      const w = (wide.scale as number) * size.stage.width;
      expect(Math.hypot(w, w / 2)).toBeLessThanOrEqual(2 * geom.r);
      expect(wide.scale).toBeLessThan(0.9);
    });
  }

  it("lands a copy that would mirror off the back panel in the back's centre instead", () => {
    const size = resolveSize("standard");
    const geom = dieGeometry(size);
    // Counted as front (above the fold) but below the front panel, beside the disc.
    const f = faceRect(geom, "front");
    const beside = { x: 0.15, y: (f.y1 + 30) / size.stage.height, rotation: 0, scale: 0.2, naturalWidth: 100, naturalHeight: 100 };
    expect(faceOf(beside, geom, size.stage)).toBe("front");
    const copy = copyPlacement(beside, "back", geom, size.stage);
    expect(faceOf(copy, geom, size.stage)).toBe("back");
    const b = faceRect(geom, "back");
    expect(copy.x).toBeCloseTo((b.x0 + b.x1) / 2 / size.stage.width, 9);
    expect(copy.y).toBeCloseTo((b.y0 + b.y1) / 2 / size.stage.height, 9);
  });

  it("turns a back logo upright for the base", () => {
    const size = resolveSize("standard");
    const geom = dieGeometry(size);
    const back = { x: 0.5, y: 0.8, rotation: 180, scale: 0.3, naturalWidth: 100, naturalHeight: 100 };
    expect(copyPlacement(back, "base", geom, size.stage).rotation).toBe(0);
  });
});

describe("the magnet on the canvas", () => {
  it("is solid with a magnet, a ghost while artwork is selected, and absent without one", () => {
    expect(magnetOnStage("with_magnet", null)).toBe("solid");
    expect(magnetOnStage("with_magnet", "logo-1")).toBe("ghost");
    expect(magnetOnStage("no_magnet", null)).toBeNull();
    expect(magnetOnStage("no_magnet", "logo-1")).toBeNull();
  });
});

describe("copy the front", () => {
  const size = resolveSize("standard");
  const geom = dieGeometry(size);
  const logo = { id: "l1", type: "logo", x: 0.62, y: 0.2, rotation: 10, scale: 0.3, opacity: 0.8, assetRevision: "r1", naturalWidth: 400, naturalHeight: 200 };
  const text = { id: "t1", type: "text", text: "Hi", x: 0.4, y: 0.3, rotation: 0, fontScale: 0.07, fill: "#111111" };
  const onBack = { ...logo, id: "l0", y: 0.8 };
  let n = 0;
  const nextId = (type: string) => `${type}_copy_${++n}`;

  it("duplicates and moves every front element of the kind, all under one key", () => {
    const actions = copyFrontActions([onBack, logo, text], "logo", geom, size.stage, nextId, "k1");
    expect(actions.map((a) => a.type)).toEqual(["DUPLICATE_ELEMENT", "UPDATE_ELEMENT"]);
    expect(actions[0]).toMatchObject({ id: "l1", coalesceKey: "k1" });
    expect(actions[1]).toMatchObject({ id: actions[0].newId, coalesceKey: "k1" });
    expect(actions[1].patch).toEqual(copyPlacement(logo, "back", geom, size.stage));
    expect(copyFrontActions([logo, text], "text", geom, size.stage, nextId, "k2").map((a) => a.id)).toEqual(["t1", expect.any(String)]);
    expect(copyFrontActions([onBack], "logo", geom, size.stage, nextId, "k3")).toEqual([]);
    // A front logo trimmed to the front is copied trimmed to the back.
    const trimmed = copyFrontActions([{ ...logo, clip: "front" }], "logo", geom, size.stage, nextId, "k7");
    expect(trimmed[1].patch?.clip).toBe("back");
    expect(actions[1].patch).not.toHaveProperty("clip");
    // A line emptied in the field is not copied (it is about to be removed).
    expect(copyFrontActions([{ ...text, text: "  " }], "text", geom, size.stage, nextId, "k6")).toEqual([]);
  });

});

describe("a new logo fits the side it lands on", () => {
  for (const sizeId of ["standard", "slim"]) {
    const size = resolveSize(sizeId);
    const geom = dieGeometry(size);
    it(`keeps the default size on the panels and shrinks for the disc (${sizeId})`, () => {
      const wide = { naturalWidth: 400, naturalHeight: 200 };
      expect(logoScaleFor("front", wide, geom, size.stage)).toBe(0.4);
      expect(logoScaleFor("back", wide, geom, size.stage)).toBe(0.4);
      const base = logoScaleFor("base", { naturalWidth: 100, naturalHeight: 100 }, geom, size.stage);
      const w = base * size.stage.width;
      expect(Math.hypot(w, w)).toBeLessThanOrEqual(2 * geom.r);
      // A very tall logo is held to the panel's height.
      const tall = logoScaleFor("front", { naturalWidth: 100, naturalHeight: 1000 }, geom, size.stage);
      const f = faceRect(geom, "front");
      expect(tall * size.stage.width * 10).toBeLessThanOrEqual(f.y1 - f.y0);
    });

    it(`faceOf agrees with the stage's faceAt (${sizeId})`, () => {
      for (let y = 0.01; y < 1; y += 0.02) {
        for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          expect(faceOf({ x, y }, geom, size.stage), `${x},${y}`).toBe(faceAt(geom, size.stage, { x, y }));
        }
      }
    });
  }
});

describe("the side counts and the confine note both layouts share", () => {
  const size = resolveSize("standard");
  const geom = dieGeometry(size);
  const on = (face: "front" | "base" | "back") => placementFor(face, geom, size.stage);

  it("counts each kind on the side shown, the front and the back", () => {
    const elements = [
      { id: "a", type: "logo", ...on("front") },
      { id: "b", type: "logo", ...on("back") },
      { id: "c", type: "text", ...on("front") },
      { id: "d", type: "logo", ...on("base") },
    ];
    expect(sidesFor(elements, geom, size.stage, "front")).toEqual({
      logo: { here: 1, front: 1, back: 1 },
      text: { here: 1, front: 1, back: 0 },
    });
    expect(sidesFor(elements, geom, size.stage, "base").logo.here).toBe(1);
  });

  it("says where to put artwork that was heading for another side, and rings that side", () => {
    expect(confineNote({ face: "front", toward: "base" })).toEqual({
      text: "To put artwork on the base, switch to Base.",
      target: "base",
    });
    expect(confineNote({ face: "back", toward: null })).toEqual({ text: "Artwork stays on the back." });
  });

  it("says artwork can run past the edge next time, and that it is trimmed when it does", () => {
    expect(confineNote({ face: "front", toward: null, canOverflow: true })).toEqual({
      text: "Artwork stays on the front. To let it run past the edge, drag it out again.",
    });
    expect(confineNote({ face: "front", toward: "back", canOverflow: true }).target).toBe("back");
    expect(clipNote({ face: "back" })).toEqual({ text: "Anything past the edge of the back is trimmed off." });
  });

  it("puts artwork trimmed to a side on that side, wherever its centre is", () => {
    const size = resolveSize("standard");
    const geom = dieGeometry(size);
    const onFront = { x: 0.5, y: 0.2 };
    expect(faceOf(onFront, geom, size.stage)).toBe("front");
    expect(faceOf({ ...onFront, clip: "back" }, geom, size.stage)).toBe("back");
    expect(faceOf({ ...onFront, clip: "nowhere" }, geom, size.stage)).toBe("front");
  });
});

describe("the cart's Add another design link", () => {
  it("asks for a new design with a hash that is not a step", () => {
    expect(NEW_DESIGN_HASH).toBe("#design/new");
    expect(parseStepHash(NEW_DESIGN_HASH)).toBeNull();
  });
});

describe("the folded steps (2026-10-18)", () => {
  it("send an old magnet or speed link, history entry or draft to the quantity step", () => {
    expect(normalizeStepId("magnet")).toBe("quantity");
    expect(normalizeStepId("speed")).toBe("quantity");
    expect(normalizeStepId("color")).toBe("color");
    expect(normalizeStepId("constructor")).toBeNull();
    expect(parseStepHash("#design/magnet")).toBe("quantity");
    expect(parseStepHash("#design/speed")).toBe("quantity");
    expect(readHistoryState(historyStateFor("speed", 3))?.step).toBe("quantity");
  });
});
