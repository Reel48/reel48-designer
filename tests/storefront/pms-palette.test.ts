// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/pms-palette.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, expect, it } from "vitest";
import { deltaE2000, hexToLab, hexToLch } from "../../src/core/cielab.js";
import {
  buildPmsPalette,
  familyOf,
  nearestPms,
  PMS_COLORS,
  PMS_FILE_COUNT,
  pmsByHex,
  pmsById,
  pmsIdOf,
  searchPms,
} from "../../src/core/pms-palette.js";
import { DEFAULT_PRESET_ID, fabricColourName, HAT_PRESETS, presetOf, presetParts, wholeHatParts } from "../../src/core/hat-config.js";
// Dropped: the "bringing in a palette (scripts/pms-import.mjs)" suite; the import script is storefront tooling and not in the package.
// Adapted: the palette file is src/core/pms-solid-coated.js (the same JSON as a default export).
import PALETTE_FILE from "../../src/core/pms-solid-coated.js";

/**
 * The hat's Pantone palette (2026-10-21): the file, the lookups a design's
 * hex is named by, the picker's search, and the converter that brings in the
 * list Brayden chose. Written against whatever the palette file carries, so
 * they hold through a palette update.
 */

describe("the palette file", () => {
  it("is every entry valid, with one code and one hex each", () => {
    // The loader drops a bad or repeated entry; here that fails loudly.
    expect(PMS_COLORS.length).toBe(PMS_FILE_COUNT);
    expect(new Set(PMS_COLORS.map((c) => c.id)).size).toBe(PMS_COLORS.length);
    expect(new Set(PMS_COLORS.map((c) => c.hex)).size).toBe(PMS_COLORS.length);
    for (const c of PMS_COLORS) {
      expect(c.code).toMatch(/^PMS .+ C$/);
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.id).toBe(pmsIdOf(c.code));
    }
  });

  it("says where it came from and how it was converted", () => {
    expect(PALETTE_FILE.source.url).toMatch(/^https:\/\/github\.com\/aj90909\/unofficial-pantone-solid-coated-2024-v5\//);
    expect(PALETTE_FILE.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(PALETTE_FILE.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PALETTE_FILE.source.entries).toBe(PMS_FILE_COUNT);
    expect(PALETTE_FILE.conversion).toMatch(/Bradford/);
    expect("standIn" in PALETTE_FILE).toBe(false);
    const codes = new Set(PMS_COLORS.map((c) => c.code));
    for (const code of [...PALETTE_FILE.outOfGamut, ...PALETTE_FILE.nudged]) expect(codes.has(code)).toBe(true);
  });

  it("names a hex by its code, in any case, and nothing off the palette", () => {
    const c = PMS_COLORS[0];
    expect(pmsByHex(c.hex.toLowerCase())).toBe(c);
    expect(pmsById(c.id)).toBe(c);
    expect(pmsByHex("#123457")).toBeNull();
    expect(pmsById("constructor")).toBeNull();
  });

  it("reads a hex a code used to have as that code, never over a colour's own hex", () => {
    const { byFormer } = buildPmsPalette([
      { code: "PMS 1 C", hex: "#102030", was: ["#405060", "#405061"] },
      { code: "PMS 2 C", hex: "#405061" },
    ]);
    expect(byFormer.get("#405060")?.code).toBe("PMS 1 C");
    expect(byFormer.has("#405061")).toBe(false);
  });

  it("finds the nearest colour by CIEDE2000", () => {
    const c = PMS_COLORS[0];
    expect(nearestPms(c.hex)).toBe(c);
    const off = "#123457";
    const best = [...PMS_COLORS].sort((a, b) => deltaE2000(hexToLab(off)!, a.lab) - deltaE2000(hexToLab(off)!, b.lab))[0];
    expect(nearestPms(off)).toBe(best);
    expect(nearestPms("not a colour")).toBeNull();
  });

  it("has every preset on it, the default among them, each sweatband included", () => {
    expect(HAT_PRESETS.map((p) => p.id)).toEqual(["navy", "black", "white", "stone", "charcoal", "red", "royal", "forest"]);
    expect(new Set(HAT_PRESETS.map((p) => p.pms)).size).toBe(HAT_PRESETS.length);
    expect(HAT_PRESETS.some((p) => p.id === DEFAULT_PRESET_ID)).toBe(true);
    for (const p of HAT_PRESETS) {
      expect(pmsByHex(p.hex)?.id).toBe(p.pms);
      const parts = presetParts(p.id);
      expect(presetOf(parts)).toBe(p.id);
      expect(parts.sweatband).toMatch(/^#[0-9A-F]{6}$/);
      expect(fabricColourName(p.hex)).toBe(`${p.label}, ${p.code}`);
    }
    // One colour that is no preset is named by its code alone.
    const other = PMS_COLORS.find((c) => !HAT_PRESETS.some((p) => p.pms === c.id));
    if (other) {
      expect(presetOf(wholeHatParts(other.hex))).toBeNull();
      expect(fabricColourName(other.hex)).toBe(other.code);
    }
  });
});

describe("finding a Pantone colour", () => {
  it("by its code, its number, or with PMS or PANTONE in front, the exact one first", () => {
    for (const c of PMS_COLORS.slice(0, 5)) {
      const bare = c.name.replace(/ C$/, "");
      expect(searchPms(bare)[0]).toBe(c);
      expect(searchPms(c.code)[0]).toBe(c);
      expect(searchPms(`pantone ${c.name.toLowerCase()}`)[0]).toBe(c);
      // Written the way codes often are: no space before the C, PMS run on.
      expect(searchPms(`${bare}c`)[0]).toBe(c);
      expect(searchPms(`PMS${bare}C`)[0]).toBe(c);
    }
  });

  it("by hue family, and by the nearest to a hex", () => {
    const c = PMS_COLORS[0];
    expect(searchPms("", c.family)).toContain(c);
    expect(searchPms("", c.family).every((x) => x.family === c.family)).toBe(true);
    expect(searchPms(c.hex.slice(1))[0]).toBe(c);
    expect(searchPms("", "all")).toHaveLength(PMS_COLORS.length);
    expect(searchPms("zzzz")).toEqual([]);
  });

  it("puts named colours in the family they look like", () => {
    const fam = (hex: string) => familyOf(hexToLch(hex)!);
    expect(fam("#FF0000")).toBe("red");
    expect(fam("#FFC0CB")).toBe("pink");
    expect(fam("#FFA500")).toBe("orange");
    expect(fam("#FFFF00")).toBe("yellow");
    expect(fam("#00FF00")).toBe("green");
    expect(fam("#0000FF")).toBe("blue");
    expect(fam("#800080")).toBe("purple");
    expect(fam("#8B4513")).toBe("brown");
    expect(fam("#808080")).toBe("neutral");
  });
});

describe("CIEDE2000", () => {
  it("matches Sharma, Wu and Dalal's published pairs", () => {
    const ref = { L: 50, a: 0, b: -82.7485 };
    expect(deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, ref)).toBeCloseTo(2.0425, 4);
    expect(deltaE2000({ L: 50, a: 3.1571, b: -77.2803 }, ref)).toBeCloseTo(2.8615, 4);
    expect(deltaE2000({ L: 50, a: 2.8361, b: -74.02 }, ref)).toBeCloseTo(3.4412, 4);
  });
});
