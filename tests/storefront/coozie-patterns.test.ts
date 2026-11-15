// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/coozie-patterns.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, expect, it } from "vitest";
import {
  COOZIE_PATTERNS,
  PATTERN_FAMILIES,
  patternById,
  patternGroups,
  patternName,
  patternPrintPath,
  patternRepeatIn,
  patternTile,
} from "../../src/core/coozie-patterns.js";
import { describeDesign, specToTextLines } from "../../src/core/coozie-spec.js";
// Dropped (they read the storefront's public/ files, next.config.ts or design-import.ts, none of which are in the package): "every tile, print file and thumb exists in public/", the next.config.ts cache-header assertion inside "files carry a version", "an SVG tile has whole-pixel dimensions", "production's files open at their true size", and the "a shared design link" suite.

/**
 * Can cooler background patterns (Brayden, 2026-11-10). The registry is
 * generated (scripts/patterns/), and an order stores only a pattern's id, so
 * these pin what an order depends on: every id resolves to files that exist,
 * the production spec names the right print file for the can size, and only a
 * real id survives the server and a shared link.
 */

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("the pattern registry", () => {
  it("has the 32 colourways Brayden approved, ids unique and kebab-case", () => {
    expect(COOZIE_PATTERNS).toHaveLength(32);
    const ids = COOZIE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID_RE);
  });

  it("names, colours and repeats are well formed", () => {
    const families = new Set(PATTERN_FAMILIES.map((f) => f.id));
    for (const p of COOZIE_PATTERNS) {
      expect(families.has(p.family), p.id).toBe(true);
      expect(p.ground, p.id).toMatch(/^#[0-9A-F]{6}$/i);
      expect(p.pixelRatio, p.id).toBeGreaterThan(0);
      for (const size of ["standard", "slim"]) {
        const [w, h] = patternRepeatIn(p, size)!;
        expect(w, p.id).toBeGreaterThan(0);
        expect(h, p.id).toBeGreaterThan(0);
      }
      // Site copy rules: no em dashes, and the product noun is can cooler.
      for (const s of [p.label, p.colorway]) {
        expect(s, p.id).not.toMatch(/—/);
        expect(s.toLowerCase(), p.id).not.toMatch(/koozie|coozie/);
      }
    }
  });

  it("files carry a version, so serving them immutable is safe", () => {
    for (const p of COOZIE_PATTERNS) {
      const files = [
        ...(p.files ? Object.values(p.files) : [p.file]),
        ...(p.printFiles ? Object.values(p.printFiles) : [p.printFile]),
      ].filter(Boolean) as string[];
      for (const f of [...files, p.thumb]) expect(f, p.id).toMatch(/\.v\d+(\.print)?\.(svg|png|webp)$/);
    }
  });
});

describe("a patterned design's production spec", () => {
  const doc = (patternId: unknown, size = "standard") => ({
    schemaVersion: 3,
    size,
    color: "#B2AEA6",
    patternId,
    elements: [],
  });

  it("names the pattern and colourway, the print file and the repeat", () => {
    const spec = describeDesign(doc("duck-camo-slate"));
    expect(spec && "pattern" in spec).toBe(true);
    const s = spec as Exclude<typeof spec, null> & { patternFile: string; patternRepeatIn: number[] };
    expect(s.pattern).toBe("Duck camo, Slate");
    expect(s.patternFile).toBe(`https://www.reel48.com${patternPrintPath(patternById("duck-camo-slate"), "standard")}`);
    expect(s.patternFile).toMatch(/\.print\.svg$/);
    expect(s.patternRepeatIn).toEqual(patternRepeatIn(patternById("duck-camo-slate"), "standard"));
    const lines = specToTextLines(s as Parameters<typeof specToTextLines>[0]).join("\n");
    expect(lines).toContain("Pattern: Duck camo, Slate");
    expect(lines).toContain(`Print file: ${s.patternFile}`);
    expect(lines).toContain("turned 180°, starting from its bottom-right corner on the flat die");
  });

  it("gives a slim flag the slim print file", () => {
    const s = describeDesign(doc("flag-classic", "slim")) as { patternFile: string };
    expect(s.patternFile).toBe(`https://www.reel48.com${patternPrintPath(patternById("flag-classic"), "slim")}`);
  });

  it("an order keeps the print file it was placed with, even after a redraw", () => {
    const placed = { ...doc("duck-camo-slate"), patternPrint: "/patterns/duck-camo-slate.v1.print.svg", patternRepeatIn: [5.5, 3.09] };
    const later = { ...placed, patternPrint: "/patterns/duck-camo-slate.v7.print.svg", patternRepeatIn: [6, 3.4] };
    expect((describeDesign(placed) as { patternFile: string }).patternFile).toBe(
      "https://www.reel48.com/patterns/duck-camo-slate.v1.print.svg",
    );
    const s = describeDesign(later) as { patternFile: string; patternRepeatIn: number[] };
    expect(s.patternFile).toBe("https://www.reel48.com/patterns/duck-camo-slate.v7.print.svg");
    expect(s.patternRepeatIn).toEqual([6, 3.4]);
    // Anything but a plain /patterns/ path is ignored for the registry's file.
    const odd = { ...placed, patternPrint: "https://evil.example/x.svg" };
    expect((describeDesign(odd) as { patternFile: string }).patternFile).toBe(
      `https://www.reel48.com${patternPrintPath(patternById("duck-camo-slate"), "standard")}`,
    );
  });

  it("an old or unknown id keeps its label fallback and has no file", () => {
    const s = describeDesign(doc("stripes")) as { pattern: string; patternFile: unknown };
    expect(s.pattern).toBe("#stripes");
    expect(s.patternFile).toBeNull();
    const plain = describeDesign(doc(null)) as { pattern: unknown; patternFile: unknown };
    expect(plain.pattern).toBeNull();
    expect(plain.patternFile).toBeNull();
  });

  it("names the pattern the way the designer does", () => {
    expect(patternName(patternById("bandana-red"))).toBe("Bandana, Red");
  });
});
