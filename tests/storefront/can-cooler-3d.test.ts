// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/can-cooler-3d.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted or dropped:
// - The loader is src/viewer/load-3d.js, the component's logic src/viewer/can-cooler.js; its
//   source-text checks are made of those files, or of what their functions do on fakes.
//   "Imported by its loader alone" reads imports (src/viewer/index.js names the package in a
//   comment). The pin is package.json's peerDependencies. The decoder location is the host's
//   same-origin empty script now, so "switched on with no request at all" (MESHOPT_READY, a data:
//   URL) is adapted: loadViewer refuses a data: URL and sets the one it is given.
// - The models are models/can-cooler-<size>.glb and models/studio.hdr. "Named for their content"
//   is tests/models.test.js's (re-hashed against models/MANIFEST.json, whose source names carry
//   the hash); here the manifest's can cooler files are the three. next.config.ts is the host's.
// - "The component": painting order, the fill under the art and the kept art under a new colour
//   are paintCanCooler's on a recording canvas; the turn's reduced-motion gate is
//   turnCanCoolerOnce's; the view, the slots and touch-action are CAN_COOLER_VIEW,
//   MODEL_VIEWER_ATTRIBUTES and createModelViewer's; linearRgb is hat-look.js's (the same function).
//   Dropped as the React host's: once a session, revealed and turned only on screen, a lost WebGL
//   context, the webglAvailable-before-loadViewer and warm3D-alongside-loadViewer order, the
//   Tailwind class and other files' <CanCooler3D> uses.
// - Dropped as storefront-only: the designer package version pin, "the 3D is the view" and "what
//   a customer takes away" (CoozieStepForm, CoozieDeskWorkspace, CoozieDesigner, ShareStep), and
//   "the hex colour field" (ColorPicker).
/**
 * The can cooler in 3D (Brayden, 2026-10-10): the one 3D dependency stays
 * fenced to one component and out of the first load, the models the site
 * serves are the ones it can decode, the turn respects reduced motion, and the
 * phone's share page never renders inside the tap. Source scans, like
 * tests/coozie-share.test.ts: the component needs WebGL, which the node test
 * environment has none of.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { linearRgb } from "../../src/viewer/hat-look.js";
import { loadViewer } from "../../src/viewer/load-3d.js";
import {
  CAN_COOLER_IDEAL_ASPECT,
  CAN_COOLER_SHADOW_ROOM,
  CAN_COOLER_VIEW,
  MODEL_VIEWER_ATTRIBUTES,
  REDUCED_MOTION,
  createModelViewer,
  paintCanCooler,
  turnCanCoolerOnce,
} from "../../src/viewer/can-cooler.js";

const COMPONENT = "src/viewer/can-cooler.js";
const LOADER = "src/viewer/load-3d.js";
const read = (p: string) => readFileSync(p, "utf8");
/** models/: each file's sha256 and the storefront file it was copied from (public/3d/...). */
const MANIFEST = JSON.parse(read("models/MANIFEST.json")) as Record<string, { sha256: string; source: string }>;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(jsx?|tsx?|mjs)$/.test(name) ? [p] : [];
  });
}

/** Where the package keeps a 3D file. */
function shipped(name: string) {
  const file = Object.keys(MANIFEST).find((f) => f.replace(/\.(glb|hdr)$/, "") === name);
  expect(file, `${name} in models/MANIFEST.json`).toBeDefined();
  return `models/${file}`;
}

/** A .glb's JSON chunk. */
function gltfJson(path: string) {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
}

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
const viewer = () =>
  createModelViewer({ src: "/can.glb", environment: "/studio.hdr", alt: "", view: CAN_COOLER_VIEW, exposure: 2.15, document: fakeDocument() }) as unknown as {
    getAttribute(k: string): string | null; children: { tagName: string; getAttribute(k: string): string | null }[];
  };

/** A loaded <model-viewer> and its texture, on a canvas that records what is drawn. */
function paintable(width = 400, height = 200) {
  const ops: unknown[][] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (...args: unknown[]) => void ops.push([k, ...args]),
    set: (_t, k: string, v) => (ops.push([`${k}=`, v]), true),
  });
  const canvas = { width, height, getContext: () => g };
  const texture = { source: { element: canvas, update: vi.fn() } };
  const thread = { name: "thread", pbrMetallicRoughness: { setBaseColorFactor: vi.fn() } };
  const magnet = { name: "magnet", setAlphaMode: vi.fn(), pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 1], setBaseColorFactor: vi.fn() } };
  const mv = { model: { materials: [{ name: "print" }, thread, magnet] } };
  return { ops, mv, texture, thread, magnet };
}

describe("the 3D dependency", () => {
  it("is imported by its loader alone, and only by import()", () => {
    const imports = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']@google\/model-viewer["']/;
    const importers = sources("src").filter((f) => imports.test(read(f)));
    expect(importers.map((f) => relative(".", f))).toEqual([LOADER]);
    const src = read(LOADER);
    expect(src).toMatch(/import\("@google\/model-viewer"\)/);
    expect(src).not.toMatch(/^import[^\n]*@google\/model-viewer/m);
    // Statically imported by the home page's tile, so it may import nothing
    // (the die registry would come with it).
    expect(src).not.toMatch(/^import /m);
  });

  it("is pinned exactly, with the three.js it was built against", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.peerDependencies["@google/model-viewer"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.peerDependencies.three).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe("decodes the compressed models with its bundled decoder, switched on by the host's own empty script", () => {
    afterEach(() => {
      delete (globalThis as { ModelViewerElement?: unknown }).ModelViewerElement;
    });

    it("refuses a data: URL (a strict CSP blocks it) and any other origin", async () => {
      await expect(loadViewer({ meshoptDecoderLocation: "data:text/javascript," })).rejects.toThrow(TypeError);
      await expect(loadViewer({ meshoptDecoderLocation: "https://cdn.example/meshopt.js" })).rejects.toThrow(TypeError);
      await expect(loadViewer({} as never)).rejects.toThrow(TypeError);
      expect((globalThis as { ModelViewerElement?: unknown }).ModelViewerElement).toBeUndefined();
    });

    it("switches the decoder on at the location it is given before it loads the viewer", async () => {
      // model-viewer is a peer this package does not install, so its import fails here, and the
      // failure is forgotten: the location was set first.
      await expect(loadViewer({ meshoptDecoderLocation: "/meshopt-ready.js" })).rejects.toBeDefined();
      expect((globalThis as { ModelViewerElement?: { meshoptDecoderLocation?: string } }).ModelViewerElement?.meshoptDecoderLocation).toBe("/meshopt-ready.js");
    });

    it("names no URL", () => {
      for (const f of [LOADER, COMPONENT]) expect(read(f)).not.toMatch(/https?:\/\//);
    });
  });
});

describe("the models", () => {
  for (const size of ["standard", "slim"]) {
    const path = shipped(`can-cooler-${size}`);

    it(`${size}: exists and stays small enough for a phone`, () => {
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeLessThan(400 * 1024);
    });

    it(`${size}: needs only what the pinned model-viewer decodes without a CDN`, () => {
      const json = gltfJson(path);
      for (const ext of json.extensionsRequired ?? []) {
        expect(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"]).toContain(ext);
      }
    });

    it(`${size}: carries the materials the component paints`, () => {
      const names = gltfJson(path).materials.map((m: { name: string }) => m.name);
      for (const name of ["print", "print_seam", "thread", "magnet"]) expect(names).toContain(name);
    });

    it(`${size}: maps the print straight onto the die (no texture transform to lose when it is swapped)`, () => {
      const print = gltfJson(path).materials.find((m: { name: string }) => m.name === "print");
      expect(print.pbrMetallicRoughness.baseColorTexture.texCoord ?? 0).toBe(0);
      expect(print.pbrMetallicRoughness.baseColorTexture.extensions?.KHR_texture_transform).toBeUndefined();
    });
  }

  it("ships the studio the colours were checked under", () => {
    expect(existsSync(shipped("studio"))).toBe(true);
    expect(CAN_COOLER_VIEW["tone-mapping"]).toBe("linear");
    expect(viewer().getAttribute("tone-mapping")).toBe("linear");
  });

  it("are named for their content, so a browser may keep them for good", () => {
    // In the name, not a ?v= query: model-viewer reads an environment as HDR
    // only by a URL ending ".hdr", and loaded the studio as a (broken) image.
    // Each file is re-hashed against its manifest entry in tests/models.test.js.
    const files = Object.keys(MANIFEST).filter((f) => MANIFEST[f].source.startsWith("public/3d/can-coolers/"));
    expect(files.sort()).toEqual(["can-cooler-slim.glb", "can-cooler-standard.glb", "studio.hdr"]);
    expect(shipped("studio")).toMatch(/\.hdr$/);
  });
});

describe("the component", () => {
  const src = read(COMPONENT);

  it("paints the art upside down, as three.js uploads a canvas texture flipped", () => {
    const { ops, mv, texture } = paintable(400, 200);
    const art = { width: 400, height: 200 };
    expect(paintCanCooler(mv, texture, { color: "#1C2E4A", art: art as never })).toBe(true);
    const translate = ops.findIndex(([k]) => k === "translate");
    expect(ops.slice(translate, translate + 3)).toEqual([["translate", 0, 200], ["scale", 1, -1], ["drawImage", art, 0, 0, 400, 200]]);
    expect(texture.source.update).toHaveBeenCalledOnce();
  });

  it("fills the can cooler's colour under the art, so the die's empty outside can't bleed into the seams", () => {
    const { ops, mv, texture } = paintable(400, 200);
    paintCanCooler(mv, texture, { color: "#1C2E4A", art: { width: 400, height: 200 } as never });
    const fill = ops.findIndex(([k, ...a]) => k === "fillRect" && a.join() === "0,0,400,200");
    const draw = ops.findIndex(([k]) => k === "drawImage");
    expect(ops[fill - 1]).toEqual(["fillStyle=", "#1C2E4A"]);
    expect(fill).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(draw);
  });

  it("never turns under reduced motion (its own gate: CSS can't stop a timer); once a session is the host's", () => {
    expect(REDUCED_MOTION).toBe("(prefers-reduced-motion: reduce)");
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const mv = { jumpCameraToGoal: vi.fn() } as { jumpCameraToGoal: () => void; cameraOrbit?: string };
    try {
      turnCanCoolerOnce(mv, { reducedMotion: true })();
      expect(raf).not.toHaveBeenCalled();
      expect(mv.jumpCameraToGoal).not.toHaveBeenCalled();
      expect(mv.cameraOrbit).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(src).not.toMatch(/auto-rotate/);
    expect(Object.keys({ ...MODEL_VIEWER_ATTRIBUTES, ...CAN_COOLER_VIEW })).not.toContain("auto-rotate");
  });

  it("asks for WebGL 2, which three.js needs, before loading the viewer", () => {
    const loader = read(LOADER);
    expect(loader).toContain('getContext("webgl2")');
    expect(loader).not.toMatch(/getContext\("webgl"\)/);
    expect(loader).toMatch(/export function warm3D[\s\S]*?if \(!webglAvailable\(\)\) return false;/);
  });

  it("follows a colour drag frame by frame: the art is kept, and a new colour is only a new fill", () => {
    const { ops, mv, texture } = paintable(400, 200);
    const art = { width: 400, height: 200 };
    paintCanCooler(mv, texture, { color: "#1C2E4A", art: art as never });
    ops.length = 0;
    paintCanCooler(mv, texture, { color: "#A42A2E", art: art as never });
    expect(ops).toContainEqual(["fillStyle=", "#A42A2E"]);
    expect(ops.filter(([k]) => k === "drawImage")).toEqual([["drawImage", art, 0, 0, 400, 200]]);
  });

  it("reads a short hex as its six digits for the thread (#fff was an orange thread)", () => {
    expect(linearRgb("#fff")).toEqual(linearRgb("#ffffff"));
    expect(linearRgb("#1C2E4A")).toEqual(linearRgb("#1c2e4a"));
    const [r, g, b] = linearRgb("#ffffff");
    expect([r, g, b]).toEqual([1, 1, 1]);
    const { mv, texture, thread } = paintable();
    paintCanCooler(mv, texture, { color: "#fff", art: { width: 1, height: 1 } as never });
    expect(thread.pbrMetallicRoughness.setBaseColorFactor).toHaveBeenCalledWith([1, 1, 1, 1]);
  });

  it("never steals the page's scroll wheel or pinch", () => {
    expect(MODEL_VIEWER_ATTRIBUTES["disable-zoom"]).toBe("");
    expect(MODEL_VIEWER_ATTRIBUTES["disable-pan"]).toBe("");
    expect(viewer().getAttribute("disable-zoom")).toBe("");
    expect(viewer().getAttribute("disable-pan")).toBe("");
  });

  it("turns with every drag, up and down too, and leaves a touch screen's page scrollable beside the can", () => {
    // "pan-y" handed a mostly vertical drag to the page (Brayden, 2026-10-10).
    expect(viewer().getAttribute("touch-action")).toBe("none");
    expect(src).not.toContain("touchAction");
    expect(CAN_COOLER_IDEAL_ASPECT).toEqual({ standard: 0.585, slim: 0.42 });
    expect(CAN_COOLER_SHADOW_ROOM).toBe(1.15);
  });

  it("shows no loading bar: model-viewer's own stays a second after the model is in", () => {
    expect(viewer().children.map((c) => [c.tagName, c.getAttribute("slot")])).toContainEqual(["DIV", "progress-bar"]);
  });

  it("puts nothing over the drag surface outside its touch-action (model-viewer's centre pan dot)", () => {
    expect(viewer().children.map((c) => [c.tagName, c.getAttribute("slot")])).toContainEqual(["DIV", "pan-target"]);
  });
});
