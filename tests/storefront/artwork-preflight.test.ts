// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/artwork-preflight.test.ts (origin/main d78d90ee); imports point into this package.
// Dropped: everything that tests the storefront's lib/artwork-preflight.ts (hasPrintableArtwork, logoPrint, isLowRes, lowResLogos, inchesLabel, LOW_RES_PPI), which is not in the package. Kept: the isUnprintedDesign assertions, which exercise the packaged design-lines.js.
import { describe, expect, it } from "vitest";
import { isUnprintedDesign } from "../../src/core/design-lines.js";

const logo = (naturalWidth: number, scale = 0.4, mimeType = "image/png") => ({ type: "logo", naturalWidth, scale, mimeType });

describe("blank designs", () => {
  it("names a designed line with an empty layout unprinted, and nothing else", () => {
    const designed = { designId: "d1", designProofUrl: "https://x/proof.png" };
    expect(isUnprintedDesign({ ...designed, designJson: { elements: [] } })).toBe(true);
    expect(isUnprintedDesign({ ...designed, designJson: { elements: [logo(400)] } })).toBe(false);
    // Stored before layouts existed: unknown, not unprinted.
    expect(isUnprintedDesign({ ...designed, designJson: null })).toBe(false);
    // The no-JS blank line is BLANK, a different thing.
    expect(isUnprintedDesign({ designId: null, designProofUrl: null, designJson: { blank: true } })).toBe(false);
  });
});
