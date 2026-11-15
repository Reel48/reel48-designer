// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-edit-host.test.ts (origin/main d78d90ee); imports point into this package.
// Dropped or adapted (storefront-only code):
// - The storefront's hat history reducer (src/lib/hat/hat-history.js) is not in
//   this package. Where a test only ran a hat-edit-host action through it, the
//   action's patch is merged as the shared reducer merges UPDATE_ELEMENT
//   ({ ...el, ...patch }), and the piece is still checked valid on its spot:
//   hat-history keeps such a pose exactly as sent, so the result is the same.
//   Its own checks are dropped: one history step per press, "Larger at the cap
//   is held there by the reducer", and "keeps a line whole in its spot through
//   the reducer" (NUDGE_ELEMENT with measureText).
// - "LayerControls without a host's own steps (the can cooler)": LayerControls
//   is a storefront React component.
/**
 * The designer's side of editing on the 3D hat (round E1, 2026-10-21): the
 * `edit` prop HatStepForm hands Hat3D on each placing step, the providers it
 * builds on the hidden stage (a piece's art alone on its unturned box, the
 * spot's art without it), a gesture's pose back as the one UPDATE_ELEMENT
 * that puts the piece there, and the phone's Adjust row. Pure functions of
 * hat-edit-host.js, with a fake stage and a fake canvas where they draw.
 */
import { describe, expect, it, vi } from "vitest";
import { HAT_NO_7_DIE, SPOT_NAMES } from "../../src/core/hat-config.js";
import { zonesForStep } from "../../src/core/hat-step-machine.js";
import { elementPose, fitsSpot, zoneArea, zoneOfElement } from "../../src/core/hat-placements.js";
import type { HatDie } from "../../src/core/hat-placements.js";
import { areaHome } from "../../src/core/region.js";
import {
  adjustAction,
  angleFromLevel,
  angleLabel,
  askedSize,
  commitPatch,
  createPieceArtCache,
  drawnTextBox,
  layerResize,
  layerRotate,
  pieceArtRect,
  pieceOf,
  piecesOf,
  renderPieceArt,
  restArtFor,
  sizeLabel,
  spotLimits,
  stageTextMeasure,
  stepView,
  textBox,
} from "../../src/viewer/hat-edit-host.js";

const DIE = HAT_NO_7_DIE as unknown as HatDie;
const W = DIE.stage.width;
const H = DIE.stage.height;
const zone = (id: string) => DIE.zones.find((z) => z.id === id)!;
const home = (id: string) => areaHome(zoneArea(zone(id)) as never)!;
const zoneOf = (el: unknown) => zoneOfElement(el, DIE)?.id ?? "front";

type El = Record<string, unknown> & { id: string; x: number; y: number };
/** A 2:1 logo `wPx` die px wide at die px (cx, cy). */
function logo(id: string, cx: number, cy: number, wPx = 300, rotation = 0): El {
  return {
    id,
    type: "logo",
    x: cx / W,
    y: cy / H,
    rotation,
    opacity: 1,
    fileName: `${id}.png`,
    mimeType: "image/png",
    naturalWidth: 1200,
    naturalHeight: 600,
    scale: wPx / W,
    assetRevision: `${id}-r1`,
  };
}
function text(id: string, cx: number, cy: number, fontScale = 0.02): El {
  return {
    id,
    type: "text",
    x: cx / W,
    y: cy / H,
    rotation: 0,
    opacity: 1,
    text: "EST 1999",
    fontFamily: "Arial, sans-serif",
    fontStyle: "normal",
    fill: "#FFFFFF",
    align: "center",
    fontScale,
  };
}

describe("the edit prop on each placing step", () => {
  // A design with art on every spot of round E1's die.
  const elements = [
    logo("f", ...home("front")),
    text("t", home("front")[0], home("front")[1] + 200),
    logo("l", ...home("left")),
    logo("r", ...home("right")),
    logo("b", ...home("back"), 200),
    logo("i", ...home("label_tall"), 150),
  ];
  const design = { schemaVersion: 4, kind: "hat", dieId: DIE.id, parts: {}, zones: {}, elements };

  for (const step of ["front", "spots", "label"]) {
    for (const zoneId of zonesForStep(step, design)) {
      it(`${step}: ${zoneId} is its die zone's own area and cap, its name, and its pieces only`, () => {
        const limits = spotLimits(DIE, zoneId)!;
        const z = zone(zoneId);
        expect(limits.zone).toBe(zoneId);
        // the zone's own object, so the placer reads a polygon once
        expect(limits.area).toBe(z.area);
        expect(limits.cap).toEqual({ w: z.maxImprint.w * 200, h: z.maxImprint.h * 200 });
        expect(limits.pxPerInch).toBe(200);
        expect(limits.labels).toEqual({ spot: SPOT_NAMES[zoneId as keyof typeof SPOT_NAMES] });
        // the snap line through the area's home: on the front, the centre seam
        expect(limits.snapX).toBeCloseTo(home(zoneId)[0], 9);
        // the same object every time, so the editor sees no change
        expect(spotLimits(DIE, zoneId)).toBe(limits);
        const pieces = piecesOf(elements, zoneId, DIE, { zoneOf });
        expect(pieces.map((p) => p.id)).toEqual(elements.filter((el) => zoneOf(el) === zoneId).map((el) => el.id));
        expect(pieces.length).toBeGreaterThan(0);
      });
    }
  }

  it("has no limits for a spot the die doesn't have", () => {
    expect(spotLimits(DIE, "label_square")).toBeNull();
    expect(spotLimits(null, "front")).toBeNull();
  });

  it("gives each spot its level: the side panels' bottom edges run down toward the bill, the rest are the die's own 0", () => {
    const levels = Object.fromEntries(["front", "left", "right", "back", "label_tall"].map((id) => [id, spotLimits(DIE, id)!.level]));
    expect(levels).toEqual({ front: 0, left: -7, right: 8, back: 0, label_tall: 0 });
  });

  it("measures each side's level from its own bottom edge on the die, within a degree", () => {
    // The area's bottom run, 5 mm above the panel's bottom edge, from the back
    // seam to where it turns up into the bill (die x, as hat-config says).
    const run = { left: [2053, 2611], right: [2820, 3436] } as const;
    for (const id of ["left", "right"] as const) {
      const outline = (zone(id).area as { outline: number[][] }).outline;
      const ys = outline.map((p) => p[1]);
      const low = Math.max(...ys) - 0.12 * (Math.max(...ys) - Math.min(...ys));
      const pts = outline.filter(([x, y]) => y > low && x >= run[id][0] && x <= run[id][1]).sort((a, b) => a[0] - b[0]);
      const [x0, y0] = pts[0];
      const [x1, y1] = pts.at(-1)!;
      const slope = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
      expect(Math.abs(slope - spotLimits(DIE, id)!.level)).toBeLessThan(1);
    }
  });

  it("sizes a logo from its document box, and text from the stage's measurement", () => {
    const [fx, fy] = home("front");
    const l = pieceOf(logo("a", fx, fy, 400, 30), DIE)!;
    expect(l).toEqual({ id: "a", cx: expect.closeTo(fx, 9), cy: expect.closeTo(fy, 9), w: expect.closeTo(400, 9), h: expect.closeTo(200, 9), rotation: 30, label: "a.png" });
    const t = text("t", fx, fy, 0.02);
    // unmeasured: held by its centre
    expect(pieceOf(t, DIE)).toMatchObject({ w: 0, h: 0, label: "“EST 1999”" });
    const box = textBox(t, { w: 360, h: 90 })!;
    expect(pieceOf(t, DIE, box)).toMatchObject({ w: 360, h: 90 });
    // grown since it was measured: scaled with its fontScale
    expect(pieceOf({ ...t, fontScale: 0.03 }, DIE, box)).toMatchObject({ w: 540, h: 135 });
    // other words or another font: unmeasured again
    expect(pieceOf({ ...t, text: "EST 2001" }, DIE, box)).toMatchObject({ w: 0, h: 0 });
    expect(pieceOf({ ...t, fontFamily: "Georgia, serif" }, DIE, box)).toMatchObject({ w: 0, h: 0 });
    expect(textBox(t, null)).toBeNull();
    expect(textBox(logo("a", fx, fy), { w: 1, h: 1 })).toBeNull();
  });
});

describe("a gesture's pose back to the document", () => {
  const [lx, ly] = home("left");

  it("round-trips: the patch puts the piece at the pose, in fractions of the stage", () => {
    const el = logo("a", lx, ly, 300, 0);
    const piece = pieceOf(el, DIE)!;
    const pose = { cx: lx + 37.5, cy: ly - 12.25, w: 360, h: 180, rotation: -15 };
    const patch = commitPatch(el, pose, piece, DIE)!;
    expect(patch).toEqual({ x: pose.cx / W, y: pose.cy / H, rotation: -15, scale: 360 / W });
    const moved = pieceOf({ ...el, ...patch }, DIE)!;
    for (const k of ["cx", "cy", "w", "h", "rotation"] as const) expect(moved[k]).toBeCloseTo(pose[k], 9);
  });

  it("carries only what moved, and nothing for a pose that is the piece's own", () => {
    const el = logo("a", lx, ly);
    const piece = pieceOf(el, DIE)!;
    expect(commitPatch(el, { ...piece }, piece, DIE)).toBeNull();
    expect(commitPatch(el, { ...piece, cx: piece.cx + 10 }, piece, DIE)).toEqual({ x: (piece.cx + 10) / W });
    // a full turn is no turn
    expect(commitPatch(el, { ...piece, rotation: 360 }, piece, DIE)).toBeNull();
  });

  it("grows text by its fontScale, and leaves an unmeasured line's size alone", () => {
    const t = text("t", lx, ly, 0.02);
    const measured = pieceOf(t, DIE, textBox(t, { w: 300, h: 80 }))!;
    expect(commitPatch(t, { ...measured, w: 450, h: 120 }, measured, DIE)).toEqual({ fontScale: 0.03 });
    const point = pieceOf(t, DIE)!;
    expect(commitPatch(t, { ...point, w: 450, h: 120 }, point, DIE)).toBeNull();
  });
});

describe("a piece's art, for the live drag", () => {
  const fakeCanvas = (w: number, h: number) => ({ width: w, height: h, getContext: vi.fn() });
  function fakeStage() {
    return {
      exportArtCanvas: vi.fn((o: { rect: { w: number; h: number } }) => fakeCanvas(Math.floor(o.rect.w), Math.floor(o.rect.h))),
    };
  }
  function fakeDoc() {
    const g = { setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
    const made: { width: number; height: number; getContext: () => typeof g }[] = [];
    return {
      g,
      made,
      createElement: vi.fn(() => {
        const c = { width: 0, height: 0, getContext: () => g };
        made.push(c);
        return c;
      }),
    };
  }

  it("is exported from the piece's unturned box when it is square to the die", () => {
    const piece = { id: "a", cx: 1000, cy: 700, w: 400, h: 200, rotation: 0 };
    expect(pieceArtRect(piece)).toEqual({ x: 800, y: 600, w: 400, h: 200, turned: false });
    const stage = fakeStage();
    const doc = fakeDoc();
    const art = renderPieceArt(stage, piece, doc)!;
    expect(stage.exportArtCanvas).toHaveBeenCalledWith({ color: false, only: "a", rect: { x: 800, y: 600, w: 400, h: 200 } });
    // the export itself, unturned: no canvas made
    expect(art).toBe(stage.exportArtCanvas.mock.results[0].value);
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it("is exported on a turned piece's bounding box, then turned back onto its own", () => {
    const piece = { id: "a", cx: 1000, cy: 700, w: 400, h: 200, rotation: 30 };
    const r = pieceArtRect(piece);
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(r.turned).toBe(true);
    expect(r.w).toBeCloseTo(400 * c + 200 * s, 9);
    expect(r.h).toBeCloseTo(400 * s + 200 * c, 9);
    expect(r.x + r.w / 2).toBeCloseTo(1000, 9);
    expect(r.y + r.h / 2).toBeCloseTo(700, 9);
    // a quarter turn swaps the box
    const q = pieceArtRect({ ...piece, rotation: 90 });
    expect(q.w).toBeCloseTo(200, 9);
    expect(q.h).toBeCloseTo(400, 9);

    const stage = fakeStage();
    const doc = fakeDoc();
    const art = renderPieceArt(stage, piece, doc)!;
    const src = stage.exportArtCanvas.mock.results[0].value;
    expect(art).toBe(doc.made[0]);
    expect([art.width, art.height]).toEqual([400, 200]);
    expect(doc.g.rotate).toHaveBeenCalledWith(expect.closeTo(-Math.PI / 6, 12));
    expect(doc.g.drawImage).toHaveBeenCalledWith(src, -r.w / 2, -r.h / 2, r.w, r.h);
    // the export, read and let go
    expect(src.width).toBe(0);
  });

  it("is nothing for a piece with no size yet, or a stage that gives none", () => {
    expect(renderPieceArt(fakeStage(), { id: "t", cx: 0, cy: 0, w: 0, h: 0, rotation: 0 }, fakeDoc())).toBeNull();
    expect(renderPieceArt({ exportArtCanvas: () => null }, { id: "a", cx: 0, cy: 0, w: 10, h: 10, rotation: 0 }, fakeDoc())).toBeNull();
  });

  it("is kept while the piece only moves or turns, and made again when it is resized or changed", () => {
    const cache = createPieceArtCache();
    const stage = fakeStage();
    const doc = fakeDoc();
    const [fx, fy] = home("front");
    const el = logo("a", fx, fy, 300);
    const first = cache.get(stage, el, pieceOf(el, DIE), doc);
    const moved = { ...el, x: el.x + 0.01, rotation: 0 };
    expect(cache.get(stage, moved, pieceOf(moved, DIE), doc)).toBe(first);
    expect(stage.exportArtCanvas).toHaveBeenCalledTimes(1);
    const bigger = { ...el, scale: 400 / W };
    const again = cache.get(stage, bigger, pieceOf(bigger, DIE), doc);
    expect(again).not.toBe(first);
    expect(first!.width).toBe(0);
    const newArt = { ...bigger, assetRevision: "a-r2" };
    expect(cache.get(stage, newArt, pieceOf(newArt, DIE), doc)).not.toBe(again);
    cache.clear();
  });

  it("leaves the rest of the spot on the zone's rect, or nothing when the piece is alone there", () => {
    const stage = fakeStage();
    const [fx, fy] = home("front");
    const alone = [logo("a", fx, fy), logo("l", ...home("left"))];
    expect(restArtFor(stage, DIE, "front", "a", alone, zoneOf)).toBeNull();
    const two = [...alone, text("t", fx, fy + 200)];
    expect(restArtFor(stage, DIE, "front", "a", two, zoneOf)).not.toBeNull();
    expect(stage.exportArtCanvas).toHaveBeenCalledWith({ color: false, rect: zone("front").rect, exclude: ["a"] });
    expect(restArtFor(stage, DIE, "label_square", "a", two, zoneOf)).toBeNull();
  });
});

describe("the phone's Adjust row", () => {
  const limits = spotLimits(DIE, "left")!;
  const [lx, ly] = home("left");
  const run = (act: string, el: El, piece = pieceOf(el, DIE)!) => adjustAction(act, { element: el, piece, limits, die: DIE });
  /** The press applied (UPDATE_ELEMENT's merge): the piece valid on its spot. */
  function through(el: El, action: Record<string, unknown>) {
    const out = { ...el, ...(action.patch as Record<string, unknown>) } as El;
    expect(zoneOf(out)).toBe("left");
    expect(fitsSpot(out, zone("left"), DIE)).toBe(true);
    return out;
  }

  it("grows and shrinks by a tenth, never past the cap, and says when the cap stops it", () => {
    const el = logo("a", lx, ly, 300);
    const up = run("larger", el);
    expect(up.note).toBe("");
    expect(((up.action!.patch as { scale: number }).scale * W)).toBeCloseTo(330, 6);
    const big = logo("a", lx, ly, 395);
    const capped = run("larger", big);
    expect(capped.note).toBe("That's the largest the left side takes: 2 × 1.5 in.");
    expect(((capped.action!.patch as { scale: number }).scale * W)).toBeCloseTo(400, 6);
    through(big, capped.action!);
    const down = run("smaller", el);
    expect(((down.action!.patch as { scale: number }).scale * W)).toBeCloseTo(300 / 1.1, 6);
    // never under a quarter inch on the shorter side
    const floor = logo("a", lx, ly, 101); // 101 x 50.5 px: down to 50, no further
    expect(((run("smaller", floor).action!.patch as { scale: number }).scale * W)).toBeCloseTo(100, 6);
    expect(run("smaller", logo("a", lx, ly, 100)).action).toBeNull();
  });

  it("turns a degree a press and straightens to the side's level, parallel to the bottom of the hat", () => {
    const el = logo("a", lx, ly, 200, 10);
    expect(run("ccw", el).action!.patch).toEqual({ rotation: 9 });
    expect(run("cw", el).action!.patch).toEqual({ rotation: 11 });
    expect(limits.level).toBe(-7);
    expect(run("straight", el).action!.patch).toEqual({ rotation: -7 });
    expect(run("straight", logo("a", lx, ly, 200, -7)).action).toBeNull();
    // the front's level is the die's own 0
    const [fx, fy] = home("front");
    const front = spotLimits(DIE, "front")!;
    const f = logo("f", fx, fy, 200, 10);
    expect(adjustAction("straight", { element: f, piece: pieceOf(f, DIE)!, limits: front, die: DIE }).action!.patch).toEqual({ rotation: 0 });
  });

  it("reads a turn as whole degrees from the spot's level", () => {
    expect(angleFromLevel(8, 8)).toBe(0);
    expect(angleFromLevel(7.6, 8)).toBe(0);
    expect(angleFromLevel(20, 8)).toBe(12);
    expect(angleFromLevel(0, 8)).toBe(-8);
    expect(angleFromLevel(188, 8)).toBe(180);
    expect(angleFromLevel(-172, 8)).toBe(180);
    expect(angleLabel({ rotation: 0 }, 8)).toBe("−8°");
    expect(angleLabel({ rotation: -7 }, -7)).toBe("0°");
    expect(angleLabel({ rotation: 5 })).toBe("5°");
  });

  it("gives a logo its size back when a turn the cap shrank it for is turned back", () => {
    // A 4.4 x 2.2 in wordmark on the front: turned 1 degree its box is 2.28 in
    // tall, so the 2.25 in cap shrinks it; turning back must not keep that.
    const front = spotLimits(DIE, "front")!;
    const [fx, fy] = home("front");
    const turnAll = (el: El, acts: string[]) => {
      let intent: ReturnType<typeof adjustAction>["intent"] | null = null;
      let at = el;
      for (const act of acts) {
        const piece = pieceOf(at, DIE)!;
        const r = adjustAction(act, { element: at, piece, limits: front, die: DIE, asked: askedSize(intent, piece) });
        if (r.intent !== undefined) intent = r.intent;
        at = { ...at, ...(r.action!.patch as Record<string, unknown>) } as El;
        expect(fitsSpot(at, zone("front"), DIE)).toBe(true);
      }
      return elementPose(at, DIE)!;
    };
    const el = logo("w", fx, fy, 880);
    const turned = turnAll(el, ["cw"]);
    expect(turned.w).toBeLessThan(880 * 0.99);
    const back = turnAll(el, ["cw", "ccw"]);
    expect(back.rotation).toBe(0);
    expect(back.w).toBeCloseTo(880, 6);
    const straight = turnAll(el, ["cw", "cw", "cw", "straight"]);
    expect(straight.rotation).toBe(0);
    expect(straight.w).toBeCloseTo(880, 6);
    // a resize ends the memory: the size asked for is the new one
    const resized = turnAll(el, ["cw", "smaller", "ccw"]);
    expect(resized.w).toBeLessThan(880);
    // and without it (the old behaviour) the shrink stayed
    const piece = pieceOf(logo("w", fx, fy, turned.w, 1), DIE)!;
    const plain = adjustAction("ccw", { element: logo("w", fx, fy, turned.w, 1), piece, limits: front, die: DIE });
    expect(plain.action!.patch).toEqual({ rotation: 0 });
  });

  it("nudges 0.05 in from where the piece is, and stops at the edge, saying so", () => {
    const el = logo("a", lx, ly, 200);
    const right = run("right", el);
    expect(right.action).toMatchObject({ type: "UPDATE_ELEMENT", id: "a", slide: "step" });
    expect(((right.action!.patch as { x: number }).x * W)).toBeCloseTo(lx + 10, 6);
    expect(right.note).toBe("");
    through(el, right.action!);
    const up = run("up", el);
    expect(((up.action!.patch as { y: number }).y * H)).toBeCloseTo(ly - 10, 6);
    // walked into the panel's edge: it stops there, and the last press is no step
    let at = el;
    let last = { action: null as Record<string, unknown> | null, note: "" };
    for (let i = 0; i < 400; i++) {
      last = run("left", at);
      if (!last.action) break;
      at = through(at, last.action);
    }
    expect(last.action).toBeNull();
    expect(last.note).toBe("The left side's logo area ends here.");
  });

  it("centers on the spot's home, as a jump", () => {
    const el = logo("a", lx + 120, ly - 300, 200);
    const c = run("centre", el);
    expect(c.action).toMatchObject({ jump: true });
    const out = through(el, c.action!);
    const p = elementPose(out, DIE)!;
    expect(p.cx).toBeCloseTo(lx, 6);
    expect(p.cy).toBeCloseTo(ly, 6);
  });

  it("reads the size in inches, and has none for a line of text the stage hasn't measured", () => {
    expect(sizeLabel(pieceOf(logo("a", lx, ly, 336), DIE), 200)).toBe("1.68 × 0.84 in");
    const t = text("t", lx, ly);
    expect(sizeLabel(pieceOf(t, DIE), 200)).toBeNull();
    expect(run("larger", t).action).toBeNull();
    expect(run("right", t).action).not.toBeNull();
  });
});

describe("which view a step shows", () => {
  const view = (o: Partial<Parameters<typeof stepView>[0]>) =>
    stepView({ faceStep: true, failed: false, editFailed: false, hatShown: true, ...o });

  it("edits on the hat once it has shown the design, and on the flat spot while it loads", () => {
    expect(view({})).toMatchObject({ editOnHat: true, show3D: true, on3D: true, placing: false, active: true });
    // Loading (a slow connection, a model that never comes): the flat spot,
    // interactive, with the hat painting out of sight so it can take over.
    expect(view({ hatShown: false })).toEqual({ editOnHat: false, loadingHat: true, show3D: false, on3D: false, placing: true, active: true });
    // a desktop's look at the hat while it loads
    expect(view({ hatShown: false, rail: true, peek: true })).toMatchObject({ on3D: true, placing: false, editOnHat: false });
  });

  it("places on the flat spot for good where the hat can't edit or the 3D can't run", () => {
    for (const o of [{ editFailed: true }, { failed: true }]) {
      expect(view(o)).toMatchObject({ editOnHat: false, loadingHat: false, show3D: false, on3D: false, placing: true, active: false });
    }
  });

  it("shows the hat on every other step, loaded or not", () => {
    for (const hatShown of [true, false]) {
      expect(stepView({ faceStep: false, failed: false, editFailed: false, hatShown })).toMatchObject({ editOnHat: false, show3D: true, active: true, placing: false });
    }
    expect(stepView({ faceStep: false, failed: true, editFailed: false, hatShown: false })).toMatchObject({ show3D: false, active: false });
  });
});

describe("a line of text's box from the stage", () => {
  const drawn = text("t", 900, 900, 0.02);
  const stage = { measureElement: (id: string) => (id === "t" ? { w: 200, h: 40 } : null) };
  const measure = stageTextMeasure(() => stage, () => ({ elements: [drawn] }));

  it("is the stage's drawing of it, scaled by how its fontScale has moved since", () => {
    expect(drawnTextBox(stage, { elements: [drawn] }, "t")).toMatchObject({ w: 200, h: 40, fontScale: 0.02 });
    expect(measure({ ...drawn, fontScale: 0.03 })).toEqual({ w: expect.closeTo(300, 9), h: expect.closeTo(60, 9) });
    expect(measure(drawn)).toEqual({ w: 200, h: 40 });
  });

  it("is nothing for new words, a line not drawn yet, a logo or no stage", () => {
    expect(measure({ ...drawn, text: "EST 2001" })).toBeNull();
    expect(measure({ ...drawn, id: "u" })).toBeNull();
    expect(measure(logo("a", 900, 900))).toBeNull();
    expect(stageTextMeasure(() => null, () => ({ elements: [drawn] }))(drawn)).toBeNull();
  });
});

describe("the desktop's LayerControls on a hat die", () => {
  const send = (el: El, patch: Record<string, unknown> | null) => {
    if (!patch) return el;
    const out = { ...el, ...patch } as El;
    expect(fitsSpot(out, zone(zoneOf(out)), DIE)).toBe(true);
    return out;
  };
  const inches = (el: El) => elementPose(el, DIE)!.w / DIE.pxPerInch;

  it("makes a logo a tenth smaller or larger, never smaller than a quarter inch, and Smaller never grows it", () => {
    const [ix, iy] = home("label_tall");
    const label = logo("i", ix, iy, 160); // 0.8 x 0.4 in
    expect(inches(send(label, layerResize(label, -1, DIE)))).toBeCloseTo(0.8 / 1.1, 6);
    expect(inches(send(label, layerResize(label, 1, DIE)))).toBeCloseTo(0.88, 6);
    // 0.26 in on its shorter side: down to 0.25, then no further
    const small = logo("s", ix, iy, 104);
    expect((layerResize(small, -1, DIE)!.scale as number) * W).toBeCloseTo(100, 6);
    expect(layerResize(logo("s", ix, iy, 100), -1, DIE)).toBeNull();
    expect(layerResize(logo("s", ix, iy, 80), -1, DIE)).toBeNull(); // already under it: kept, never grown
  });

  it("makes a line of text a tenth smaller, its font never under a quarter inch", () => {
    const t = text("t", ...home("label_tall"), 0.0188);
    expect(layerResize(t, -1, DIE)).toEqual({ fontScale: expect.closeTo(0.0188 / 1.1, 9) });
    expect(layerResize(text("t", 0, 0, 50 / W), -1, DIE)).toBeNull();
    expect(layerResize(text("t", 0, 0, 40 / W), -1, DIE)).toBeNull();
  });

  it("turns a logo and back to its size, though the cap shrank it on the way", () => {
    const [fx, fy] = home("front");
    const wide = logo("w", fx, fy, 900); // 4.5 x 2.25 in, the front's cap
    const intentRef = { current: null };
    const up = send(wide, layerRotate(wide, 90, { die: DIE, intentRef }));
    expect(elementPose(up, DIE)!.rotation).toBe(90);
    expect(inches(up)).toBeCloseTo(2.25, 3);
    const back = send(up, layerRotate(up, 0, { die: DIE, intentRef }));
    expect(elementPose(back, DIE)!.rotation).toBe(0);
    expect(inches(back)).toBeCloseTo(4.5, 6);
    // nothing to do for the turn it is at
    expect(layerRotate(back, 0, { die: DIE, intentRef })).toBeNull();
  });
});
