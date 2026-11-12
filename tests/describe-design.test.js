// describeDesign: the production spec the storefront's /api/admin/orders
// emits as `designSpec`, ported from its coozie-spec.ts and hat/hat-spec.ts.
//
// tests/describe-design.golden.json is what the STOREFRONT's own
// describeDesign (Reel48-Storefront origin/main d78d90ee, run unchanged) made
// of each fixture in tests/fixtures/design-docs.json. The port must make the
// same thing, key for key. Each output must also be a StorefrontDesignSpec,
// data.reel48.com's type for the field (src/lib/storefront-admin.ts on its
// origin/main 693f7018), transcribed below as a runtime check.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  describeDesign,
  describeHatDesign,
  hatSpecToTextLines,
  isHatSpec,
  partColourText,
  specToTextLines,
} from "../src/core/index.js";

const docs = JSON.parse(readFileSync(new URL("./fixtures/design-docs.json", import.meta.url), "utf8"));
const goldens = JSON.parse(readFileSync(new URL("./describe-design.golden.json", import.meta.url), "utf8"));
// As the hub receives it: over JSON.
const wire = (v) => JSON.parse(JSON.stringify(v));

// ---- StorefrontDesignSpec, transcribed --------------------------------------
const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isBool = (v) => typeof v === "boolean";
const nullable = (check) => (v) => v === null || check(v);
const optional = (check) => (v) => v === undefined || check(v);
const arrayOf = (check) => (v) => Array.isArray(v) && v.every(check);
const shape = (fields, { extra = [] } = {}) => (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  // Known keys only, beyond the ones the storefront itself sends past the type.
  if (Object.keys(v).some((k) => !(k in fields) && !extra.includes(k))) return false;
  return Object.entries(fields).every(([k, check]) => check(v[k]));
};
const rect = shape({ x: isNum, y: isNum, w: isNum, h: isNum });
const row = shape({ label: isStr, value: isStr });
const element = shape({ kind: (v) => v === "text" || v === "logo", title: isStr, rows: arrayOf(row) });
const hatZone = shape({
  id: isStr,
  label: isStr,
  rect,
  maxImprint: shape({ w: isNum, h: isNum }),
  method: isStr,
  methodLabel: isStr,
  primary: isBool,
  threads: arrayOf(isStr),
  shape: optional(isStr),
  ground: optional(isStr),
  level: optional(isNum),
});
// `band` is the storefront's HatPartSpec field the hub's type does not name;
// the storefront sends it today, and TypeScript accepts it (not a literal).
const hatPart = shape({ id: isStr, label: isStr, color: isStr, pms: optional(isStr) }, { extra: ["band"] });
const isStorefrontDesignSpec = shape({
  size: nullable(shape({ id: isStr, label: isStr })),
  color: nullable(isStr),
  pattern: nullable(isStr),
  patternFile: optional(nullable(isStr)),
  patternRepeatIn: optional(nullable((v) => Array.isArray(v) && v.length === 2 && v.every(isNum))),
  elements: arrayOf(element),
  jsonUrl: nullable(isStr),
  fontUrls: arrayOf(isStr),
  artworkFiles: optional(arrayOf(shape({ url: isStr, fileName: isStr }))),
  kind: optional(isStr),
  dieId: optional(isStr),
  frame: optional(shape({ width: isNum, height: isNum, pxPerInch: isNum })),
  zones: optional(arrayOf(hatZone)),
  parts: optional(arrayOf(hatPart)),
  placements: optional(arrayOf(shape({ zone: isStr, method: isStr, primary: isBool }))),
  extraSpots: optional(isNum),
  pictureUrl: optional(nullable(isStr)),
});

describe("describeDesign matches the storefront's", () => {
  it("covers every fixture", () => {
    expect(Object.keys(goldens).sort()).toEqual(Object.keys(docs).sort());
  });
  for (const [name, doc] of Object.entries(docs)) {
    it(name, () => {
      expect(wire(describeDesign(doc))).toEqual(goldens[name]);
    });
  }
});

describe("every spec is a StorefrontDesignSpec", () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(name, () => {
      const spec = wire(describeDesign(doc));
      expect(spec).not.toBeNull();
      expect(isStorefrontDesignSpec(spec)).toBe(true);
    });
  }

  it("the check itself refuses a wrong shape", () => {
    expect(isStorefrontDesignSpec({ ...goldens["can-standard"], elements: 3 })).toBe(false);
    expect(isStorefrontDesignSpec({ ...goldens["can-standard"], surprise: 1 })).toBe(false);
  });

  it("a hat's size is never null, and says its kind", () => {
    for (const [name, spec] of Object.entries(goldens)) {
      if (docs[name].kind !== "hat") continue;
      expect(spec.kind).toBe("hat");
      expect(spec.size).not.toBeNull();
    }
  });
});

describe("the rest of the spec module", () => {
  it("is null only without a document", () => {
    expect(describeDesign(null)).toBeNull();
    expect(describeDesign("{}")).toBeNull();
    expect(describeDesign([])).toBeNull();
    expect(describeDesign({})).toMatchObject({ size: { id: "standard" } });
  });

  it("isHatSpec tells the two apart", () => {
    expect(isHatSpec(describeDesign(docs["no6-front-pvc"]))).toBe(true);
    expect(isHatSpec(describeDesign(docs["can-standard"]))).toBe(false);
    expect(isHatSpec(null)).toBe(false);
  });

  it("describes an unknown hat die out loud rather than as a can", () => {
    const spec = describeHatDesign({ dieId: "hat-no-9" });
    expect(spec.size).toEqual({ id: "hat-no-9", label: "Unknown hat die (hat-no-9)" });
    expect(spec.frame).toEqual({ width: 0, height: 0, pxPerInch: 0 });
  });

  it("writes the team email's lines", () => {
    const can = specToTextLines(describeDesign(docs["can-slim-pattern"]));
    expect(can[0]).toBe("    Size: Slim can");
    expect(can).toContain("    Pattern: Duck camo, Slate");
    const hat = hatSpecToTextLines(describeDesign(docs["no7-stamped-order"]));
    expect(hat[0]).toBe("    Hat: Hat No. 7 (die hat-no-7-v2)");
    expect(hat).toContain("    REEL48 strap tab: standard");
  });

  it("names a part's colour by its Pantone code, and the band by what it follows", () => {
    expect(partColourText({ id: "crown_FL", label: "Front left panel", color: "#1F2A44", pms: "PMS 533 C" })).toBe("PMS 533 C (#1F2A44)");
    expect(partColourText({ id: "sweatband", label: "Sweatband", color: "#1C1C1E", band: "black" }, "front panel")).toBe(
      "#1C1C1E (black, to suit the front panel)",
    );
  });
});
