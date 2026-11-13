// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-look-zones.test.ts (origin/main d78d90ee); imports point into this package.
// Adapted: the shipped model is models/hat-no-7.glb (hat-3d-assets.js names no MODEL URL here).
// "still exports everything Hat3D and tests/hat-3d.test.ts import" reads the package's own
// consumers instead of the storefront's Hat3D.jsx: hat-view.js and can-cooler.js (where Hat3D's
// and CanCooler3D's logic now lives), with createHatLook named outright (hat-view.js's host
// sequence calls it; Hat3D imported it), and this folder's hat-3d.test.ts.
/**
 * The No. 7 hat's look paints each print spot on its own small canvas pair
 * (hat-look.js zoneFrame), reached by a sampler transform, so a change, or a
 * drag on the hat, uploads one spot's texture and not the whole die's. These
 * are the pure parts: the transform takes every die pixel to its own texel
 * (through three.js's flipY upload), the canvases cover each overlay mesh the
 * shipped model has (its ~5 mm bleed included), the bleed stops at the frame's
 * edge, and the API Hat3D and tests/hat-3d.test.ts use is all still there. The
 * painting runs on a stub canvas and model-viewer (node has no canvas): which
 * pairs upload when, the transform a live frame draws under, and the hold a
 * drag's last frame keeps until its result is handed over. All of it again at
 * a phone's textureScale (0.6): smaller canvases, the same die pixel to texel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HAT_NO_7_DIE, HAT_NO_7_V1_DIE } from "../../src/core/hat-config.js";
import * as look from "../../src/viewer/hat-look.js";

const { BLEED_MM, HOLD_MAX_MS, RELIEF_SCALE, ZONE_MATERIAL, createHatLook, pieceMatrix, zoneFrame } = look;
const W = HAT_NO_7_DIE.stage.width;
const H = HAT_NO_7_DIE.stage.height;
const BLEED_PX = (BLEED_MM * HAT_NO_7_DIE.pxPerInch) / 25.4;
// The first No. 7 die (1560 x 1296), whose numbers the by-hand checks below
// were worked out on: the frame arithmetic is the same on any die.
const V1 = HAT_NO_7_V1_DIE;
const W1 = V1.stage.width;
const H1 = V1.stage.height;

type Rect = { x: number; y: number; w: number; h: number };
type Frame = ReturnType<typeof zoneFrame>;
type Canvas = { scale: { u: number; v: number }; offset: { u: number; v: number }; draw: number[] };

/**
 * Where three.js reads a frame point (x, y die px, or relief px for the relief
 * canvas) on a canvas: the glTF UV (x / W, y / H), the sampler's
 * uv' = offset + scale * uv, then the canvas uploaded with flipY, so t = 0 is
 * the canvas's bottom row.
 */
function sampled(c: Canvas, size: { w: number; h: number }, frame: { w: number; h: number }, x: number, y: number) {
  const s = (x / frame.w) * c.scale.u + c.offset.u;
  const t = (y / frame.h) * c.scale.v + c.offset.v;
  return { s, t, px: s * size.w, py: (1 - t) * size.h };
}

/** Where the module draws that point: its canvas transform. */
function drawn(c: Canvas, x: number, y: number) {
  const [a, b, cc, d, e, f] = c.draw;
  return { px: a * x + cc * y + e, py: b * x + d * y + f };
}

/** The rect's corners and centre, and the bleed's outer corners. */
function probes(r: Rect, f: Frame) {
  return [
    [r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h], [r.x + r.w / 2, r.y + r.h / 2],
    [f.x0, f.y0], [f.x0 + f.w, f.y0 + f.h], [r.x + 0.5, r.y + r.h - 0.5],
  ];
}

describe("each zone's own canvases", () => {
  for (const zone of HAT_NO_7_DIE.zones) {
    const f = zoneFrame(zone.rect, HAT_NO_7_DIE);
    const r = zone.rect;

    it(`${zone.id}: cover its rect and ${BLEED_MM} mm round it, clamped to the frame`, () => {
      expect(f.x0).toBe(Math.max(0, Math.floor(r.x - BLEED_PX)));
      expect(f.y0).toBe(Math.max(0, Math.floor(r.y - BLEED_PX)));
      expect(f.x0 + f.w).toBe(Math.min(W, Math.ceil(r.x + r.w + BLEED_PX)));
      expect(f.y0 + f.h).toBe(Math.min(H, Math.ceil(r.y + r.h + BLEED_PX)));
      // the relief canvas covers the art canvas's die px
      expect(f.rx0).toBeLessThanOrEqual(f.x0 * RELIEF_SCALE);
      expect(f.ry0).toBeLessThanOrEqual(f.y0 * RELIEF_SCALE);
      expect(f.rx0 + f.rw).toBeGreaterThanOrEqual((f.x0 + f.w) * RELIEF_SCALE);
      expect(f.ry0 + f.rh).toBeGreaterThanOrEqual((f.y0 + f.h) * RELIEF_SCALE);
    });

    it(`${zone.id}: a die pixel reaches its own texel, through the sampler and the flipY upload`, () => {
      for (const [x, y] of probes(r, f)) {
        const art = sampled(f.art, f, { w: W, h: H }, x, y);
        const want = drawn(f.art, x, y);
        expect(art.px, `${zone.id} art x at ${x},${y}`).toBeCloseTo(want.px, 9);
        expect(art.py, `${zone.id} art y at ${x},${y}`).toBeCloseTo(want.py, 9);
        expect(art.s).toBeGreaterThanOrEqual(-1e-12);
        expect(art.s).toBeLessThanOrEqual(1 + 1e-12);
        expect(art.t).toBeGreaterThanOrEqual(-1e-12);
        expect(art.t).toBeLessThanOrEqual(1 + 1e-12);
        const X = x * RELIEF_SCALE;
        const Y = y * RELIEF_SCALE;
        const rel = sampled(f.relief, { w: f.rw, h: f.rh }, { w: W * RELIEF_SCALE, h: H * RELIEF_SCALE }, X, Y);
        const rwant = drawn(f.relief, X, Y);
        expect(rel.px, `${zone.id} relief x at ${x},${y}`).toBeCloseTo(rwant.px, 9);
        expect(rel.py, `${zone.id} relief y at ${x},${y}`).toBeCloseTo(rwant.py, 9);
      }
    });
  }

  it("front, by hand: the rect's top left (40, 40) is texel (40, 490) of a 980 x 530 canvas, near its bottom", () => {
    const f = zoneFrame(V1.zones.find((z) => z.id === "front")!.rect, V1);
    expect([f.x0, f.y0, f.w, f.h]).toEqual([0, 0, 980, 530]);
    expect(f.art.scale).toEqual({ u: 1560 / 980, v: 1296 / 530 });
    expect(f.art.offset.u).toBeCloseTo(0, 12);
    expect(f.art.offset.v).toBeCloseTo(0, 12);
    const p = sampled(f.art, f, { w: W1, h: H1 }, 40, 40);
    expect(p.px).toBeCloseTo(40, 9);
    expect(p.py).toBeCloseTo(490, 9);
  });

  it("left, by hand: the sampler shifts the frame onto the sub-canvas", () => {
    const f = zoneFrame(V1.zones.find((z) => z.id === "left")!.rect, V1);
    expect([f.x0, f.y0, f.w, f.h]).toEqual([980, 0, 480, 380]);
    expect(f.art.offset.u).toBeCloseTo(-980 / 480, 12);
    expect(f.art.draw).toEqual([1, 0, 0, -1, -980, 380]);
    expect([f.rx0, f.ry0, f.rw, f.rh]).toEqual([490, 0, 240, 190]);
  });
});

describe("the bleed at the frame's edge", () => {
  it("stops at the frame, and the transform still lands every pixel", () => {
    const corner = zoneFrame({ x: 10, y: 5, w: 100, h: 50 }, V1);
    expect([corner.x0, corner.y0]).toEqual([0, 0]);
    expect(corner.x0 + corner.w).toBe(Math.ceil(110 + BLEED_PX));
    const far = zoneFrame({ x: 1500, y: 1270, w: 60, h: 26 }, V1);
    expect(far.x0 + far.w).toBe(W1);
    expect(far.y0 + far.h).toBe(H1);
    expect(far.rx0 + far.rw).toBe(W1 * RELIEF_SCALE);
    for (const f of [corner, far]) {
      for (const [x, y] of probes(f.rect, f)) {
        const p = sampled(f.art, f, { w: W1, h: H1 }, x, y);
        const want = drawn(f.art, x, y);
        expect(p.px).toBeCloseTo(want.px, 9);
        expect(p.py).toBeCloseTo(want.py, 9);
      }
    }
    // the far corner of the frame is the sub-canvas's far texel edge (s = 1), on its top row (t = 1)
    const edge = sampled(far.art, far, { w: W1, h: H1 }, W1, H1);
    expect(edge.s).toBeCloseTo(1, 12);
    expect(edge.t).toBeCloseTo(1, 12);
    expect(edge.py).toBeCloseTo(0, 9);
  });

  it("the back zone's bleed reaches the frame's right edge exactly (the first die's back, by the edge)", () => {
    const f = zoneFrame(V1.zones.find((z) => z.id === "back")!.rect, V1);
    expect(f.x0 + f.w).toBe(W1);
  });

  it("keeps the relief canvas inside an odd frame's relief size", () => {
    const die = { stage: { width: 1001, height: 777 }, pxPerInch: 200 };
    const f = zoneFrame({ x: 960, y: 740, w: 41, h: 37 }, die);
    expect(f.x0 + f.w).toBe(1001);
    expect(f.rx0 + f.rw).toBe(Math.ceil(1001 * RELIEF_SCALE));
    expect(f.ry0 + f.rh).toBe(Math.ceil(777 * RELIEF_SCALE));
  });
});

// ---- The shipped model's print meshes -------------------------------------------------
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number };
type BufferView = {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: { byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } };
};
type Decoder = {
  ready: Promise<void>;
  decodeGltfBuffer: (target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string) => void;
};

/** Each print material's TEXCOORD_0 extent, in die px. */
async function printUvExtents() {
  // a path in a variable: three ships no types for its example decoders
  const decoderPath = pathToFileURL(resolve("node_modules/three/examples/jsm/libs/meshopt_decoder.module.js")).href;
  const { MeshoptDecoder } = (await import(/* @vite-ignore */ decoderPath)) as { MeshoptDecoder: Decoder };
  await MeshoptDecoder.ready;
  const glb = readFileSync("models/hat-no-7.glb");
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const bin = glb.subarray(20 + jsonLength + 8);
  const view = (i: number) => {
    const bv: BufferView = json.bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) return { data: Buffer.from(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)), stride: bv.byteStride };
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
    return { data: Buffer.from(out.buffer), stride: ext.byteStride };
  };
  const read: Record<number, [number, (b: Buffer, o: number) => number]> = {
    5126: [8, (b, o) => b.readFloatLE(o)],
    5123: [4, (b, o) => b.readUInt16LE(o) / 65535],
    5121: [2, (b, o) => b.readUInt8(o) / 255],
  };
  const names: string[] = json.materials.map((m: { name: string }) => m.name);
  const out = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const mesh of json.meshes) {
    for (const p of mesh.primitives) {
      const name = names[p.material];
      if (!name?.startsWith("print_")) continue;
      const a: Accessor = json.accessors[p.attributes.TEXCOORD_0];
      const [size, get] = read[a.componentType];
      const { data, stride } = view(a.bufferView);
      const e = out.get(name) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (let i = 0; i < a.count; i++) {
        const o = (a.byteOffset ?? 0) + i * (stride || size);
        const x = get(data, o) * W;
        const y = get(data, o + size / 2) * H;
        e.x0 = Math.min(e.x0, x);
        e.x1 = Math.max(e.x1, x);
        e.y0 = Math.min(e.y0, y);
        e.y1 = Math.max(e.y1, y);
      }
      out.set(name, e);
    }
  }
  return out;
}

describe("the shipped model", () => {
  it("has every print mesh inside its zone's canvases, so no part of one samples the clamped edge", async () => {
    const extents = await printUvExtents();
    for (const zone of HAT_NO_7_DIE.zones) {
      const name = ZONE_MATERIAL[zone.id as keyof typeof ZONE_MATERIAL];
      const e = extents.get(name);
      expect(e, name).toBeDefined();
      const f = zoneFrame(zone.rect, HAT_NO_7_DIE);
      expect(e!.x0, name).toBeGreaterThanOrEqual(f.x0);
      expect(e!.y0, name).toBeGreaterThanOrEqual(f.y0);
      expect(e!.x1, name).toBeLessThanOrEqual(f.x0 + f.w);
      expect(e!.y1, name).toBeLessThanOrEqual(f.y0 + f.h);
    }
    // the overlays do run past their rects: that is what the bleed is for
    const front = extents.get("print_front")!;
    expect(front.x1).toBeGreaterThan(940 + 30);
  });
});

describe("pieceMatrix", () => {
  it("puts the sprite's centre on the point and turns it clockwise on the die", () => {
    const sprite = { w: 100, h: 50 };
    const m = pieceMatrix(sprite, { x: 300, y: 200, angle: Math.PI / 2 });
    const at = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    expect(at(50, 25)[0]).toBeCloseTo(300, 9);
    expect(at(50, 25)[1]).toBeCloseTo(200, 9);
    // the sprite's right edge (+x) turns to point down the die (+y)
    expect(at(100, 25)[0]).toBeCloseTo(300, 9);
    expect(at(100, 25)[1]).toBeCloseTo(250, 9);
    const out = [0, 0, 0, 0, 0, 0];
    expect(pieceMatrix(sprite, { x: 1, y: 2 }, out)).toBe(out);
    expect(out.map((v) => v + 0)).toEqual([1, 0, 0, 1, -49, -23]);
  });
});

describe("the API", () => {
  const exported = (names: string[]) => names.filter((n) => typeof (look as unknown as Record<string, unknown>)[n] === "undefined");
  const imported = (src: string, from: string) => {
    const m = src.match(new RegExp(`import \\{([^}]*)\\} from "${from.replace(/[/.]/g, "\\$&")}"`));
    return (m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  };

  it("still exports everything Hat3D and tests/hat-3d.test.ts import", () => {
    const hat3d = ["createHatLook", ...["src/viewer/hat-view.js", "src/viewer/can-cooler.js"].flatMap((f) => imported(readFileSync(f, "utf8"), "./hat-look.js"))];
    const test = imported(readFileSync("tests/storefront/hat-3d.test.ts", "utf8"), "../../src/viewer/hat-look.js");
    expect(hat3d).toContain("GENERIC_VIEWS");
    expect(hat3d).toContain("linearRgb");
    expect(test).toContain("tagLogoColor");
    expect(exported([...hat3d, ...test])).toEqual([]);
  });

  it("returns the controller Hat3D drives, plus the live edit, and does nothing before the model loads", () => {
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const listeners: string[] = [];
    const mv = { loaded: false, model: null, addEventListener: (t: string) => listeners.push(t), removeEventListener: () => {} };
    const c = createHatLook(mv as unknown as HTMLElement, { die: HAT_NO_7_DIE });
    for (const k of ["setParts", "setColors", "setStageArt", "setSpot", "setLabel", "view", "paintNow", "dispose", "buildSprite", "beginLive", "liveFrame", "endLive"]) {
      expect(typeof (c as unknown as Record<string, unknown>)[k], k).toBe("function");
    }
    expect(Object.keys(c.state).sort()).toEqual(["colors", "label", "spots", "tagLogo"]);
    expect(listeners).toEqual(["load"]);
    c.paintNow();
    expect(c.beginLive("front", { rest: null })).toBe(false);
    expect(c.liveFrame("front", null, [1, 0, 0, 1, 0, 0])).toBe(false);
    expect(c.buildSprite("nowhere", null)).toBeNull();
    c.endLive("front");
    c.dispose();
    vi.unstubAllGlobals();
  });
});

// ---- Painting, on a stub canvas and model-viewer ----------------------------------------
type Matrix = number[];
type Stub = { n: number; draws: { target: string; src: string; m: Matrix }[]; uploads: string[] };

/** p · q, both in canvas setTransform order [a, b, c, d, e, f]. */
const mul = (p: Matrix, q: Matrix): Matrix => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
const S = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];

/**
 * Enough of a 2D canvas for the look to run: each drawImage is logged with the
 * transform it ran under, and `content` is a number the draws mix, so a crop's
 * hash follows what was drawn on the stage (a canvas with none reads as empty).
 */
class StubCanvas {
  width = 300;
  height = 150;
  content = 0;
  tag: string;
  ctx: StubContext | null = null;
  constructor(readonly stub: Stub) {
    this.tag = `canvas${++stub.n}`;
  }
  getContext() {
    return (this.ctx ??= new StubContext(this));
  }
}

class StubContext {
  m: Matrix = [1, 0, 0, 1, 0, 0];
  stack: Matrix[] = [];
  constructor(readonly c: StubCanvas) {}
  setTransform(...m: Matrix) {
    this.m = m;
  }
  transform(...m: Matrix) {
    this.m = mul(this.m, m);
  }
  save() {
    this.stack.push(this.m);
  }
  restore() {
    this.m = this.stack.pop() ?? [1, 0, 0, 1, 0, 0];
  }
  clearRect() {
    this.c.content = 0;
  }
  drawImage(src: StubCanvas) {
    this.c.stub.draws.push({ target: this.c.tag, src: src.tag, m: [...this.m] });
    if (src.content) this.c.content = (this.c.content * 31 + src.content) | 0;
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4);
    if (this.c.content) {
      data[0] = this.c.content & 255;
      data[3] = 255;
      data[4 * (w * h - 1) + 3] = 255;
    }
    return { data, width: w, height: h };
  }
  createImageData(w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  fillRect() {}
  putImageData() {}
  beginPath() {}
  rect() {}
  clip() {}
  moveTo() {}
  lineTo() {}
  arcTo() {}
  closePath() {}
  fill() {}
  stroke() {}
}

type StubTexture = { source: { element: StubCanvas; update: () => void } };
/** A canvas the look made, by its stub tag (the look types its canvases as the DOM's). */
const tagOf = (c: unknown) => (c as StubCanvas).tag;

/** A model-viewer with the shipped model's print materials, already loaded; uploads are logged by canvas. */
function stubHat(opts: Record<string, unknown> = {}) {
  const stub: Stub = { n: 0, draws: [], uploads: [] };
  vi.stubGlobal("document", { createElement: () => new StubCanvas(stub) });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 0));
  vi.stubGlobal("cancelAnimationFrame", (t: number) => clearTimeout(t));
  const material = (name: string) => {
    const m = {
      name,
      alpha: name.startsWith("print_label") ? "MASK" : "BLEND",
      base: null as StubTexture | null,
      normal: null as StubTexture | null,
      pbrMetallicRoughness: {
        baseColorTexture: { setTexture: (t: StubTexture) => void (m.base = t) },
        setBaseColorFactor() {},
        setRoughnessFactor() {},
        setMetallicFactor() {},
      },
      sheenColorTexture: { setTexture() {} },
      normalTexture: { setTexture: (t: StubTexture) => void (m.normal = t) },
      getAlphaMode: () => m.alpha,
      setAlphaMode: (a: string) => void (m.alpha = a),
      setSheenColorFactor() {},
      setClearcoatFactor() {},
      setClearcoatRoughnessFactor() {},
      setSheenRoughnessFactor() {},
    };
    return m;
  };
  const materials = ["part_crown_FL", "fixed_tag_logo", ...Object.values(ZONE_MATERIAL)].map(material);
  const mv = {
    loaded: true,
    model: { materials, getMaterialByName: (n: string) => materials.find((m) => m.name === n) },
    addEventListener() {},
    removeEventListener() {},
    createCanvasTexture: () => {
      const element = new StubCanvas(stub);
      return {
        source: { element, update: () => stub.uploads.push(element.tag) },
        sampler: { setWrapS() {}, setWrapT() {}, setScale() {}, setOffset() {} },
      };
    },
  };
  const hat = createHatLook(mv as unknown as HTMLElement, { die: HAT_NO_7_DIE, ...opts });
  const mat = (zid: string) => materials.find((m) => m.name === ZONE_MATERIAL[zid as keyof typeof ZONE_MATERIAL])!;
  /** A zone's art and relief canvases, by tag: what an upload of its pair logs. */
  const pair = (zid: string) => [mat(zid).base!.source.element.tag, mat(zid).normal!.source.element.tag].sort();
  /** The canvases uploaded since the last call, sorted. */
  const uploaded = () => stub.uploads.splice(0).sort();
  const canvasOf = (w: number, h: number, content: number) => Object.assign(new StubCanvas(stub), { width: w, height: h, content });
  /** A zone's bound art and relief canvases. */
  const canvases = (zid: string) => ({ art: mat(zid).base!.source.element, relief: mat(zid).normal!.source.element });
  return { hat, stub, pair, uploaded, canvasOf, canvases };
}

describe("painting, on a stub canvas and model-viewer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const front = HAT_NO_7_DIE.zones.find((z) => z.id === "front")!;
  const f = zoneFrame(front.rect, HAT_NO_7_DIE);

  /** A hat with art on every spot, and a piece to drag on the front. */
  function withArt() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = stubHat();
    const stage = t.canvasOf(W, H, 7);
    t.hat.setStageArt(stage as unknown as HTMLCanvasElement);
    t.hat.paintNow();
    t.uploaded();
    const sprite = t.hat.buildSprite("front", t.canvasOf(400, 200, 3) as unknown as HTMLCanvasElement)!;
    // a drag: past the area's left edge (the overshoot), then where the editor confines it
    const overshoot = pieceMatrix(sprite, { x: 20, y: 200, angle: 0.3 });
    const confined = pieceMatrix(sprite, { x: 270, y: 200, angle: 0.3 });
    const drag = (to = overshoot) => {
      expect(t.hat.beginLive("front", { rest: null })).toBe(true);
      expect(t.hat.liveFrame("front", sprite, to)).toBe(true);
    };
    return { ...t, stage, sprite, overshoot, confined, drag };
  }

  it("uploads nothing when nothing changed, and a method change on one spot uploads that pair only", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { hat, pair, uploaded, canvasOf } = stubHat();
    // every zone once, on load
    expect(uploaded()).toHaveLength(2 * HAT_NO_7_DIE.zones.length);
    hat.paintNow();
    expect(uploaded()).toEqual([]);
    const stage = canvasOf(W, H, 7) as unknown as HTMLCanvasElement;
    hat.setStageArt(stage);
    hat.paintNow();
    uploaded();
    hat.setStageArt(stage);
    hat.paintNow();
    expect(uploaded(), "the same art again: every crop's hash is unchanged").toEqual([]);
    hat.setSpot("left", { method: "woven_patch" });
    hat.paintNow();
    expect(uploaded()).toEqual(pair("left"));
    hat.dispose();
  });

  it("draws a live frame under the zone's own draw times m, its relief under draw · S(RELIEF_SCALE) · m · S(sprite / normals)", () => {
    const { hat, stub, sprite, pair, uploaded } = withArt();
    expect(hat.beginLive("front", { rest: null })).toBe(true);
    uploaded();
    stub.draws.length = 0;
    const made = stub.n;
    const m = pieceMatrix(sprite, { x: 490, y: 265, angle: 0.3, scale: 0.8 });
    expect(hat.liveFrame("front", sprite, m)).toBe(true);
    expect(stub.n, "no canvas made in a frame").toBe(made);
    expect(uploaded()).toEqual(pair("front"));
    const color = stub.draws.find((d) => d.src === tagOf(sprite.color))!;
    const relief = stub.draws.find((d) => d.src === tagOf(sprite.normals))!;
    const want = mul(f.art.draw, m);
    const rwant = mul(mul(mul(f.relief.draw, S(RELIEF_SCALE)), m), S(sprite.w / sprite.normals.width, sprite.h / sprite.normals.height));
    color.m.forEach((v, i) => expect(v, `art ${i}`).toBeCloseTo(want[i], 9));
    relief.m.forEach((v, i) => expect(v, `relief ${i}`).toBeCloseTo(rwant[i], 9));
    hat.dispose();
  });

  it("holds a drag's last frame, at the confined pose, until the next handover, even of identical art", () => {
    const { hat, stub, stage, sprite, overshoot, confined, drag, pair, uploaded } = withArt();
    drag(overshoot);
    // Hat3D's debounce fires mid-drag: the art as it was, and the live zone is left be
    hat.setStageArt(stage as unknown as HTMLCanvasElement);
    hat.paintNow();
    expect(uploaded()).toEqual(pair("front"));
    stub.draws.length = 0;
    hat.endLive("front", { sprite, m: confined });
    const last = stub.draws.filter((d) => d.src === tagOf(sprite.color)).at(-1)!;
    mul(f.art.draw, confined).forEach((v, i) => expect(last.m[i]).toBeCloseTo(v, 9));
    uploaded();
    // Hat3D's own paints and its method re-sync are not the result
    hat.paintNow();
    hat.setSpot("front", { method: "embroidery" });
    hat.setLabel({ shape: "tall" });
    hat.paintNow();
    expect(uploaded()).toEqual([]);
    // the result: the piece back where it was, so the same art as mid-drag
    hat.setStageArt(stage as unknown as HTMLCanvasElement);
    hat.paintNow();
    expect(uploaded()).toEqual(pair("front"));
    // a spot's own art is a handover too
    drag();
    hat.endLive("front");
    uploaded();
    hat.setSpot("front", { art: stage as unknown as HTMLCanvasElement });
    hat.paintNow();
    expect(uploaded()).toEqual(pair("front"));
    hat.dispose();
  });

  it("ends a hold no handover releases after HOLD_MAX_MS, with the exact rebuild", () => {
    const { hat, drag, pair, uploaded } = withArt();
    drag();
    hat.endLive("front");
    uploaded();
    vi.advanceTimersByTime(HOLD_MAX_MS - 1);
    hat.paintNow();
    expect(uploaded()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(uploaded()).toEqual(pair("front"));
    hat.dispose();
  });

  it("keeps a held frame through a press that never moves, and through a drag that changed nothing", () => {
    const { hat, stage, drag, pair, uploaded } = withArt();
    drag();
    hat.endLive("front");
    uploaded();
    // pressed again, released without a move: the canvases still show drag 1's frame
    expect(hat.beginLive("front", { rest: null })).toBe(true);
    hat.endLive("front");
    hat.paintNow();
    expect(uploaded(), "drag 1's piece does not flash back to where it was before").toEqual([]);
    // a drag that left the piece where drag 1 put it: still drag 1's result to come
    drag();
    uploaded();
    hat.endLive("front", { changed: false });
    hat.paintNow();
    expect(uploaded()).toEqual([]);
    hat.setStageArt(stage as unknown as HTMLCanvasElement);
    hat.paintNow();
    expect(uploaded()).toEqual(pair("front"));
    hat.dispose();
  });

  it("shows the committed layer at once for a drag that changed nothing, or with `now`", () => {
    const { hat, drag, pair, uploaded } = withArt();
    drag();
    uploaded();
    hat.endLive("front", { changed: false });
    expect(uploaded()).toEqual(pair("front"));
    hat.paintNow();
    expect(uploaded()).toEqual([]);
    drag();
    uploaded();
    hat.endLive("front", { now: true });
    expect(uploaded()).toEqual(pair("front"));
    vi.advanceTimersByTime(HOLD_MAX_MS);
    expect(uploaded(), "no hold left to time out").toEqual([]);
    hat.dispose();
  });
});

// ---- A phone's texture resolution ---------------------------------------------------------
describe("textureScale: each zone's canvases at a fraction of die px", () => {
  const T = 0.6;
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is today's frame exactly at 1", () => {
    for (const zone of HAT_NO_7_DIE.zones) {
      const f = zoneFrame(zone.rect, HAT_NO_7_DIE);
      expect(zoneFrame(zone.rect, HAT_NO_7_DIE, { textureScale: 1 })).toEqual(f);
      expect([f.cw, f.ch, f.rcw, f.rch]).toEqual([f.w, f.h, f.rw, f.rh]);
    }
  });

  // the rebuilt die's front island, about 1800 x 1000 die px, beside today's zones
  const ISLANDS = [...HAT_NO_7_DIE.zones.map((z) => ({ id: z.id, rect: z.rect })), { id: "big front", rect: { x: 20, y: 20, w: 1500, h: 1000 } }];
  for (const { id, rect } of ISLANDS) {
    it(`${id}: covers its region at ${T}, and a die pixel still reaches its own texel`, () => {
      const f = zoneFrame(rect, HAT_NO_7_DIE, { textureScale: T });
      const one = zoneFrame(rect, HAT_NO_7_DIE);
      // the same die region, on a canvas T the size (rounded up, so it covers the region)
      expect([f.x0, f.y0, f.w, f.h, f.rx0, f.ry0, f.rw, f.rh]).toEqual([one.x0, one.y0, one.w, one.h, one.rx0, one.ry0, one.rw, one.rh]);
      expect(f.cw).toBe(Math.ceil(f.w * T - 1e-9));
      expect(f.rch).toBe(Math.ceil(f.rh * T - 1e-9));
      expect(f.cw / T).toBeGreaterThanOrEqual(f.w);
      expect(f.rcw / T).toBeGreaterThanOrEqual(f.rw);
      for (const [x, y] of probes(rect, f)) {
        const art = sampled(f.art, { w: f.cw, h: f.ch }, { w: W, h: H }, x, y);
        const want = drawn(f.art, x, y);
        expect(art.px, `${id} art x at ${x},${y}`).toBeCloseTo(want.px, 9);
        expect(art.py, `${id} art y at ${x},${y}`).toBeCloseTo(want.py, 9);
        expect(art.s).toBeGreaterThanOrEqual(-1e-12);
        expect(art.s).toBeLessThanOrEqual(1 + 1e-12);
        expect(art.t).toBeGreaterThanOrEqual(-1e-12);
        expect(art.t).toBeLessThanOrEqual(1 + 1e-12);
        // T canvas px a die px
        expect(drawn(f.art, x + 10, y).px - want.px).toBeCloseTo(10 * T, 9);
        const X = x * RELIEF_SCALE;
        const Y = y * RELIEF_SCALE;
        const rel = sampled(f.relief, { w: f.rcw, h: f.rch }, { w: W * RELIEF_SCALE, h: H * RELIEF_SCALE }, X, Y);
        const rwant = drawn(f.relief, X, Y);
        expect(rel.px, `${id} relief x at ${x},${y}`).toBeCloseTo(rwant.px, 9);
        expect(rel.py, `${id} relief y at ${x},${y}`).toBeCloseTo(rwant.py, 9);
      }
    });
  }

  it("binds canvases of the scaled size, and draws a live frame under the scaled draw, the sprite over its die px box", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = stubHat({ textureScale: T });
    const u = stubHat();
    for (const zone of HAT_NO_7_DIE.zones) {
      const f = zoneFrame(zone.rect, HAT_NO_7_DIE, { textureScale: T });
      const c = t.canvases(zone.id);
      expect([c.art.width, c.art.height, c.relief.width, c.relief.height], zone.id).toEqual([f.cw, f.ch, f.rcw, f.rch]);
    }
    const front = HAT_NO_7_DIE.zones.find((z) => z.id === "front")!;
    const f = zoneFrame(front.rect, HAT_NO_7_DIE, { textureScale: T });
    t.hat.setStageArt(t.canvasOf(W, H, 7) as unknown as HTMLCanvasElement);
    t.hat.paintNow();
    const art = t.canvasOf(400, 200, 3) as unknown as HTMLCanvasElement;
    const sprite = t.hat.buildSprite("front", art)!;
    const full = u.hat.buildSprite("front", u.canvasOf(400, 200, 3) as unknown as HTMLCanvasElement)!;
    // the same die px box, built smaller
    expect([sprite.w, sprite.h, sprite.pad]).toEqual([full.w, full.h, full.pad]);
    expect(sprite.color.width).toBe(Math.round(full.w * T));
    expect(sprite.normals.width).toBe(Math.round(full.w * RELIEF_SCALE * T));
    expect(t.hat.beginLive("front", { rest: null })).toBe(true);
    t.stub.draws.length = 0;
    const m = pieceMatrix(sprite, { x: 490, y: 265, angle: 0.3, scale: 0.8 });
    expect(t.hat.liveFrame("front", sprite, m)).toBe(true);
    const color = t.stub.draws.find((d) => d.src === tagOf(sprite.color))!;
    const relief = t.stub.draws.find((d) => d.src === tagOf(sprite.normals))!;
    const want = mul(f.art.draw, m);
    const rwant = mul(mul(mul(f.relief.draw, S(RELIEF_SCALE)), m), S(sprite.w / sprite.normals.width, sprite.h / sprite.normals.height));
    color.m.forEach((v, i) => expect(v, `art ${i}`).toBeCloseTo(want[i], 9));
    relief.m.forEach((v, i) => expect(v, `relief ${i}`).toBeCloseTo(rwant[i], 9));
    t.hat.endLive("front", { now: true });
    t.hat.dispose();
    u.hat.dispose();
  });

  it("measures the same art the same size at any scale: a crop's box is die px in the zone's rect", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    type M = { w: number; h: number; maxW: number; maxH: number } | null;
    const sizes = (textureScale: number) => {
      const got: Record<string, M> = {};
      const t = stubHat({ textureScale, onMeasure: (spot: string, m: M) => void (got[spot] = m) });
      t.hat.setStageArt(t.canvasOf(W, H, 7) as unknown as HTMLCanvasElement);
      t.hat.paintNow();
      t.hat.dispose();
      return got;
    };
    const one = sizes(1);
    const phone = sizes(T);
    expect(one.front!.w).toBeGreaterThan(4);
    for (const spot of ["front", "left", "right", "back", "label"]) {
      expect(phone[spot]!.w, spot).toBeCloseTo(one[spot]!.w, 9);
      expect(phone[spot]!.h, spot).toBeCloseTo(one[spot]!.h, 9);
    }
  });
});
