// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-restore.test.ts (origin/main d78d90ee); imports point into this package.
/**
 * A design made on the first No. 7 die (hat-no-7) opens on round E1's
 * (hat-no-7-v2, 2026-10-21) wherever it reaches the designer: a draft on this
 * device (hat-draft.js parseHatDraft) and a design link, which a cart line's
 * Edit design is too (hat-import.js, read through the same parse). Every piece
 * keeps its point on the hat (hat-migrate.js, tests/hat-migrate.test.ts) and
 * fits its spot on the new die; a design already on it comes back as it was.
 */
import { describe, expect, it } from "vitest";
import { HAT_NO_7_DIE, HAT_NO_7_V1_DIE } from "../../src/core/hat-config.js";
import { hatFingerprint, onCurrentHatDie, parseHatDraft, serializeHatDraft } from "../../src/core/hat-draft.js";
// Dropped: the "a design link to a design from before round E1" suite (the storefront's lib/hat/hat-import.ts: parseSharedHatDoc and fetchSharedHatDesign).
import { HAT_NO_7_ANCHORS, migrateHatDoc } from "../../src/core/hat-migrate.js";
import { fitsSpot, zoneOfElement } from "../../src/core/hat-placements.js";
import type { HatDie } from "../../src/core/hat-placements.js";

const V1 = HAT_NO_7_V1_DIE as unknown as HatDie;
const V2 = HAT_NO_7_DIE as unknown as HatDie;

type El = Record<string, unknown> & { id: string; x: number; y: number };

/** A logo `wIn` inches wide (2:1) at die px (cx, cy) of `die`. */
function logo(die: HatDie, id: string, cx: number, cy: number, wIn = 1.5): El {
  return {
    id,
    type: "logo",
    x: cx / die.stage.width,
    y: cy / die.stage.height,
    rotation: 0,
    opacity: 1,
    fileName: "Acme.png",
    mimeType: "image/png",
    naturalWidth: 1200,
    naturalHeight: 600,
    scale: (wIn * die.pxPerInch) / die.stage.width,
  };
}
function text(die: HatDie, id: string, cx: number, cy: number): El {
  return {
    id,
    type: "text",
    x: cx / die.stage.width,
    y: cy / die.stage.height,
    rotation: 0,
    opacity: 1,
    text: "EST 1999",
    fontFamily: "Arial, sans-serif",
    fontStyle: "normal",
    fill: "#FFFFFF",
    align: "center",
    fontScale: 0.02,
  };
}
const centre = (die: HatDie, id: string) => {
  const r = die.zones.find((z) => z.id === id)!.rect;
  return [r.x + r.w / 2, r.y + r.h / 2] as const;
};

/** A design from before E1: the front, a side, the back and a square label. */
function v1Design() {
  return {
    schemaVersion: 4,
    kind: "hat",
    dieId: V1.id,
    parts: { crown_FL: "#1F2A44" },
    zones: {
      front: { method: "embroidery" },
      left: { method: "embroidery" },
      label_square: { method: "woven_label", shape: "square", ground: "#F1F0EB" },
    },
    elements: [
      logo(V1, "a", ...centre(V1, "front"), 3),
      text(V1, "b", ...centre(V1, "left")),
      logo(V1, "c", ...centre(V1, "back"), 2),
      logo(V1, "d", ...centre(V1, "label_square"), 0.8),
    ],
  };
}

function draftOf(design: Record<string, unknown>) {
  const png = new Blob(["x"], { type: "image/png" });
  const logos = (design.elements as El[])
    .filter((el) => el.type === "logo")
    .map((el) => ({ elId: el.id, blob: png, fileName: "Acme.png", mimeType: "image/png", naturalWidth: 1200, naturalHeight: 600 }));
  return serializeHatDraft({ design, step: "front", quantity: 100, logos, fonts: [], thumbnail: null, checkout: null, shipping: { express: false } });
}

describe("a draft from before round E1", () => {
  it("opens on the current die, every piece where the migration puts it and valid on its spot", () => {
    const design = v1Design();
    const draft = parseHatDraft(draftOf(design))!;
    expect(draft).not.toBeNull();
    expect(draft.design.dieId).toBe("hat-no-7-v2");
    const want = migrateHatDoc(design, { from: V1, to: V2, ...HAT_NO_7_ANCHORS });
    expect(draft.design.elements).toEqual(want.elements);
    const zones = draft.design.elements.map((el: El) => zoneOfElement(el, V2)?.id);
    // the square label's art is on the one label E1 has, with its choices
    expect(zones).toEqual(["front", "left", "back", "label_tall"]);
    expect(Object.keys(draft.design.zones).sort()).toEqual(["front", "label_tall", "left"]);
    expect(draft.design.zones.label_tall).toMatchObject({ method: "woven_label", shape: "tall", ground: "#F1F0EB" });
    for (const el of draft.design.elements.filter((e: El) => e.type === "logo")) {
      expect(fitsSpot(el, zoneOfElement(el, V2)!, V2), el.id).toBe(true);
    }
    // its logos still have their files
    expect(draft.logos.map((l: { elId: string }) => l.elId)).toEqual(["a", "c", "d"]);
  });

  it("is a different design to the cart, so an upload made for it before is not reused", () => {
    const design = v1Design();
    const draft = parseHatDraft(draftOf(design))!;
    expect(hatFingerprint({ design: draft.design, quantity: 100 })).not.toBe(hatFingerprint({ design, quantity: 100 }));
  });

  it("comes back as it was when it is already on the current die", () => {
    const [fx, fy] = HAT_NO_7_ANCHORS.zonesTo.front;
    const design = { schemaVersion: 4, kind: "hat", dieId: V2.id, parts: {}, zones: { front: { method: "embroidery" } }, elements: [logo(V2, "a", fx, fy)] };
    const draft = parseHatDraft(draftOf(design))!;
    expect(draft.design).toEqual(design);
    expect(onCurrentHatDie(design)).toBe(design);
  });

  it("is read only on a die this storefront has", () => {
    expect(onCurrentHatDie({ ...v1Design(), dieId: "hat-no-9" })).toEqual({ ...v1Design(), dieId: "hat-no-9" });
    expect(parseHatDraft({ ...draftOf(v1Design()), design: { ...v1Design(), dieId: "hat-no-9" } })).toBeNull();
  });
});
