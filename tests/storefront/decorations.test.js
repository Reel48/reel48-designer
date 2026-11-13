// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/decorations.test.js (origin/main d78d90ee); imports point into this package.
import { describe, it, expect } from "vitest";
import { decorationLabel } from "../../src/core/decorations.js";
// Dropped: "covers every hat decoration in the pricing set" (imports the storefront pricing.ts) and "covers every decoration slug the catalog seed writes" (reads the storefront scripts/price-guide.json); both test storefront-only data.

/**
 * The label map used to exist in five places and drifted: the copy in
 * DecorationTypeSelector predated the coozie, so /products/custom-coozie shipped
 * showing customers the raw slugs "no_magnet" and "with_magnet".
 *
 * These tests pin the two ways that can happen again — a slug the catalog seeds
 * but the map doesn't know, and a slug the admin's allow-list would strip.
 */
describe("decoration labels", () => {
  it("includes the coozie magnet options — the slugs that regressed", () => {
    // Just the magnet: the die is a separate product, so the size reaches the
    // cart line and the order emails as the product title instead.
    expect(decorationLabel("no_magnet")).toBe("No Magnet");
    expect(decorationLabel("with_magnet")).toBe("With Magnet");
  });

  it("falls back to the raw slug instead of rendering blank", () => {
    expect(decorationLabel("brand_new_thing")).toBe("brand_new_thing");
    expect(decorationLabel(null)).toBe("");
  });
});
