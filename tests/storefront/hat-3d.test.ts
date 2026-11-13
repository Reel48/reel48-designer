// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-3d.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted or dropped:
// - hat-3d-assets.js names no URLs here (MODEL, POSTER, SURFACE, STUDIO, HAT_3D_FILES are gone on
//   purpose: the host serves the files). The files are models/hat-no-7.glb, hat-no-7-poster.webp,
//   hat-no-7-surface.json and the No. 6's; each style's fixed facts are HAT_3D_STYLES. "The one
//   Brayden signed off" pins models/MANIFEST.json's `source` (the storefront's content-hashed
//   name) where it pinned MODEL. "Named for its content" is tests/models.test.js's (each file
//   re-hashed against the manifest, whose source carries the hash); here the manifest's hat files
//   are each style's three. "Reuse the can cooler's studio" is the manifest's one HDR.
// - The build's files are byte copies: the dies tests/hat-no-7-v2.golden.json and
//   tests/hat-no-6.golden.json, and zones_no7.json (e1/), tag_no7.json, zones_no6.json, tag_no6.json
//   at their storefront paths under tests/storefront/fixtures/viewer/; the No. 6's
//   lab/extract_surface.mjs is fixtures/viewer/hat-no6-extract_surface.mjs.
// - "The code": the hat's files are src/viewer/hat-*.js, with hat-view.js in Hat3D.jsx's place;
//   the check that hat-3d-assets imports loadViewer from ../coozie/load-3d (the storefront's import
//   layout) is dropped. Hat3D.jsx's model-viewer settings are checked on HAT_VIEW and
//   createModelViewer (can-cooler.js, shared by both views). "Asks for the stage's art at the scale
//   its textures are drawn" (Hat3D.jsx and HatDesigner.jsx source) is dropped: the host's.
// - "Hat3D": the poster-before-3D render is a React component's, dropped. "Paints no die but the
//   model's own" is dieFitsModel(die, hat3DFilesOf(hatStyleOf(die.id), urls)), as Hat3D decided it;
//   labelShapeOf is hat-view.js's.
/**
 * The No. 7 hat in 3D (2026-10-21; Brayden at L3: "The production model is
 * perfect. Ship it to the site."; and on round E1's whole-panel model the same
 * day: "I tried round E1 on my iPhone and the whole-panel areas feel right."):
 * the site serves the model he signed off, small enough for a phone,
 * decodable without a CDN and carrying every material the runtime paints; its
 * files (the model, its poster and the editor's surface) are named for their
 * content; the hat reaches the 3D dependency only through the can cooler's
 * loader; and the runtime's own rules (part colours, the tag logo's contrast,
 * the camera placements) agree with the model build's files. Source scans and
 * pure functions, as tests/can-cooler-3d.test.ts: the component needs WebGL,
 * which the node test environment has none of (tests/hat-edit.test.ts drives
 * its editor with fakes).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HAT_NO_6_DIE, HAT_NO_7_DIE, HAT_PARTS } from "../../src/core/hat-config.js";
import { hatStyleOf } from "../../src/core/hat-style-config.js";
import { HAT_3D_STYLES, MODEL_FRAME, dieFitsModel, hat3DFilesOf } from "../../src/viewer/hat-3d-assets.js";
import { DEFAULT_COLOR, EXPOSURE, TAG_LOGO, resolvePartColors, tagLogoColor } from "../../src/viewer/hat-look.js";
import { HAT_VIEW, labelShapeOf } from "../../src/viewer/hat-view.js";
import { MODEL_VIEWER_ATTRIBUTES, createModelViewer } from "../../src/viewer/can-cooler.js";
import PLACEMENTS from "../../src/viewer/hat-no7-placements.js";
import PLACEMENTS_6 from "../../src/viewer/hat-no6-placements.js";
import { extractSurface as extractSurface6, formatSurface as formatSurface6 } from "./fixtures/viewer/hat-no6-extract_surface.mjs";

const HAT_DIR = "src/viewer";
const BUILD = "tests/storefront/fixtures/viewer/scripts/blender/hat-no7";
const read = (p: string) => readFileSync(p, "utf8");
/** models/: each file's sha256 and the storefront file it was copied from (public/3d/...). */
const MANIFEST = JSON.parse(read("models/MANIFEST.json")) as Record<string, { sha256: string; source: string }>;
// The die the served model's print UVs are on: round E1's, which the designer
// package ships as "hat-no-7-v2" (v1.12.0) and hat-config.js names as
// HAT_NO_7_DIE; this file reads it from the build too (its byte copy).
const E1_DIE = JSON.parse(read("tests/hat-no-7-v2.golden.json")) as { id: string; stage: { width: number; height: number }; zones: { id: string }[] };
// The hat's files: hat-view.js is Hat3D.jsx's part that is not React.
const hatSources = readdirSync(HAT_DIR)
  .filter((f) => /^hat-.*\.(jsx?|tsx?)$/.test(f))
  .map((f) => join(HAT_DIR, f));

/** A minimal document for createModelViewer: elements with attributes, a style, children. */
function fakeDocument() {
  type El = { tagName: string; attrs: Record<string, string>; style: Record<string, string>; children: El[]; className: string;
    setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; appendChild(c: El): El; [k: string]: unknown };
  const createElement = (tag: string): El => ({
    tagName: tag.toUpperCase(),
    attrs: {},
    style: {},
    children: [],
    className: "",
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElement } as unknown as Document;
}

/** A .glb's JSON chunk. */
function gltfJson(path: string) {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
}

type TextureInfo = { texCoord?: number; extensions?: Record<string, unknown> };
type Material = {
  name: string;
  pbrMetallicRoughness?: { baseColorTexture?: TextureInfo };
  normalTexture?: TextureInfo;
  extensions?: Record<string, Record<string, unknown>>;
};

// The contract the model and the runtime share (scripts/blender/hat-no7).
// Round E1 has one inside label, the rectangle: the square's card is gone.
const CONTRACT = [
  "part_crown_FL", "part_crown_FR", "part_crown_LS", "part_crown_RS", "part_crown_LB", "part_crown_RB",
  "part_bill_top", "part_bill_under", "part_button", "part_eyelet", "part_binding", "part_sweatband",
  "part_strap", "part_tape",
  "fixed_tag_logo",
  "print_front", "print_left", "print_right", "print_back", "print_label_tall",
];

describe("the model", () => {
  const path = "models/hat-no-7.glb";
  const json = gltfJson(path);
  const materials: Material[] = json.materials;

  // L3 2026-10-21 signed off 2a066e0b; the same day Brayden asked for the strap tag's REEL48
  // logo at ~90% of the tag's length, centred (only the tag-logo decal changed): ab4afb7d.
  // Round E1 (whole-panel areas, its UVs on the E1 die's frame) is dd00635f, signed off that
  // evening: "I tried round E1 on my iPhone and the whole-panel areas feel right. The back
  // position and keeping today's largest logo sizes are fine. Go ahead with the designer
  // package and the site."
  it("is the one Brayden signed off, round E1 (a rebuild needs his say-so, then this line)", () => {
    expect(MANIFEST["hat-no-7.glb"].source).toBe("public/3d/hats/hat-no7.dd00635f.glb");
  });

  it("names the die frame its print UVs are on: round E1's, the frame its surface was extracted on", () => {
    // Hat3D paints only a die on this frame. tests/hat-surface.test.ts pins the
    // surface to this model (extract_surface.mjs on it, --die e1/die_no7.json).
    const surface = JSON.parse(read("models/hat-no-7-surface.json")) as { model: string; frame: object };
    expect({ ...MODEL_FRAME }).toEqual(E1_DIE.stage);
    expect(surface.frame).toEqual({ ...MODEL_FRAME });
    expect(surface.model).toBe(MANIFEST["hat-no-7.glb"].source.split("/").pop());
  });

  it("stays under the 900 KB cap", () => {
    expect(statSync(path).size).toBeLessThan(900 * 1024);
  });

  it("needs only what the pinned model-viewer decodes without a CDN", () => {
    for (const ext of json.extensionsRequired ?? []) {
      expect(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"]).toContain(ext);
    }
  });

  it("carries every material the runtime paints, one for every part a design colours", () => {
    const names = materials.map((m) => m.name);
    for (const name of CONTRACT) expect(names).toContain(name);
    for (const p of HAT_PARTS) expect(names).toContain(`part_${p.id}`);
  });

  it("maps every print area and the tag logo straight onto texCoord 0, with no transform to lose when a texture is swapped", () => {
    for (const m of materials.filter((x) => x.name.startsWith("print_") || x.name === "fixed_tag_logo")) {
      const slots = [
        m.pbrMetallicRoughness?.baseColorTexture,
        m.normalTexture,
        ...Object.values(m.extensions ?? {}).flatMap((e) => Object.values(e).filter((v): v is TextureInfo => typeof v === "object" && v !== null && "index" in v)),
      ].filter(Boolean) as TextureInfo[];
      expect(slots.length, m.name).toBeGreaterThan(0);
      for (const t of slots) {
        expect(t.texCoord ?? 0, m.name).toBe(0);
        expect(t.extensions?.KHR_texture_transform, m.name).toBeUndefined();
      }
    }
  });
});

describe("the files", () => {
  // Every style's model, poster and surface (the No. 7's and, since S3, the No. 6's).
  const SERVED: string[] = Object.keys(HAT_3D_STYLES).flatMap((h) => [`hat-${h}.glb`, `hat-${h}-poster.webp`, `hat-${h}-surface.json`]);
  const hats = Object.keys(MANIFEST).filter((n) => MANIFEST[n].source.startsWith("public/3d/hats/"));

  it("are each style's model, its poster and its surface, each named for its content, so a browser may keep them for good", () => {
    expect(["hat-no-7.glb", "hat-no-7-poster.webp", "hat-no-7-surface.json"].every((u) => SERVED.includes(u))).toBe(true);
    // Each is re-hashed against the manifest, whose source names carry the hash, in tests/models.test.js.
    for (const name of SERVED) expect(MANIFEST[name], name).toBeDefined();
  });

  it("are all the storefront's public/3d/hats held: nothing unused ships", () => {
    expect([...hats].sort()).toEqual([...SERVED].sort());
  });

  it("include a small WebP poster for each style, and reuse the can cooler's studio rather than a copy", () => {
    for (const h of Object.keys(HAT_3D_STYLES)) {
      const name = `models/hat-${h}-poster.webp`;
      const poster = readFileSync(name);
      expect(poster.subarray(0, 4).toString("latin1"), name).toBe("RIFF");
      expect(poster.subarray(8, 12).toString("latin1"), name).toBe("WEBP");
      expect(poster.length, name).toBeLessThan(100 * 1024);
    }
    const studios = Object.keys(MANIFEST).filter((n) => n.endsWith(".hdr"));
    expect(studios).toEqual(["studio.hdr"]);
    expect(MANIFEST["studio.hdr"].source).toMatch(/^public\/3d\/can-coolers\//);
  });
});

// ---- The No. 6 (S3, 2026-10-24) -------------------------------------------------------
// Brayden signed its model off on 2026-10-24 ("Perfect. Dark-back the eyelets, then run the
// rebuild of record."); 01e8fb22 was that rebuild of record. The same day he asked for its
// part-colour lines to be cleaned up ("Check this area under the bill and let's clean it up a
// little bit... make sure all of the lines are clearly defined and clean."): 482b4e5f, the
// shape unchanged (within 0.04 mm). Its contract (scripts/blender/hat-no6,
// lib/glb.py) has one front panel, a plastic snapback with a woven tag, the eyelets' dark
// backing, and no strap, front tape or square label.
const BUILD_6 = "tests/storefront/fixtures/viewer/scripts/blender/hat-no6";
const NO_6 = hatStyleOf("no-6");
const FILES_6 = HAT_3D_STYLES["no-6"];
const CONTRACT_6 = [
  "part_crown_F", "part_crown_LS", "part_crown_RS", "part_crown_LB", "part_crown_RB",
  "part_bill_top", "part_bill_under", "part_button", "part_eyelet", "part_binding", "part_sweatband",
  "part_tape", "part_snap", "part_snap_tag",
  "fixed_eyelet_back", "fixed_tag_logo",
  "print_front", "print_left", "print_right", "print_back", "print_label_tall",
];

describe("the No. 6's model", () => {
  const path = "models/hat-no-6.glb";
  const json = gltfJson(path);
  const materials: Material[] = json.materials;
  const DIE_6 = JSON.parse(read("tests/hat-no-6.golden.json")) as { stage: { width: number; height: number }; zones: { id: string }[] };

  it("is the rebuild Brayden asked for, its lines cleaned up (a rebuild needs his say-so, then this line)", () => {
    expect(MANIFEST["hat-no-6.glb"].source).toBe("public/3d/hats/hat-no6.482b4e5f.glb");
  });

  it("carries its contract exactly: a material for every part a No. 6 design colours, and none of the No. 7's", () => {
    expect(materials.map((m) => m.name).sort()).toEqual([...CONTRACT_6].sort());
    for (const p of NO_6.parts) expect(materials.map((m) => m.name)).toContain(`part_${p.id}`);
  });

  it("stays under the 900 KB cap and needs only what the pinned model-viewer decodes without a CDN", () => {
    expect(statSync(path).size).toBeLessThan(900 * 1024);
    for (const ext of json.extensionsRequired ?? []) {
      expect(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"]).toContain(ext);
    }
  });

  it("maps every print area and the tag logo straight onto texCoord 0, with no transform to lose", () => {
    for (const m of materials.filter((x) => x.name.startsWith("print_") || x.name === "fixed_tag_logo")) {
      const slots = [
        m.pbrMetallicRoughness?.baseColorTexture,
        m.normalTexture,
        ...Object.values(m.extensions ?? {}).flatMap((e) => Object.values(e).filter((v): v is TextureInfo => typeof v === "object" && v !== null && "index" in v)),
      ].filter(Boolean) as TextureInfo[];
      expect(slots.length, m.name).toBeGreaterThan(0);
      for (const t of slots) {
        expect(t.texCoord ?? 0, m.name).toBe(0);
        expect(t.extensions?.KHR_texture_transform, m.name).toBeUndefined();
      }
    }
  });

  it("is on its own die's frame, the frame its surface was extracted on", () => {
    const surface = JSON.parse(read("models/hat-no-6-surface.json")) as { frame: object };
    expect({ ...FILES_6.frame }).toEqual(DIE_6.stage);
    expect({ ...FILES_6.frame }).toEqual(HAT_NO_6_DIE.stage);
    expect(surface.frame).toEqual({ ...FILES_6.frame });
  });

  it("has the surface extract_surface.mjs writes from the model the site serves (a rebuilt model needs a rerun)", async () => {
    // node scripts/blender/hat-no6/lab/extract_surface.mjs --glb public<model> (the surface keeps the lab's model name)
    const file = read("models/hat-no-6-surface.json");
    const surface = JSON.parse(file) as { model: string };
    const { json: extracted } = await extractSurface6(readFileSync(path), { model: surface.model, frame: DIE_6.stage });
    expect(formatSurface6(extracted)).toBe(file);
  });

  it("aims its camera by the zones it was built with, for every spot on its die", () => {
    const built = JSON.parse(read(`${BUILD_6}/zones_no6.json`)).zones as { id: string; centre: number[]; normal: number[]; sizeMm: object }[];
    const pick = ({ id, centre, normal, sizeMm }: (typeof built)[number]) => ({ id, centre, normal, sizeMm });
    expect(PLACEMENTS_6.zones.map(pick)).toEqual(built.map(pick));
    expect(PLACEMENTS_6.zones.map((z) => z.id)).toEqual(DIE_6.zones.map((z) => z.id));
  });

  it("puts its REEL48 logo on the snapback tag by the build's contrast rule", () => {
    const logo = JSON.parse(read(`${BUILD_6}/tag_no6.json`)).logo;
    expect(NO_6.tagLogo.follows).toBe("snap_tag");
    expect(TAG_LOGO.contrast).toEqual({ lightThreshold: logo.contrast.light_threshold, onDark: logo.contrast.on_dark, onLight: logo.contrast.on_light });
    for (const [name, p] of Object.entries(logo.contrast_presets as Record<string, { hex: string; logo: string }>)) {
      expect(tagLogoColor(p.hex), name).toBe(p.logo);
    }
  });
});

describe("the code", () => {
  it("reaches the 3D dependency only through the can cooler's loader, and names no URL", () => {
    for (const f of hatSources) {
      // The SVG namespace (hat-place.js's overlay) is a name, not an address.
      const src = read(f).replaceAll("http://www.w3.org/2000/svg", "");
      expect(src, f).not.toMatch(/@google\/model-viewer/);
      expect(src, f).not.toMatch(/https?:\/\//);
    }
    // The 3D's own files load nothing themselves (hat-view.js in Hat3D.jsx's place).
    for (const f of ["hat-view.js", "hat-3d-assets.js", "hat-look.js", "hat-edit.js"]) {
      expect(read(join(HAT_DIR, f)), f).not.toMatch(/\bimport\(\s*["'`]/);
    }
  });

  it("keeps model-viewer's settings the colours were checked under, and never turns by itself", () => {
    expect(EXPOSURE).toBe(2.15);
    const mv = createModelViewer({ src: "/hat.glb", environment: "/studio.hdr", alt: "", view: HAT_VIEW, exposure: EXPOSURE, document: fakeDocument() }) as unknown as {
      exposure: unknown; getAttribute(k: string): string | null; children: { tagName: string; getAttribute(k: string): string | null }[];
    };
    expect(mv.exposure).toBe(EXPOSURE);
    expect(HAT_VIEW["tone-mapping"]).toBe("linear");
    expect(mv.getAttribute("tone-mapping")).toBe("linear");
    expect(mv.children.map((c) => [c.tagName, c.getAttribute("slot")])).toEqual([["DIV", "progress-bar"], ["DIV", "pan-target"]]);
    expect(MODEL_VIEWER_ATTRIBUTES["touch-action"]).toBe("none");
    expect(mv.getAttribute("touch-action")).toBe("none");
    for (const f of [...hatSources, "src/viewer/can-cooler.js"]) expect(read(f), f).not.toMatch(/auto-?rotate/i);
    expect(Object.keys({ ...MODEL_VIEWER_ATTRIBUTES, ...HAT_VIEW }).filter((k) => /auto-?rotate/i.test(k))).toEqual([]);
  });
});

describe("part colours", () => {
  const ids = HAT_PARTS.map((p) => p.id);

  it("give each part its own colour, and a part with none the default", () => {
    const c = resolvePartColors({ crown_FL: "#FFFFFF", bill_top: "#a42a2e" }, ids);
    expect(c.crown_FL).toBe("#FFFFFF");
    expect(c.bill_top).toBe("#a42a2e");
    expect(c.crown_FR).toBe(DEFAULT_COLOR);
    expect(resolvePartColors({ strap: "silver" }, ["strap"]).strap).toBe(DEFAULT_COLOR);
  });

  it("keep the inside tapes on the back panels' colour, and the binding until it has its own", () => {
    const back = resolvePartColors({ crown_LB: "#25473A", tape: "#FF0000" }, ids);
    expect(back.tape).toBe("#25473A");
    expect(back.binding).toBe("#25473A");
    expect(resolvePartColors({ crown_LB: "#25473A", binding: "#F1F0EB" }, ids).binding).toBe("#F1F0EB");
  });
});

describe("the REEL48 logo on the strap tag", () => {
  const logo = JSON.parse(read(`${BUILD}/tag_no7.json`)).logo;

  it("follows the model build's contrast rule", () => {
    expect(TAG_LOGO.follows).toBe("strap");
    expect(TAG_LOGO.contrast).toEqual({
      lightThreshold: logo.contrast.light_threshold,
      onDark: logo.contrast.on_dark,
      onLight: logo.contrast.on_light,
    });
  });

  it("is white on a dark strap and dark on a light one", () => {
    for (const [name, p] of Object.entries(logo.contrast_presets as Record<string, { hex: string; logo: string }>)) {
      expect(tagLogoColor(p.hex), name).toBe(p.logo);
    }
  });
});

describe("the camera placements", () => {
  it("are the zones the served model (round E1) was built with, for every spot on its die", () => {
    const built = JSON.parse(read(`${BUILD}/e1/zones_no7.json`)).zones as { id: string; centre: number[]; normal: number[]; sizeMm: object }[];
    const pick = ({ id, centre, normal, sizeMm }: (typeof built)[number]) => ({ id, centre, normal, sizeMm });
    expect(PLACEMENTS.zones).toEqual(built.map(pick));
    expect(PLACEMENTS.zones.map((z) => z.id)).toEqual(E1_DIE.zones.map((z) => z.id));
  });
});

describe("Hat3D", () => {
  // The host's URLs: any will do, dieFitsModel reads the style's frame.
  const URLS = { model: "/models/hat.glb" };
  const fits = (die: { id?: string; stage?: object } | undefined) => dieFitsModel(die as never, hat3DFilesOf(hatStyleOf(die?.id), URLS));

  it("paints no die but the model's own: another frame is a failed 3D, the flat die's to show", () => {
    // The die before round E1 (1560 x 1296), or any other frame: art in the wrong places, so none.
    const other = { ...E1_DIE, stage: { width: 1560, height: 1296 } };
    expect(fits(other)).toBe(false);
    expect(fits(E1_DIE)).toBe(true);
    // A host that passes no die gets hat-config's, the current one: round E1's.
    expect(HAT_NO_7_DIE.stage).toEqual({ width: MODEL_FRAME.width, height: MODEL_FRAME.height });
    expect(fits(HAT_NO_7_DIE as never)).toBe(true);
  });

  it("reads the inside label's shape from the spot the design chose", () => {
    expect(labelShapeOf({ label_square: { ground: "#FFFFFF" } })).toBe("square");
    expect(labelShapeOf({ front: { method: "embroidery" }, label_tall: {} })).toBe("tall");
    expect(labelShapeOf({ front: { method: "embroidery" } })).toBe("none");
    expect(labelShapeOf(undefined)).toBe("none");
  });
});
