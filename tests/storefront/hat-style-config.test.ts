// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-style-config.test.ts (origin/main d78d90ee); imports point into this package.
/**
 * The hat style registry (S1, 2026-10-23): the No. 7's values moved into one
 * entry, unchanged, and every reader taking them from the style of the die it
 * holds, so a second 3D style is one more entry here, not a fork of the
 * designer. The modules the model labs copy byte for byte (hat-look.js,
 * sweatband.js) import nothing of it, so their own defaults must stay the
 * No. 7's. S2 (2026-10-24) adds the No. 6.
 */
// Dropped: "are the only places the No. 7's part ids are written" (scans the storefront's src/lib/hat and components for part-id literals).
// Adapted: hat3DFilesOf takes the host's URLs now (GLB stands in for them; only the frame is asserted); the lab-copied-module import checks read src/viewer/hat-look.js and src/core/sweatband.js.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dieGeometry } from "../../src/core/index.js";
import {
  HAT_DIES,
  HAT_NO_6_DIE,
  HAT_NO_7_DIE,
  HAT_PART_GROUPS,
  HAT_PARTS,
  SPOT_AREAS,
  SPOT_LEVELS,
  hatDie,
  presetOf,
  presetParts,
  spotFact,
  spotHome,
  spotLevel,
  wholeHatParts,
} from "../../src/core/hat-config.js";
import { DEFAULT_HAT_STYLE, HAT_DESIGN_STYLES, chosenPartsOf, hatStyleOf } from "../../src/core/hat-style-config.js";
import { SWEATBANDS, SWEATBAND_FOLLOWS, labelGroundFor, withSweatband } from "../../src/core/sweatband.js";
import { hatFixedMarks } from "../../src/core/hat-spec.js";
import { pmsById, pmsIdOf } from "../../src/core/pms-palette.js";
import { DEFAULT_COLOR, PART_FOLLOWS, TAG_LOGO, resolvePartColors } from "../../src/viewer/hat-look.js";
import { hat3DFilesOf } from "../../src/viewer/hat-3d-assets.js";
import { pointInArea } from "../../src/core/region.js";

const NO_7 = hatStyleOf("no-7");
const NO_6 = hatStyleOf("no-6");
const GLB = { model: "hat.glb" };
const read = (p: string) => readFileSync(p, "utf8");

describe("the registry", () => {
  it("knows every hat die a stored design may name, each under its own product's style", () => {
    for (const die of Object.values(HAT_DIES)) {
      expect(hatStyleOf(die.id).handle, die.id).toBe(die.productHandle);
    }
    for (const style of Object.values(HAT_DESIGN_STYLES)) {
      expect(hatStyleOf(style.handle)).toBe(style);
      expect(style.dieIds).toContain(style.currentDieId);
      expect(hatDie(style.currentDieId)?.supersededBy).toBeUndefined();
      for (const id of style.dieIds) expect(hatDie(id)?.productHandle, id).toBe(style.handle);
      for (const id of Object.keys(style.spotLevels)) expect(style.dieIds).toContain(id);
      // Every part a rule names is one of the style's own.
      const ids = style.parts.map((p) => p.id);
      const named = [
        ...chosenPartsOf(style),
        style.sweatbandFollows,
        style.tagLogo.follows,
        ...Object.values(style.zonePart),
        ...Object.entries(style.partFollows).flat(),
        ...style.neverOwn,
        ...style.plasticParts,
      ];
      for (const id of named) expect(ids, `${style.handle}: ${id}`).toContain(id);
      expect(Object.keys(style.groupView)).toEqual(expect.arrayContaining(style.partGroups.map((g) => g.id)));
      // Levels and homes only on the style's own dies, and each home inside its area.
      for (const [id, homes] of Object.entries(style.spotHomes)) {
        expect(style.dieIds).toContain(id);
        for (const [zoneId, [x, y]] of Object.entries(homes)) {
          const area = hatDie(id)!.zones.find((z) => z.id === zoneId)!.area!;
          expect(pointInArea(area as never, x, y), `${id} ${zoneId}`).toBe(true);
        }
      }
    }
    expect(Object.keys(HAT_DIES)).toEqual(Object.values(HAT_DESIGN_STYLES).flatMap((s) => s.dieIds));
  });

  it("levels each die's spots as the designer package's die file says, where it says", () => {
    for (const die of Object.values(HAT_DIES)) {
      for (const z of dieGeometry(die.id).zones as { id: string; level?: number }[]) {
        if (typeof z.level === "number") expect(spotLevel(die.id, z.id), `${die.id} ${z.id}`).toBe(z.level);
      }
    }
  });

  it("falls back to the No. 7 for anything it does not know", () => {
    expect(DEFAULT_HAT_STYLE).toBe(NO_7);
    for (const x of ["hat-unknown", "constructor", "", undefined, null, 7]) expect(hatStyleOf(x)).toBe(NO_7);
    expect(hatFixedMarks({ dieId: "hat-unknown" })).toEqual(["REEL48 strap tab: standard"]);
  });
});

describe("the No. 7's entry", () => {
  it("holds what each reader had before (S1 moved the values, unchanged)", () => {
    expect(NO_7.dieIds).toEqual(["hat-no-7", "hat-no-7-v2"]);
    expect(NO_7.currentDieId).toBe("hat-no-7-v2");
    expect(NO_7.parts.map((p) => p.id)).toEqual([
      "crown_FL", "crown_FR", "crown_LS", "crown_RS", "crown_LB", "crown_RB", "bill_top", "bill_under",
      "button", "eyelet", "binding", "sweatband", "strap", "tape",
    ]);
    expect(NO_7.partGroups.map((g) => [g.id, g.parts])).toEqual([
      ["front", ["crown_FL", "crown_FR"]],
      ["sideBack", ["crown_LS", "crown_RS", "crown_LB", "crown_RB"]],
      ["billTop", ["bill_top"]],
      ["billUnder", ["bill_under"]],
      ["button", ["button"]],
      ["eyelets", ["eyelet"]],
      ["strap", ["strap"]],
    ]);
    expect(NO_7).toMatchObject({
      partFollows: { tape: "crown_LB", binding: "crown_LB" },
      neverOwn: ["tape"],
      plasticParts: [],
      sweatbandFollows: "crown_FL",
      tagLogo: { follows: "strap" },
      zonePart: { front: "crown_FL", left: "crown_LS", right: "crown_RS", back: "crown_LB" },
      spotLevels: { "hat-no-7-v2": { left: -7, right: 8 } },
      fixedMarks: ["REEL48 strap tab: standard"],
    });
    // The names the readers knew still say the same.
    expect(HAT_PARTS).toBe(NO_7.parts);
    expect(HAT_PART_GROUPS).toBe(NO_7.partGroups);
    expect(SPOT_AREAS).toBe(NO_7.spotAreas);
    expect(SPOT_LEVELS["hat-no-7-v2"]).toEqual(NO_7.spotLevels["hat-no-7-v2"]);
    expect(HAT_NO_7_DIE.id).toBe(NO_7.currentDieId);
    expect(NO_7.spotHomes).toEqual({});
    expect(hat3DFilesOf(NO_7, GLB)?.frame).toEqual(HAT_NO_7_DIE.stage);
    expect(hat3DFilesOf(NO_6, GLB)?.frame).toEqual(HAT_NO_6_DIE.stage);
  });

  it("is what the lab-copied modules do for a host that names no style", () => {
    expect(PART_FOLLOWS).toEqual(NO_7.partFollows);
    expect(TAG_LOGO.follows).toBe(NO_7.tagLogo.follows);
    expect(SWEATBAND_FOLLOWS).toBe(NO_7.sweatbandFollows);
    expect(resolvePartColors({ crown_LB: "#25473A", tape: "#FF0000" }, ["tape"]).tape).toBe("#25473A");
    // The labs load them without the registry: hat-look.js imports nothing,
    // sweatband.js only cielab.js.
    const imports = (p: string) => [...read(p).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports("src/viewer/hat-look.js")).toEqual([]);
    expect(imports("src/core/sweatband.js")).toEqual(["./cielab.js"]);
  });
});

describe("the No. 6's entry", () => {
  it("is the No. 6 labs' corrections and Brayden's No. 6 decisions", () => {
    expect(NO_6).toMatchObject({ handle: "no-6", label: "No. 6", dieIds: ["hat-no-6"], currentDieId: "hat-no-6" });
    expect(HAT_NO_6_DIE).toMatchObject({ id: "hat-no-6", productHandle: "no-6", stage: { width: 3480, height: 2336 } });
    expect(NO_6.parts.map((p) => p.id)).toEqual([
      "crown_F", "crown_LS", "crown_RS", "crown_LB", "crown_RB", "bill_top", "bill_under",
      "button", "eyelet", "binding", "sweatband", "tape", "snap", "snap_tag",
    ]);
    // One front panel, no strap, and no snapback row: the snapback is not the customer's pick.
    expect(NO_6.partGroups.map((g) => [g.id, g.parts])).toEqual([
      ["front", ["crown_F"]],
      ["sideBack", ["crown_LS", "crown_RS", "crown_LB", "crown_RB"]],
      ["billTop", ["bill_top"]],
      ["billUnder", ["bill_under"]],
      ["button", ["button"]],
      ["eyelets", ["eyelet"]],
    ]);
    expect(NO_6).toMatchObject({
      partFollows: { tape: "crown_LB", binding: "crown_LB", snap: "crown_LB", snap_tag: "crown_LB" },
      neverOwn: ["tape", "binding", "snap", "snap_tag"],
      plasticParts: ["snap"],
      sweatbandFollows: "crown_F",
      tagLogo: { follows: "snap_tag" },
      zonePart: { front: "crown_F", left: "crown_LS", right: "crown_RS", back: "crown_LB" },
      spotLevels: { "hat-no-6": { left: -6, right: 6 } },
      fixedMarks: ["REEL48 snapback tag: standard", "Snapback: plastic, matched to the back panels"],
    });
    // The sides land low on their panels, not at the area's mid-panel home.
    expect(spotHome("hat-no-6", "left")).toEqual([2088.17, 1060.42]);
    expect(spotHome("hat-no-6", "label_tall")).toBeNull();
    expect(spotHome("hat-no-7-v2", "left")).toBeNull();
  });
});

describe("the readers, on the No. 6", () => {
  const white = pmsById(pmsIdOf("PMS 9285 C"))!.hex;
  const navy = pmsById(pmsIdOf("PMS 533 C"))!.hex;

  it("colour its own rows, and its sweatband from its one front panel", () => {
    const parts = wholeHatParts(white, NO_6);
    expect(parts).toEqual({
      crown_F: white, crown_LS: white, crown_RS: white, crown_LB: white, crown_RB: white,
      bill_top: white, bill_under: white, button: white, eyelet: white, sweatband: SWEATBANDS.white.hex,
    });
    expect(presetOf(presetParts("navy", NO_6), NO_6)).toBe("navy");
    expect(presetOf(presetParts("navy", NO_6))).toBeNull();
    expect(labelGroundFor({ crown_F: white }, NO_6.sweatbandFollows)).toBe(SWEATBANDS.white.hex);
    // Followed by the No. 7's part, its band would come off.
    expect(withSweatband({ crown_F: white })).toEqual({ crown_F: white });
    expect(hatFixedMarks({ dieId: "hat-no-6" })).toEqual(NO_6.fixedMarks);
  });

  it("show the snapback, its tag, the tapes and the binding in the back panels' colour, never their own", () => {
    const rules = { follows: NO_6.partFollows, neverOwn: NO_6.neverOwn };
    expect(
      resolvePartColors({ crown_LB: navy, snap: "#FF0000", snap_tag: "#00FF00", binding: "#0000FF" }, ["snap", "snap_tag", "tape", "binding"], DEFAULT_COLOR, rules),
    ).toEqual({ snap: navy, snap_tag: navy, tape: navy, binding: navy });
  });

  it("say its spots in its own words", () => {
    const fact = (id: string) => spotFact(HAT_NO_6_DIE.zones.find((z) => z.id === id)!, NO_6);
    expect(fact("front")).toBe("Anywhere on the flat front face, up to 4.5 × 2.25 in");
    expect(fact("left")).toBe("Anywhere on the whole side panel, up to 2 × 1.5 in");
    expect(fact("back")).toBe("Anywhere above the snapback, up to 2.5 × 0.875 in");
    expect(fact("label_tall")).toBe("A 1.75 × 1 in rectangle");
  });
});
