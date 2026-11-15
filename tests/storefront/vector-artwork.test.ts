// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/vector-artwork.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASPECT,
  isVectorFile,
  readVectorAspect,
  sniffVectorKind,
  standInFileName,
  standInSize,
} from "../../src/core/vector-artwork.js";
// Dropped: "where an original may be stored" (contentTypesFor is storefront server code, design-storage).

/**
 * AI, EPS and PDF logos (Brayden, 2026-10-17: "upload it, we finish it"):
 * a file is taken by what its bytes say, placed as a box of its artboard's
 * shape, and stored only under an artwork-N name.
 */

const bytes = (text: string) => new TextEncoder().encode(text);

describe("what a file's bytes say it is", () => {
  it("knows a PDF (and an Illustrator file, which carries a PDF header), even after junk", () => {
    expect(sniffVectorKind(bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe("pdf");
    expect(sniffVectorKind(bytes(`${"x".repeat(300)}%PDF-1.4`))).toBe("pdf");
  });

  it("knows an EPS, a legacy .ai, and the binary DOS EPS wrapper", () => {
    expect(sniffVectorKind(bytes("%!PS-Adobe-3.0 EPSF-3.0"))).toBe("postscript");
    expect(sniffVectorKind(new Uint8Array([0xc5, 0xd0, 0xd3, 0xc6, 0x1e, 0, 0, 0]))).toBe("postscript");
  });

  it("refuses anything else, whatever its name", () => {
    expect(sniffVectorKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
    expect(sniffVectorKind(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffVectorKind(bytes(`${"x".repeat(2000)}%PDF-1.4`))).toBeNull();
    expect(sniffVectorKind(new Uint8Array())).toBeNull();
  });

  it("treats .ai, .eps and .pdf names, and the types browsers report, as vector files", () => {
    expect(isVectorFile({ name: "Acme Logo.AI", type: "" })).toBe(true);
    expect(isVectorFile({ name: "mark", type: "application/pdf" })).toBe(true);
    expect(isVectorFile({ name: "logo.png", type: "image/png" })).toBe(false);
  });
});

describe("the stand-in box's shape", () => {
  it("is a PDF's page and an EPS's bounding box, the high-resolution one first", () => {
    expect(readVectorAspect(bytes("%PDF-1.4 /Type /Page /MediaBox [0 0 612 792]"), "pdf")).toBeCloseTo(612 / 792);
    expect(
      readVectorAspect(bytes("%!PS-Adobe-3.0\n%%BoundingBox: 0 0 301 100\n%%HiResBoundingBox: 0 0 300.5 100.25"), "postscript"),
    ).toBeCloseTo(300.5 / 100.25);
    expect(readVectorAspect(bytes("%!PS-Adobe-3.0\n%%BoundingBox: 10 10 210 110"), "postscript")).toBe(2);
  });

  it("falls back to 3:2 when the box can't be read, and stays between 1:4 and 4:1", () => {
    expect(readVectorAspect(bytes("%PDF-1.5 (compressed object streams)"), "pdf")).toBe(DEFAULT_ASPECT);
    expect(readVectorAspect(bytes("%PDF-1.4 /MediaBox [0 0 0 792]"), "pdf")).toBe(DEFAULT_ASPECT);
    expect(readVectorAspect(bytes("%PDF-1.4 /MediaBox [0 0 5000 100]"), "pdf")).toBe(4);
  });

  it("is drawn 1200 px on its longer side, and named for the file it stands in for", () => {
    expect(standInSize(1.5)).toEqual({ width: 1200, height: 800 });
    expect(standInSize(0.5)).toEqual({ width: 600, height: 1200 });
    expect(standInFileName("Acme Logo.ai")).toBe("Acme Logo.ai-stand-in.png");
  });
});
