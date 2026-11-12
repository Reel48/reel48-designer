// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/sweatband.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, expect, it } from "vitest";
import { labelGroundFor, SWEATBANDS, sweatbandFor, withSweatband } from "../../src/core/sweatband.js";
import { PMS_COLORS } from "../../src/core/pms-palette.js";

/**
 * The sweatband follows the front panels (Brayden, 2026-10-21; 2026-10-22:
 * "a good amount of brown hats give default white headbands. These hats
 * should have black default sweatbands. To have a white sweatband, the hat
 * needs to be very close to a white color"): white only for a nearly white
 * hat, grey for a grey one, black for everything else, charcoal included.
 * These are the examples the CIELAB bounds were tuned on, real PMS C colours
 * from the palette (pms-solid-coated.json).
 */
const EXAMPLES: [string, string, "black" | "grey" | "white"][] = [
  ["dark brown", "PMS 4625 C", "black"],
  ["brown", "PMS 7504 C", "black"],
  ["light brown", "PMS 4665 C", "black"],
  ["tan", "PMS 7502 C", "black"],
  ["stone", "PMS 4240 C", "black"],
  ["light blue", "PMS 277 C", "black"],
  ["pastel pink", "PMS 182 C", "black"],
  ["cream", "PMS 7401 C", "black"],
  ["navy", "PMS 533 C", "black"],
  ["red", "PMS 10416 C", "black"],
  ["black", "PMS 419 C", "black"],
  ["charcoal", "PMS 10393 C", "black"],
  ["mid grey", "PMS Cool Gray 7 C", "grey"],
  ["light grey", "PMS Cool Gray 1 C", "grey"],
  ["warm grey", "PMS 7529 C", "grey"],
  ["pale lilac grey", "PMS 663 C", "grey"],
  ["white", "PMS 9285 C", "white"],
  ["off-white", "PMS 9224 C", "white"],
  ["grey white", "PMS 9043 C", "white"],
];
const hexOf = (code: string) => PMS_COLORS.find((c) => c.code === code)?.hex;

describe("the sweatband", () => {
  it.each(EXAMPLES)("is %s's band: %s gets %s", (_name, code, band) => {
    expect(hexOf(code), code).toBeTruthy();
    expect(sweatbandFor(hexOf(code))).toBe(band);
  });

  it("is white only for the nearly white few of the palette", () => {
    const white = PMS_COLORS.filter((c) => sweatbandFor(c.hex) === "white");
    // 26 of 3,219 on 2026-10-22: the 9000s near-whites and 656 C
    expect(white.length).toBeGreaterThan(10);
    expect(white.length).toBeLessThan(40);
    expect(sweatbandFor("#FFFFFF")).toBe("white");
  });

  it("reads any case, and nothing that is not a hex", () => {
    expect(sweatbandFor("#d8dada")).toBe("grey");
    expect(sweatbandFor("navy")).toBeNull();
    expect(sweatbandFor(undefined)).toBeNull();
  });

  it("is written into the parts from the front panels, replacing a chosen one", () => {
    const parts = withSweatband({ crown_FL: "#F1F0EB", crown_FR: "#1F2A44", sweatband: "#A42A2E" });
    expect(parts).toEqual({ crown_FL: "#F1F0EB", crown_FR: "#1F2A44", sweatband: SWEATBANDS.white.hex });
    // Already right: the same object, so a reducer sees no change.
    expect(withSweatband(parts)).toBe(parts);
    // Nothing to follow: no band.
    expect(withSweatband({ bill_top: "#1F2A44", sweatband: "#FFFFFF" })).toEqual({ bill_top: "#1F2A44" });
  });
});

describe("the inside label's default ground", () => {
  it("is the sweatband's colour, following the front panels", () => {
    expect(labelGroundFor({ crown_FL: hexOf("PMS 4625 C") })).toBe(SWEATBANDS.black.hex);
    expect(labelGroundFor({ crown_FL: hexOf("PMS Cool Gray 7 C") })).toBe(SWEATBANDS.grey.hex);
    expect(labelGroundFor({ crown_FL: hexOf("PMS 9285 C") })).toBe(SWEATBANDS.white.hex);
  });

  it("is the black band's with no front colour yet", () => {
    expect(labelGroundFor({})).toBe(SWEATBANDS.black.hex);
    expect(labelGroundFor(undefined)).toBe(SWEATBANDS.black.hex);
  });
});
