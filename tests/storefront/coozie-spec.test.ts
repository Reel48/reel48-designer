// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/coozie-spec.test.ts (origin/main d78d90ee); imports point into this package.
import { describe, it, expect } from "vitest";
import { describeDesign, specToTextLines } from "../../src/core/coozie-spec.js";

/**
 * These assertions are about the production hand-off, not formatting taste: the
 * order email and /admin/orders both render from describeDesign(), so a design
 * that silently loses its text copy, its logo filename, or its placement is an
 * order that gets made wrong.
 */

const DOC = {
  schemaVersion: 1,
  color: "#1C2E4A",
  patternId: null,
  elements: [
    {
      id: "a",
      type: "text",
      x: 0.5,
      y: 0.25,
      rotation: 0,
      opacity: 1,
      text: "Quakertown Wrestling",
      fontFamily: "Impact, Charcoal, sans-serif",
      fontStyle: "bold",
      fill: "#FFFFFF",
      align: "center",
      fontScale: 0.07,
    },
    {
      id: "b",
      type: "logo",
      x: 0.5,
      y: 0.7,
      rotation: 15,
      opacity: 0.9,
      fileName: "panther-logo.svg",
      mimeType: "image/svg+xml",
      naturalWidth: 512,
      naturalHeight: 512,
      scale: 0.4,
    },
  ],
  jsonUrl: "https://x.public.blob.vercel-storage.com/coozie/abc/design.json",
  fontUrls: ["https://x.public.blob.vercel-storage.com/coozie/abc/font-1-varsity.ttf"],
};

describe("describeDesign", () => {
  it("says when artwork is trimmed to its side, and only then", () => {
    const trimmed = { ...DOC, elements: [DOC.elements[0], { ...DOC.elements[1], clip: "front" }] };
    const rows = describeDesign(trimmed)!.elements[1].rows;
    expect(rows.find((r) => r.label === "Trimmed to")?.value).toBe("Front panel (nothing past its edge prints)");
    expect(describeDesign(DOC)!.elements[1].rows.some((r) => r.label === "Trimmed to")).toBe(false);
    const odd = { ...DOC, elements: [{ ...DOC.elements[1], clip: "constructor" }] };
    expect(describeDesign(odd)!.elements[0].rows.some((r) => r.label === "Trimmed to")).toBe(false);
  });

  it("returns null only when there is no design document", () => {
    expect(describeDesign(null)).toBeNull();
    expect(describeDesign(undefined)).toBeNull();
    // A catalog line stores no JSON; an array is not a design document either.
    expect(describeDesign([])).toBeNull();
  });

  it("carries colour, asset URLs and both element kinds", () => {
    const spec = describeDesign(DOC)!;
    expect(spec.color).toBe("#1C2E4A");
    expect(spec.pattern).toBeNull();
    expect(spec.jsonUrl).toContain("design.json");
    expect(spec.fontUrls).toHaveLength(1);
    expect(spec.elements.map((e) => e.kind)).toEqual(["text", "logo"]);
    expect(spec.elements.map((e) => e.title)).toEqual(["Text 1", "Logo 1"]);
  });

  it("carries the AI, EPS and PDF files behind stand-in boxes, once per file", () => {
    const url = "https://x.public.blob.vercel-storage.com/coozie/abc/artwork-1-acme.ai";
    const spec = describeDesign({
      elements: [],
      artworkFiles: [
        { elId: "l1", url, fileName: "Acme.ai" },
        { elId: "l2", url, fileName: "Acme.ai" },
        { elId: "l3", url: 7 },
      ],
    })!;
    expect(spec.artworkFiles).toEqual([{ url, fileName: "Acme.ai" }]);
    expect(describeDesign({ elements: [] })!.artworkFiles).toEqual([]);
  });

  it("keeps the exact text copy and resolves the font back to its label", () => {
    const rows = describeDesign(DOC)!.elements[0].rows;
    const get = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(get("Copy")).toBe("Quakertown Wrestling");
    expect(get("Font")).toBe("Impact");
    expect(get("Style")).toBe("bold");
    expect(get("Colour")).toBe("#FFFFFF");
  });

  it("flags an uploaded font stack rather than silently showing a preset name", () => {
    const spec = describeDesign({
      elements: [{ type: "text", text: "hi", fontFamily: "Varsity" }],
    })!;
    expect(spec.elements[0].rows.find((r) => r.label === "Font")?.value).toBe(
      "Varsity (custom upload)",
    );
  });

  it("converts stage fractions to native pixels so artwork can be placed", () => {
    const spec = describeDesign(DOC)!;
    const text = spec.elements[0].rows;
    // Stage is 1000×2000: x 0.5 -> 500px across, y 0.25 -> 500px down.
    expect(text.find((r) => r.label === "Centre X")?.value).toBe("0.500 (500px)");
    expect(text.find((r) => r.label === "Centre Y")?.value).toBe("0.250 (500px)");
    expect(text.find((r) => r.label === "Cap height")?.value).toBe(
      "0.070 of width (70px)",
    );

    const logo = spec.elements[1].rows;
    expect(logo.find((r) => r.label === "File")?.value).toBe("panther-logo.svg");
    expect(logo.find((r) => r.label === "Source size")?.value).toBe("512×512px");
    expect(logo.find((r) => r.label === "Placed width")?.value).toBe(
      "0.400 of width (400px)",
    );
    expect(logo.find((r) => r.label === "Rotation")?.value).toBe("15°");
  });

  it("survives a partial document instead of blanking the whole spec", () => {
    // A proof exists but the JSON is truncated — still show what we do have.
    const spec = describeDesign({ color: "#111111", elements: [{ type: "text" }] })!;
    expect(spec.color).toBe("#111111");
    const rows = spec.elements[0].rows;
    expect(rows.find((r) => r.label === "Copy")?.value).toBe("(empty)");
    expect(rows.find((r) => r.label === "Centre X")?.value).toBe("—");
  });

  it("ignores non-object entries in the elements array", () => {
    const spec = describeDesign({ elements: [null, "nope", { type: "text", text: "ok" }] })!;
    expect(spec.elements).toHaveLength(1);
    expect(spec.elements[0].rows[0].value).toBe("ok");
  });
});

describe("describeDesign / can size", () => {
  // Every design stored before slim cans existed — including DOC above, and
  // every order already shipped — has no `size`. It must resolve to standard
  // and keep reading against the 1000×2000 frame it was authored on, or the
  // pixel figures production works from silently move.
  it("defaults a size-less document to standard", () => {
    const spec = describeDesign(DOC)!;
    expect(spec.size).toEqual({ id: "standard", label: "Standard can" });
    expect(spec.elements[0].rows.find((r) => r.label === "Centre Y")?.value).toBe(
      "0.250 (500px)",
    );
  });

  it("reads a slim design against the slim frame", () => {
    const spec = describeDesign({ ...DOC, size: "slim" })!;
    expect(spec.size).toEqual({ id: "slim", label: "Slim can" });
    const rows = spec.elements[0].rows;
    // Slim stage is 875×2600: x 0.5 -> 438px, y 0.25 -> 650px.
    expect(rows.find((r) => r.label === "Centre X")?.value).toBe("0.500 (438px)");
    expect(rows.find((r) => r.label === "Centre Y")?.value).toBe("0.250 (650px)");
    expect(rows.find((r) => r.label === "Cap height")?.value).toBe(
      "0.070 of width (61px)",
    );
  });

  it("falls back to standard for a size we do not cut", () => {
    // Untrusted JSON reaches here, so anything that isn't a die we cut has to
    // land on standard rather than throw or invent a frame.
    for (const size of ["bottle", "", null, 7, undefined, {}]) {
      expect(describeDesign({ ...DOC, size })!.size.id).toBe("standard");
    }
  });
});

describe("specToTextLines", () => {
  it("emits the colour and every element for the order email", () => {
    const out = specToTextLines(describeDesign(DOC)!).join("\n");
    expect(out).toContain("Size: Standard can");
    expect(out).toContain("Can colour: #1C2E4A");
    expect(out).toContain("Text 1:");
    expect(out).toContain("Copy: Quakertown Wrestling");
    expect(out).toContain("Logo 1:");
    expect(out).toContain("File: panther-logo.svg");
  });

  it("names the slim die so the wrong blank does not get cut", () => {
    const out = specToTextLines(describeDesign({ ...DOC, size: "slim" })!).join("\n");
    expect(out).toContain("Size: Slim can");
  });
});
