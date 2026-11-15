// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/components/storefront/hat/hat-look.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
/**
 * The No. 7 hat's live 3D look on model-viewer 4.2.0: part colours, the art
 * laid out on the die, the decoration method looks and the camera views per
 * spot. Hat3D.jsx is the one place it is used.
 *
 * Moved here from the model build's lab (scripts/blender/hat-no7/lab/hat-look.js,
 * where Brayden judged it at L1, and at L3 on the production model) with only
 * what the lab alone needs taken out: fetching its files, its sample art, its
 * page, and its spin (nothing on the site turns by itself). The method looks,
 * the field maths and the camera views are the lab's, line for line. Two things
 * are new: part colours are the design's own map, one colour a part, and the art
 * can come in as the stage's whole art layer (setStageArt), each spot showing
 * what was placed inside its zone. It imports nothing, so the lab harness can
 * load this very file: the die, the zones' placements on the model, the tag
 * logo's part and contrast rule, and the hat style's part rules (which parts
 * follow another's colour, never show their own, or are plastic:
 * src/lib/hat/hat-style-config.js) come in as arguments. model-viewer itself
 * is loaded by ../coozie/load-3d.js, and nowhere else.
 *
 * The contract (scripts/blender/hat-no7, shared with the model):
 * - Fabric parts are `part_<id>`, one per id of src/lib/hat/hat-config.js
 *   HAT_PARTS; their colour is baseColorFactor only (linear RGB) plus a sheen
 *   tint. The lining faces carry their panel's own part, and the inside seam
 *   tapes (`part_tape`) always take the back panels' colour: stitching and tapes
 *   follow the panel colour (Brayden, L0, 2026-10-19). The binding round the
 *   strap opening follows them too, until it is given its own colour. There is
 *   no strap tab block (Brayden, 2026-10-20).
 * - `fixed_*` materials are never repainted by a part colour. The one there is,
 *   `fixed_tag_logo`, is the full REEL48 logo on the strap's own loop tag (a
 *   decal +0.2 mm, alpha BLEND, a white texture on texCoord 0): a fixed mark,
 *   standard on every hat and never customer art. Its only change is its
 *   contrast colour (baseColorFactor), set whenever the strap colour changes:
 *   white on dark straps, #263151 on light ones (tag_no7.json logo.contrast).
 * - `print_front|left|right|back` are decal overlays (+0.3 mm, alpha BLEND, the
 *   mesh ~5 mm past its zone's rect) and `print_label_tall|square` the label
 *   cards (alpha MASK, the rect exactly). Their texCoord 0 is the die's stage
 *   frame, unflipped in the glTF: a die pixel (x, y) is at u = x / W, v = y / H.
 *   The unchosen label card is hidden by alpha 0.
 * - Each print material has its OWN pair of canvases, cut to its zone's rect
 *   plus a 5 mm bleed (zoneFrame): `art` (sRGB: base colour and sheen colour)
 *   and `relief` (linear: the normal map, at RELIEF_SCALE), both at the look's
 *   textureScale (1: a canvas px a die px; a phone takes 0.6). A sampler transform
 *   (KHR_texture_transform's uv' = offset + scale * uv) maps the frame's UVs
 *   onto the sub-canvas, clamped at its edge. So a change to one spot repaints
 *   and uploads that spot's pair only, and a drag on the hat (beginLive /
 *   liveFrame) touches one small texture a frame, not the whole die's.
 * - One canvas per colour-space class: TextureInfo.setTexture sets the texture's
 *   colour space for every material using it, so an art canvas is only ever
 *   bound to colour slots and a relief canvas only to normal slots.
 * - setTexture also copies its slot's own transform (the model's: identity, see
 *   tests/hat-3d.test.ts) onto the texture it binds, so the sub-rect transform
 *   goes on after every binding, never before.
 * - three.js uploads a canvas texture with flipY and the model's own textures
 *   without, so every canvas is drawn upside down (as CanCooler3D's paint()).
 *   It also allocates a texture's storage at its first upload's size, so each
 *   canvas is sized once, before it is bound, and never resized.
 * - Each print material's method look is set by its own factors (roughness,
 *   clearcoat, sheen), so methods differ by spot. The model exports a 0.001
 *   clearcoat and sheen so three.js builds a physical material to raise.
 */

// ---- Settings --------------------------------------------------------------------
// A number, set as the property: model-viewer ignores an exposure that is a string.
export const EXPOSURE = 2.15;
export const PAINT_DEBOUNCE_MS = 120;
// The relief (normal) canvas is half the stage's resolution: 3.9 px a millimetre
// at 200 px/in, which is what the stitch textures below are drawn for.
export const RELIEF_SCALE = 0.5;
// The finest period a texture may have on the relief canvas, in its pixels; finer
// rows alias into moire, so they are drawn at this period instead.
const MIN_PERIOD_PX = 2.6;
// glTF normal maps are +Y up (OpenGL). Flip this if a raised dome reads as a dent.
const NORMAL_GREEN = 1;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MM_PER_IN = 25.4;
// How far past its zone's rect a print overlay's mesh runs (the model's ~5 mm),
// so its canvas covers the whole mesh and the clamped edge texel is bleed, never art.
export const BLEED_MM = 5;
// glTF's CLAMP_TO_EDGE (model-viewer's Sampler takes glTF's wrap enums).
const CLAMP_TO_EDGE = 33071;
// A relief texel with no relief: the tangent-space normal straight up.
const FLAT_NORMAL = "rgb(128,128,255)";
// Live-edit sprites kept (buildSprite): enough for the pieces one spot holds.
const SPRITE_CACHE = 8;
// The longest a drag's last frame is held (endLive) waiting for its result to
// be handed over: Hat3D takes new art 120 ms after it settles, at idle, so a
// hold still there after this has no handover coming and the exact rebuild
// runs anyway.
export const HOLD_MAX_MS = 1500;

export const OVERLAY_MATERIAL = { front: "print_front", left: "print_left", right: "print_right", back: "print_back" };
export const LABEL_MATERIAL = { tall: "print_label_tall", square: "print_label_square" };
export const LABEL_ZONE = { tall: "label_tall", square: "label_square" };
export const PRINT_MATERIALS = [...Object.values(OVERLAY_MATERIAL), ...Object.values(LABEL_MATERIAL)];
/** The print material each die zone paints. */
export const ZONE_MATERIAL = { ...OVERLAY_MATERIAL, label_tall: LABEL_MATERIAL.tall, label_square: LABEL_MATERIAL.square };
export const TAG_LOGO_MATERIAL = "fixed_tag_logo";
/** The No. 6's eyelets' dark inner ends (Brayden, 2026-10-24: "Dark-back the eyelets"): never repainted. */
export const EYELET_BACK_MATERIAL = "fixed_eyelet_back";
export const FIXED_MATERIALS = [TAG_LOGO_MATERIAL, EYELET_BACK_MATERIAL];

/**
 * The REEL48 logo on the strap tag: the part it stands out from, and the
 * contrast rule (tag_no7.json logo.contrast; tests/hat-3d.test.ts holds the two
 * equal). `sheen` scales the logo colour into its sheen, so it reads as thread.
 * The part is the No. 7's: Hat3D passes its style's (hat-style-config.js
 * tagLogo) as createHatLook's `tagLogo`.
 */
export const TAG_LOGO = {
  material: TAG_LOGO_MATERIAL,
  follows: "strap",
  contrast: { lightThreshold: 0.4, onDark: "#FFFFFF", onLight: "#263151" },
  sheen: 0.3,
};

// ---- Part colours ----------------------------------------------------------------------
export const PART_PREFIX = "part_";
/**
 * What a part shows until the design gives it a colour: navy, the colour the
 * lab opened in and the poster shows. Not a palette (that is Brayden's to
 * send: hat-config.js HAT_FABRIC_COLORS).
 */
export const DEFAULT_COLOR = "#1F2A44";
/**
 * Parts that show another part's colour, and parts never shown in their own,
 * when a host names none: the No. 7's (hat-style-config.js partFollows and
 * neverOwn; tests/hat-style-config.test.ts holds them equal). Hat3D passes
 * its style's. The inside seam tapes always follow (Brayden, L0, 2026-10-19:
 * no separate tape colour); the binding round the strap opening is the
 * panels' own fabric, so it does until it has its own.
 */
export const PART_FOLLOWS = { tape: "crown_LB", binding: "crown_LB" };
const NEVER_OWN = new Set(["tape"]);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The colour each of `ids` shows, as a CSS hex: its own from `colors` (the
 * design's `parts`, { crown_FL: "#rrggbb", ... }), else the colour of the part
 * it follows (`follows`), else `fallback`. A part in `neverOwn` always
 * follows. A value that is not a hex colour (a palette id the host has not
 * resolved) counts as none, so the part shows its default rather than black.
 *
 * @param {Record<string, string> | null | undefined} colors
 * @param {string[]} ids
 * @param {string} [fallback]
 * @param {{ follows?: Record<string, string>, neverOwn?: Iterable<string> }} [rules] the style's
 */
export function resolvePartColors(colors, ids, fallback = DEFAULT_COLOR, { follows = PART_FOLLOWS, neverOwn = NEVER_OWN } = {}) {
  const never = neverOwn instanceof Set ? neverOwn : new Set(neverOwn);
  const own = (id) => {
    const c = never.has(id) ? null : colors?.[id];
    return typeof c === "string" && HEX.test(c) ? c : null;
  };
  return Object.fromEntries(ids.map((id) => [id, own(id) ?? (follows[id] ? own(follows[id]) : null) ?? fallback]));
}
/**
 * The decoration methods: the material factors each sets on its spot's print
 * material, and the relief (mm) its look is drawn with (design_modelFinal.md §3).
 */
export const METHODS = {
  embroidery: {
    label: "Embroidery",
    look: { roughness: 0.5, clearcoat: 0.001, clearcoatRoughness: 0.5, sheen: 0.6, sheenRoughness: 0.35 },
    relief: { dome: 0.8, domeRadius: 1.1, rowPitch: 0.45, rowDepth: 0.07, satinBelow: 7, satinPitch: 0.4, satinDepth: 0.08, run: 0.06 },
    shadow: { mm: 0.8, alpha: 0.28 },
  },
  pvc_patch: {
    label: "PVC patch",
    look: { roughness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.1, sheen: 0, sheenRoughness: 0.5 },
    relief: { dilate: 1.5, plate: 1.0, bevel: 1.0, raise: 0.35, groove: 0.25, grooveDepth: 0.22, blur: 1 },
    shadow: { mm: 1.2, alpha: 0.4 },
  },
  silicon_patch: {
    label: "Silicone patch",
    look: { roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0, sheenRoughness: 0.5 },
    relief: { dilate: 1.5, plate: 1.0, bevel: 1.8, raise: 0.3, groove: 0.3, grooveDepth: 0.15, blur: 2 },
    shadow: { mm: 1.2, alpha: 0.35 },
  },
  woven_patch: {
    label: "Woven patch",
    look: { roughness: 0.7, clearcoat: 0.001, clearcoatRoughness: 0.5, sheen: 0.25, sheenRoughness: 0.5 },
    relief: { margin: 1.0, corner: 2.0, border: 2.5, base: 0.45, bevel: 0.4, rope: 0.35, ropePitch: 1.1, weavePitch: 0.3, weaveDepth: 0.04 },
    shadow: { mm: 0.9, alpha: 0.3 },
  },
  woven_label: {
    label: "Woven label",
    look: { roughness: 0.65, clearcoat: 0.001, clearcoatRoughness: 0.5, sheen: 0.2, sheenRoughness: 0.5 },
    relief: { inset: 0.1 * MM_PER_IN, fold: 2.5, foldDepth: 0.18, bevel: 0.3, weavePitch: 0.3, weaveDepth: 0.035 },
  },
};
export const PATCH_METHODS = ["pvc_patch", "silicon_patch", "woven_patch"];

/** The decoration spots, and the die zones each one fills. */
export const SPOTS = [
  { id: "front", label: "Front", zones: ["front"] },
  { id: "left", label: "Left side", zones: ["left"] },
  { id: "right", label: "Right side", zones: ["right"] },
  { id: "back", label: "Back", zones: ["back"] },
  { id: "label", label: "Inside label", zones: ["label_tall", "label_square"] },
];
const ZONE_SPOT = { front: "front", left: "left", right: "right", back: "back", label_tall: "label", label_square: "label" };

// ---- Colour --------------------------------------------------------------------------
/** A CSS hex colour's linear RGB (short hexes widened first, as CanCooler3D). */
export function linearRgb(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let h = String(hex).replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => lin((parseInt(h.slice(i, i + 2), 16) || 0) / 255));
}

/** WCAG relative luminance of a CSS hex colour (0 black .. 1 white). */
export function relativeLuminance(hex) {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The strap tag logo's colour on a strap of this colour: light straps get the dark mark. */
export function tagLogoColor(strapHex, contrast = TAG_LOGO.contrast) {
  return relativeLuminance(strapHex) >= contrast.lightThreshold ? contrast.onLight : contrast.onDark;
}

function rgb8(hex) {
  const h = String(hex).replace(/^#/, "");
  const f = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
}

// ---- Art -------------------------------------------------------------------------------
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * The canvas cut to its painted (alpha > 8) pixels, with a pixel of margin:
 * `art`, `box`, where that sits on the canvas, and `hash`, of every pixel of
 * the canvas (FNV-1a over RGBA words, so any one changed pixel changes it): a
 * zone whose art is unchanged is not built again. Null when nothing is painted.
 */
export function inkCrop(c) {
  const g = c.getContext("2d", { willReadFrequently: true });
  const { data, width: w, height: h } = g.getImageData(0, 0, c.width, c.height);
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);
  let hash = 0x811c9dc5;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      hash = Math.imul(hash ^ px[y * w + x], 16777619);
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(w - 1, x1 + 1);
  y1 = Math.min(h - 1, y1 + 1);
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { art: out, box: { x: x0, y: y0, w: out.width, h: out.height }, hash: hash >>> 0 };
}

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** The art's box fitted inside a rect (contain, centred), inset by `inset` px. */
export function fitBox(aw, ah, rect, inset = 0) {
  const bw = rect.w - 2 * inset;
  const bh = rect.h - 2 * inset;
  const k = Math.min(bw / aw, bh / ah);
  const w = aw * k;
  const h = ah * k;
  return { x: inset + (bw - w) / 2, y: inset + (bh - h) / 2, w, h };
}

// ---- Field maths (Float32 fields, row-major, die orientation) -----------------------------
const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Euclidean distance (px) from each pixel where `inside(i)` holds to the nearest
 * pixel where it doesn't; 0 elsewhere. Beyond the field's edge counts as outside,
 * or as inside with `edgeInside` (measuring distance to the art from the empty
 * pixels: the rect's edge must not act as art).
 */
function distanceInside(w, h, inside, edgeInside = false) {
  const W2 = w + 2;
  const H2 = h + 2;
  const g = new Float64Array(W2 * H2);
  if (edgeInside) g.fill(INF);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[(y + 1) * W2 + x + 1] = inside(y * w + x) ? INF : 0;
  const n = Math.max(W2, H2);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W2; x++) {
    for (let y = 0; y < H2; y++) f[y] = g[y * W2 + x];
    edt1d(f, H2, d, v, z);
    for (let y = 0; y < H2; y++) g[y * W2 + x] = d[y];
  }
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) f[x] = g[y * W2 + x];
    edt1d(f, W2, d, v, z);
    for (let x = 0; x < W2; x++) g[y * W2 + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + 1) * W2 + x + 1]);
  return out;
}

function boxBlur(src, w, h, r, passes = 1) {
  if (r < 1) return src;
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[o + x] = s / n;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n;
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

function maxFilter(src, w, h, r) {
  const t = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      t[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, t[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// a rounded (quarter-circle) edge profile: 0 at the edge, 1 from t = 1 on
const roundEdge = (t) => {
  const u = 1 - clamp01(t);
  return Math.sqrt(1 - u * u);
};

/**
 * Heights (mm) on the relief grid -> a canvas of tangent-space normals (glTF, +Y
 * up). Opaque, unless `cutout`: then a texel with no height and no slope is
 * clear, so a live sprite's relief lies over the zone's without blanking it.
 */
function normalsCanvas(hgt, w, h, pxmm, cutout = false) {
  const c = canvas(w, h);
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const d = img.data;
  const k = pxmm / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (hgt[y * w + Math.min(w - 1, x + 1)] - hgt[y * w + Math.max(0, x - 1)]) * k;
      const gy = (hgt[Math.min(h - 1, y + 1) * w + x] - hgt[Math.max(0, y - 1) * w + x]) * k;
      // up on the image is -y on the die: n = (-dh/dx, +dh/dy_die, 1)
      const nx = -gx;
      const ny = NORMAL_GREEN * gy;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      d[i * 4] = Math.round((nx * l * 0.5 + 0.5) * 255);
      d[i * 4 + 1] = Math.round((ny * l * 0.5 + 0.5) * 255);
      d[i * 4 + 2] = Math.round((l * 0.5 + 0.5) * 255);
      d[i * 4 + 3] = cutout && hgt[i] === 0 && gx === 0 && gy === 0 ? 0 : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A field as a black (or `rgb`) canvas whose alpha is the field times `alpha`. */
function alphaCanvas(field, w, h, alpha, rgb = [0, 0, 0]) {
  const c = canvas(w, h);
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = Math.round(clamp01(field[i] * alpha) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---- Method looks ------------------------------------------------------------------------
/**
 * One zone's layer: `color` (a canvas the zone rect's size, die orientation:
 * the art plus whatever the method adds round it) and `normals` (a canvas on the
 * relief grid). `z` holds the zone geometry: rect (stage px), rw/rh (relief px),
 * pxmm (full res) and rpxmm (relief), the placed art box (px in the rect).
 */
function artFields(z, art, box) {
  // the art at relief resolution: alpha, and luminance for colour edges
  const c = canvas(z.rw, z.rh);
  const g = c.getContext("2d", { willReadFrequently: true });
  const s = z.rw / z.rect.w;
  if (art) g.drawImage(art, box.x * s, box.y * s, box.w * s, box.h * s);
  const d = g.getImageData(0, 0, z.rw, z.rh).data;
  c.width = 0;
  const A = new Float32Array(z.rw * z.rh);
  const L = new Float32Array(z.rw * z.rh);
  for (let i = 0; i < A.length; i++) {
    A[i] = d[i * 4 + 3] / 255;
    L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  }
  return { A, L };
}

function drawArt(g, art, box) {
  if (!art) return;
  g.imageSmoothingQuality = "high";
  g.drawImage(art, box.x, box.y, box.w, box.h);
}

function embroidery(z, art, box, spec) {
  const R = METHODS.embroidery.relief;
  const { rw, rh, rpxmm } = z;
  const { A } = artFields(z, art, box);
  const dIn = distanceInside(rw, rh, (i) => A[i] > 0.5);
  const near = maxFilter(dIn, rw, rh, Math.max(1, Math.round(3.5 * rpxmm)));
  // gradient of the distance: satin stitches run across the stroke, along it
  // the dome is softened; the stitch texture is not (a blur would erase its rows)
  const D = new Float32Array(rw * rh);
  for (let i = 0; i < D.length; i++) if (A[i] > 0.02) D[i] = R.dome * roundEdge(dIn[i] / rpxmm / R.domeRadius) * clamp01(A[i] * 2);
  const Ds = boxBlur(D, rw, rh, 1, 1);
  const H = new Float32Array(rw * rh);
  const rowP = Math.max(R.rowPitch * rpxmm, MIN_PERIOD_PX);
  const satP = Math.max(R.satinPitch * rpxmm, MIN_PERIOD_PX);
  const blurD = boxBlur(dIn, rw, rh, 1, 1);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (A[i] <= 0.02) continue;
      const dmm = dIn[i] / rpxmm;
      const width = (2 * near[i]) / rpxmm;
      let tex;
      if (width < R.satinBelow) {
        const gx = blurD[y * rw + Math.min(rw - 1, x + 1)] - blurD[y * rw + Math.max(0, x - 1)];
        const gy = blurD[Math.min(rh - 1, y + 1) * rw + x] - blurD[Math.max(0, y - 1) * rw + x];
        const l = Math.hypot(gx, gy) || 1;
        // phase along the stroke (perpendicular to the gradient): ridges lie across it
        const ph = (x * -gy + y * gx) / l / satP;
        tex = R.satinDepth * (0.5 + 0.5 * Math.cos(2 * Math.PI * ph));
      } else {
        // tatami fill rows at 45 degrees, with a faint brick offset every other row
        const u = (x + y) / Math.SQRT2 / rowP;
        const row = Math.floor((x - y) / Math.SQRT2 / (rowP * 6));
        tex = R.rowDepth * (0.5 + 0.5 * Math.cos(2 * Math.PI * (u + (row % 2) * 0.5)));
      }
      const fade = clamp01(dmm / 0.35);
      const run = R.run * Math.exp(-(((dmm - 0.2) / 0.12) ** 2));
      H[i] = Ds[i] + (tex * fade + run) * clamp01(A[i] * 2);
    }
  }
  const color = canvas(z.rect.w, z.rect.h);
  const g = color.getContext("2d");
  const sh = METHODS.embroidery.shadow;
  const S = boxBlur(A, rw, rh, Math.max(1, Math.round((sh.mm * rpxmm) / 2)), 2);
  const shadow = alphaCanvas(S, rw, rh, sh.alpha);
  g.imageSmoothingQuality = "high";
  g.drawImage(shadow, 0, 0, z.rect.w, z.rect.h);
  shadow.width = 0;
  drawArt(g, art, box);
  return { color, normals: normalsCanvas(H, rw, rh, rpxmm, z.cutout) };
}

function plateMethod(method) {
  return (z, art, box, spec) => {
    const R = METHODS[method].relief;
    const sh = METHODS[method].shadow;
    const { rw, rh, rpxmm, pxmm } = z;
    const W = z.rect.w;
    const Hh = z.rect.h;
    // the plate: the art dilated by R.dilate mm, at full resolution for a crisp edge
    const full = canvas(W, Hh);
    const fg = full.getContext("2d", { willReadFrequently: true });
    drawArt(fg, art, box);
    const fa = fg.getImageData(0, 0, W, Hh).data;
    const dOut = distanceInside(W, Hh, (i) => fa[i * 4 + 3] <= 127, true);
    const dil = R.dilate * pxmm;
    const plate = fg.createImageData(W, Hh);
    const [pr, pg, pb] = rgb8(spec.patch);
    for (let i = 0; i < W * Hh; i++) {
      plate.data[i * 4] = pr;
      plate.data[i * 4 + 1] = pg;
      plate.data[i * 4 + 2] = pb;
      plate.data[i * 4 + 3] = Math.round(clamp01(dil + 0.5 - dOut[i]) * 255);
    }
    fg.putImageData(plate, 0, 0);
    // relief: plate with a rounded bevel, the art raised on it, grooves where colours meet
    const { A, L } = artFields(z, art, box);
    const dOutR = distanceInside(rw, rh, (i) => A[i] <= 0.5, true);
    const P = new Float32Array(rw * rh);
    for (let i = 0; i < P.length; i++) P[i] = clamp01(R.dilate * rpxmm + 0.5 - dOutR[i]);
    const dIn = distanceInside(rw, rh, (i) => P[i] > 0.5);
    const Ab = boxBlur(A, rw, rh, 1, 1);
    const H = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        if (P[i] <= 0) continue;
        const bevel = R.plate * roundEdge(dIn[i] / rpxmm / R.bevel);
        const gx = L[y * rw + Math.min(rw - 1, x + 1)] - L[y * rw + Math.max(0, x - 1)];
        const gy = L[Math.min(rh - 1, y + 1) * rw + x] - L[Math.max(0, y - 1) * rw + x];
        const edge = clamp01(Math.hypot(gx, gy) * 4) * clamp01(A[i] * 2);
        H[i] = bevel + R.raise * Ab[i] - R.grooveDepth * edge;
      }
    }
    const color = canvas(W, Hh);
    const g = color.getContext("2d");
    const S0 = boxBlur(P, rw, rh, Math.max(1, Math.round((sh.mm * rpxmm) / 2)), 2);
    const shift = Math.round(0.6 * rpxmm);
    const S = new Float32Array(S0.length);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) S[y * rw + x] = S0[Math.max(0, y - shift) * rw + x];
    const shadow = alphaCanvas(S, rw, rh, sh.alpha);
    g.imageSmoothingQuality = "high";
    g.drawImage(shadow, 0, 0, W, Hh);
    shadow.width = 0;
    g.drawImage(full, 0, 0);
    full.width = 0;
    drawArt(g, art, box);
    return { color, normals: normalsCanvas(boxBlur(H, rw, rh, 1, R.blur), rw, rh, rpxmm, z.cutout) };
  };
}

function wovenPatch(z, art, box, spec) {
  const R = METHODS.woven_patch.relief;
  const { rw, rh, rpxmm, pxmm } = z;
  const W = z.rect.w;
  const Hh = z.rect.h;
  const pad = (R.border + R.margin) * pxmm;
  const px0 = Math.max(0, box.x - pad);
  const py0 = Math.max(0, box.y - pad);
  const px1 = Math.min(W, box.x + box.w + pad);
  const py1 = Math.min(Hh, box.y + box.h + pad);
  const bw = R.border * pxmm;
  const cr = R.corner * pxmm;
  const color = canvas(W, Hh);
  const g = color.getContext("2d");
  // shadow under the patch
  const sh = METHODS.woven_patch.shadow;
  const P = new Float32Array(rw * rh);
  const s = rw / W;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const X = (x + 0.5) / s;
      const Y = (y + 0.5) / s;
      P[y * rw + x] = X >= px0 && X <= px1 && Y >= py0 && Y <= py1 ? 1 : 0;
    }
  }
  const S = boxBlur(P, rw, rh, Math.max(1, Math.round((sh.mm * rpxmm) / 2)), 2);
  const shadow = alphaCanvas(S, rw, rh, sh.alpha);
  g.drawImage(shadow, 0, 0, W, Hh);
  shadow.width = 0;
  // the patch, its art inside the border, and the merrowed border
  g.fillStyle = spec.patch;
  roundRectPath(g, px0, py0, px1 - px0, py1 - py0, cr);
  g.fill();
  g.save();
  roundRectPath(g, px0 + bw, py0 + bw, px1 - px0 - 2 * bw, py1 - py0 - 2 * bw, Math.max(0, cr - bw));
  g.clip();
  drawArt(g, art, box);
  g.restore();
  g.save();
  roundRectPath(g, px0, py0, px1 - px0, py1 - py0, cr);
  roundRectPath2(g, px0 + bw, py0 + bw, px1 - px0 - 2 * bw, py1 - py0 - 2 * bw, Math.max(0, cr - bw));
  g.fillStyle = spec.border;
  g.fill("evenodd");
  g.clip("evenodd");
  // the wraps of the merrow stitch: slanted darker lines across the border
  g.strokeStyle = "rgba(0,0,0,0.22)";
  g.lineWidth = Math.max(1, 0.25 * pxmm);
  const step = R.ropePitch * pxmm;
  for (let t = -Hh; t < W + Hh; t += step) {
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t + Hh * 0.6, Hh);
    g.stroke();
  }
  g.restore();
  // relief
  const { A } = artFields(z, art, box);
  const H = new Float32Array(rw * rh);
  const wp = Math.max(R.weavePitch * rpxmm, MIN_PERIOD_PX);
  const ropeP = Math.max(R.ropePitch * rpxmm, MIN_PERIOD_PX);
  const x0 = px0 * s, x1 = px1 * s, y0 = py0 * s, y1 = py1 * s;
  const crr = cr * s;
  const bwr = bw * s;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const dIn = roundedRectInside(x + 0.5, y + 0.5, x0, y0, x1, y1, crr);
      if (dIn <= 0) continue;
      const dmm = dIn / rpxmm;
      let h = R.base * roundEdge(dmm / R.bevel);
      if (dIn < bwr) {
        const across = dIn / bwr;
        const along = Math.min(x - x0, x1 - x) < Math.min(y - y0, y1 - y) ? y : x;
        const wrap = 0.75 + 0.25 * Math.cos(2 * Math.PI * (along / ropeP + across * 0.6));
        h += R.rope * Math.sqrt(Math.max(0, 1 - (2 * across - 1) ** 2)) * wrap;
      } else {
        const inArt = A[i] > 0.5;
        const weave = inArt
          ? 0.5 + 0.5 * Math.cos((2 * Math.PI * y) / wp)
          : (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / wp)) * (0.5 + 0.5 * Math.cos((2 * Math.PI * y) / wp));
        h += R.weaveDepth * weave + (inArt ? 0.05 : 0);
      }
      H[i] = h;
    }
  }
  return { color, normals: normalsCanvas(H, rw, rh, rpxmm, z.cutout) };
}

function roundRectPath2(g, x, y, w, h, r) {
  // a second sub-path on the current path (roundRectPath begins a new one)
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Distance (px) inside a rounded rectangle; <= 0 outside. */
function roundedRectInside(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hx;
  const qy = Math.abs(y - cy) - hy;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return -outside;
}

function wovenLabel(z, art, box, spec) {
  const R = METHODS.woven_label.relief;
  const { rw, rh, rpxmm } = z;
  const W = z.rect.w;
  const Hh = z.rect.h;
  const color = canvas(W, Hh);
  const g = color.getContext("2d");
  g.fillStyle = spec.ground;
  g.fillRect(0, 0, W, Hh);
  drawArt(g, art, box);
  // the folded, sewn ends read as a slightly darker band
  const fold = R.fold * z.pxmm;
  g.fillStyle = "rgba(0,0,0,0.08)";
  g.fillRect(0, 0, fold, Hh);
  g.fillRect(W - fold, 0, fold, Hh);
  const { A } = artFields(z, art, box);
  const H = new Float32Array(rw * rh);
  const wp = Math.max(R.weavePitch * rpxmm, MIN_PERIOD_PX);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const xm = (x + 0.5) / rpxmm;
      const ym = (y + 0.5) / rpxmm;
      const wm = rw / rpxmm;
      const hm = rh / rpxmm;
      const edge = Math.min(xm, wm - xm, ym, hm - ym);
      let h = 0.3 * roundEdge(edge / R.bevel);
      const inArt = A[i] > 0.5;
      h += R.weaveDepth * (inArt
        ? 0.5 + 0.5 * Math.cos((2 * Math.PI * y) / wp)
        : (0.5 + 0.5 * Math.cos((2 * Math.PI * (x + y)) / wp)) * (0.5 + 0.5 * Math.cos((2 * Math.PI * (x - y)) / wp)));
      if (inArt) h += 0.04;
      const end = Math.min(xm, wm - xm);
      h -= R.foldDepth * Math.exp(-(((end - R.fold) / 0.35) ** 2));
      if (end < R.fold) h += 0.12;
      H[i] = h;
    }
  }
  return { color, normals: normalsCanvas(H, rw, rh, rpxmm) };
}

/**
 * How far inside its rect a method fits the art (px): the patch (plate or woven
 * border) round the art must itself stay inside the max imprint, and a label's
 * art keeps 0.1 in off its edges.
 */
export function artInset(method, pxPerInch) {
  const pxmm = pxPerInch / MM_PER_IN;
  const R = METHODS[method]?.relief ?? {};
  if (method === "pvc_patch" || method === "silicon_patch") return (R.dilate + 0.3) * pxmm;
  if (method === "woven_patch") return (R.border + R.margin + 0.3) * pxmm;
  if (method === "woven_label") return R.inset * pxmm;
  return 0;
}

const BUILDERS = {
  embroidery,
  pvc_patch: plateMethod("pvc_patch"),
  silicon_patch: plateMethod("silicon_patch"),
  woven_patch: wovenPatch,
  woven_label: wovenLabel,
};

/**
 * One piece of a woven label, for a live sprite: wovenLabel draws the whole
 * label (its ground, its folded ends), which belongs to the zone's rest layer,
 * so the piece is only its art and the art's own weave, raised as wovenLabel
 * raises it over the ground.
 */
function wovenLabelPiece(z, art, box) {
  const R = METHODS.woven_label.relief;
  const { rw, rh, rpxmm } = z;
  const color = canvas(z.rect.w, z.rect.h);
  drawArt(color.getContext("2d"), art, box);
  const { A } = artFields(z, art, box);
  const H = new Float32Array(rw * rh);
  const wp = Math.max(R.weavePitch * rpxmm, MIN_PERIOD_PX);
  for (let y = 0; y < rh; y++) {
    const rib = R.weaveDepth * (0.5 + 0.5 * Math.cos((2 * Math.PI * y) / wp)) + 0.04;
    for (let x = 0; x < rw; x++) if (A[y * rw + x] > 0.5) H[y * rw + x] = rib;
  }
  return { color, normals: normalsCanvas(H, rw, rh, rpxmm, z.cutout) };
}

/**
 * How far (mm) a method's look reaches past the art: its shadow, and a patch's
 * plate or border (the plate's shadow also drops 0.6 mm), plus 0.5 mm for the
 * relief's edge slope. A sprite is padded by this, so nothing it draws is cut.
 */
function spriteMarginMm(method) {
  const M = METHODS[method];
  const sh = M?.shadow?.mm ?? 0;
  if (method === "pvc_patch" || method === "silicon_patch") return M.relief.dilate + sh + 0.6 + 0.5;
  if (method === "woven_patch") return M.relief.border + M.relief.margin + sh + 0.5;
  if (method === "woven_label") return 0.5;
  return sh + 0.5;
}

// ---- Zone frames and live sprites -----------------------------------------------------
/**
 * A piece's look on its own (createHatLook's buildSprite): `w` x `h` its size
 * in die px (sprite px), `pad` the die px round the art; `color` drawn at the
 * look's textureScale (w x h canvas px at 1) and `normals` at RELIEF_SCALE of
 * that. A frame draws each over the w x h box, whatever its resolution.
 * @typedef {{ color: HTMLCanvasElement, normals: HTMLCanvasElement, w: number, h: number, pad: number }} HatSprite
 */
/**
 * The part of the die a zone's own canvases cover, and how its material's
 * samplers reach it. The area is `rect` (a spot's AREA; its CAP, maxImprint,
 * may be smaller: it is the editor's to hold a piece to, not this); the
 * canvases add BLEED_MM round it, clamped to the frame, because the overlay
 * mesh runs past the rect and a clamped sampler repeats the canvas's edge
 * texel there. Returns die px (x0, y0, w, h), relief px (rx0, ry0, rw, rh), the
 * canvases' own size in canvas px (cw x ch for art, rcw x rch for relief:
 * that region times `textureScale`, rounded up, so each covers its region and
 * a hair more), and per canvas the sampler's `scale` and `offset` ({ u, v }:
 * uv' = offset + scale * uv) and `draw`, the canvas transform [a, b, c, d, e,
 * f] taking die px (relief px for relief) to the canvas upside down, as
 * three.js's flipY upload wants: a frame texel (u, v) then reads canvas pixel
 * (s * cw, (1 - t) * ch). At textureScale 1, cw = w and rcw = rw.
 *
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ stage: { width: number, height: number }, pxPerInch: number }} die
 * @param {{ reliefScale?: number, bleedMm?: number, textureScale?: number }} [opts]
 */
export function zoneFrame(rect, die, { reliefScale = RELIEF_SCALE, bleedMm = BLEED_MM, textureScale = 1 } = {}) {
  const T = textureScale > 0 && Number.isFinite(textureScale) ? textureScale : 1;
  const W = die.stage.width;
  const H = die.stage.height;
  const bleed = (bleedMm * die.pxPerInch) / MM_PER_IN;
  const x0 = Math.max(0, Math.floor(rect.x - bleed));
  const y0 = Math.max(0, Math.floor(rect.y - bleed));
  const x1 = Math.min(W, Math.ceil(rect.x + rect.w + bleed));
  const y1 = Math.min(H, Math.ceil(rect.y + rect.h + bleed));
  // relief px of die px x are x * reliefScale, everywhere (zoneGeom's rounding included)
  const RW = W * reliefScale;
  const RH = H * reliefScale;
  const rx0 = Math.floor(x0 * reliefScale);
  const ry0 = Math.floor(y0 * reliefScale);
  const rx1 = Math.min(Math.ceil(RW), Math.ceil(x1 * reliefScale));
  const ry1 = Math.min(Math.ceil(RH), Math.ceil(y1 * reliefScale));
  const w = x1 - x0;
  const h = y1 - y0;
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  // canvas px: each region at T, rounded up (the 1e-9 keeps T = 1 exact)
  const px = (n) => Math.max(1, Math.ceil(n * T - 1e-9));
  const cw = px(w);
  const ch = px(h);
  const rcw = px(rw);
  const rch = px(rh);
  return {
    rect,
    x0, y0, w, h,
    rx0, ry0, rw, rh,
    cw, ch, rcw, rch,
    textureScale: T,
    art: { scale: { u: (W * T) / cw, v: (H * T) / ch }, offset: { u: (-x0 * T) / cw, v: (-y0 * T) / ch }, draw: [T, 0, 0, -T, -x0 * T, y0 * T + ch] },
    relief: { scale: { u: (RW * T) / rcw, v: (RH * T) / rch }, offset: { u: (-rx0 * T) / rcw, v: (-ry0 * T) / rch }, draw: [T, 0, 0, -T, -rx0 * T, ry0 * T + rch] },
  };
}

/**
 * The liveFrame matrix for a sprite (buildSprite) whose centre, which is its
 * art's centre, sits at die px (x, y), turned `angle` radians (clockwise on the
 * die, y down, as a canvas turns) and scaled by `scale` (1: sprite px are die
 * px). Written into `out`, so a drag can reuse one array a frame.
 *
 * @param {{ w: number, h: number }} sprite
 * @param {{ x: number, y: number, angle?: number, scale?: number }} place
 * @param {number[]} [out]
 * @returns {number[]}
 */
export function pieceMatrix(sprite, { x, y, angle = 0, scale = 1 }, out = [1, 0, 0, 1, 0, 0]) {
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  const hx = sprite.w / 2;
  const hy = sprite.h / 2;
  out[0] = c;
  out[1] = s;
  out[2] = -s;
  out[3] = c;
  out[4] = x - (c * hx - s * hy);
  out[5] = y - (s * hx + c * hy);
  return out;
}

// ---- Camera views ----------------------------------------------------------------------
const F1_TO_GLTF = (p) => [p[1] / 1000, p[2] / 1000, p[0] / 1000];

function zoneList(zones) {
  if (!zones) return [];
  const z = zones.zones ?? zones;
  if (Array.isArray(z)) return z;
  return Object.entries(z).map(([id, v]) => ({ id, ...v }));
}

/** A zone's placement on the model (zones_no7.json, F1 mm), read leniently. */
export function zonePlacement(zones, id) {
  const z = zoneList(zones).find((x) => x.id === id);
  if (!z) return null;
  const c = z.centre ?? z.center ?? z.centre_mm ?? z.center_mm ?? z.point;
  const n = z.normal ?? z.n;
  const size = z.size_mm ?? z.sizeMm ?? z.size;
  if (!Array.isArray(c) || !Array.isArray(n)) return null;
  const sz = Array.isArray(size) ? size : [size?.w ?? 50, size?.h ?? 30];
  return { c, n, size: sz, facing: z.facing ?? (id.startsWith("label") ? "in" : "out") };
}

export const GENERIC_VIEWS = {
  front: { orbit: "0deg 76deg auto", target: "auto auto auto" },
  left: { orbit: "90deg 76deg auto", target: "auto auto auto" },
  right: { orbit: "-90deg 76deg auto", target: "auto auto auto" },
  back: { orbit: "180deg 72deg auto", target: "auto auto auto" },
  label: { orbit: "10deg 148deg auto", target: "auto auto auto" },
  whole: { orbit: "28deg 74deg auto", target: "auto auto auto" },
};
export const FIELD_OF_VIEW = 24;

/**
 * The camera for a spot: on the zone's centre, along its normal (outside zones
 * from a little above; the label from below, through the hat's opening), far
 * enough back to frame the zone with the hat round it.
 */
export function viewFor(spot, { zones, labelShape = "tall" } = {}) {
  if (spot === "whole") return GENERIC_VIEWS.whole;
  const zid = spot === "label" ? LABEL_ZONE[labelShape] ?? "label_tall" : spot;
  const p = zonePlacement(zones, zid);
  if (!p) return GENERIC_VIEWS[spot] ?? GENERIC_VIEWS.whole;
  const c = F1_TO_GLTF(p.c);
  let d = F1_TO_GLTF(p.n).map((x) => x * 1000);
  d = p.facing === "in" ? [d[0], d[1] - 1.25, d[2]] : [d[0], d[1] + 0.22, d[2]];
  const l = Math.hypot(...d);
  d = d.map((x) => x / l);
  const theta = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
  const phi = (Math.acos(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI;
  const span = Math.max(...p.size) / 1000;
  const k = p.facing === "in" ? 4.6 : 5.2;
  const r = Math.max(0.2, (k * span * 24) / FIELD_OF_VIEW);
  return {
    orbit: `${theta.toFixed(2)}deg ${phi.toFixed(2)}deg ${r.toFixed(3)}m`,
    target: `${c[0].toFixed(4)}m ${c[1].toFixed(4)}m ${c[2].toFixed(4)}m`,
  };
}

// ---- The look ----------------------------------------------------------------------------
/**
 * Binds the hat's look to a <model-viewer> whose src is the hat. Returns the
 * controller: setParts / setColors, setStageArt, setSpot, setLabel, view,
 * paintNow, state, dispose, and the live edit below. Paints on every model load
 * (then calls onReady); art, method and label changes repaint after
 * PAINT_DEBOUNCE_MS, or at once with paintNow; colours are factors only, so
 * they never repaint. A paint draws and uploads only the zones whose layer
 * changed: its art (a stage crop by its content, so new stage art rebuilds only
 * the spots it changed), method, patch, border, or the label's shape or ground.
 *
 * `die` is the die the model's print UVs are (src/lib/hat/hat-config.js
 * HAT_NO_7_DIE: stage, pxPerInch, zones with rect and maxImprint). `zones` are
 * the zones' placements on the model (hat-no7-placements.json), which the camera
 * views are aimed by. `tagLogo` overrides TAG_LOGO. `defaultColor` is what a
 * part shows until the design colours it. `partFollows`, `neverOwn` and
 * `plasticParts` are the hat style's part rules (resolvePartColors; a plastic
 * part gets no sheen tint), PART_FOLLOWS, NEVER_OWN and none when not given.
 *
 * The live edit, for a piece dragged on the hat itself (each zone on its own):
 * - buildSprite(zoneId, art, { method?, scale? }) -> { color, normals, w, h, pad }
 *   or null: the piece's look alone (the zone's method, or `method`), on a
 *   canvas just big enough for `art` plus `pad` px all round for what the
 *   method draws past it, so the sprite's centre is the art's. Sprite px are
 *   die px when `scale` (die px per art px, default 1) is right; `normals` is
 *   the same at RELIEF_SCALE. The one slow call; the last SPRITE_CACHE sprites
 *   are kept, by art canvas, method, scale, patch and border (so art drawn
 *   again must come as a new canvas).
 * - beginLive(zoneId, { rest }) -> boolean: `rest` is the zone's art without the
 *   moving piece (a canvas, die px, its (0, 0) at the zone rect's corner) or
 *   null; its layer is built once, here. False when the zone is not on the hat
 *   or is the label shape not chosen. The hat shows its committed art until the
 *   first frame.
 * - liveFrame(zoneId, sprite, m) -> boolean: one frame. `m` ([a, b, c, d, e, f],
 *   canvas setTransform order) takes sprite px to die px (pieceMatrix makes
 *   one). The zone's canvases become its rest layer plus the sprite under `m`,
 *   clipped to the zone's rect (its AREA), and only they upload. At most once a
 *   frame (an rAF): model-viewer uploads at its next render, whatever came
 *   between.
 * - endLive(zoneId, { now?, changed?, sprite?, m? }): the drag is over. With
 *   `sprite` and `m` its last frame is drawn first at the pose it came to rest
 *   at (the confined one, not the gesture's overshoot past the edge). That
 *   frame is held, so the piece never flashes back, until the result is handed
 *   over: the next setStageArt, or setSpot with art for its spot, whatever its
 *   content (an identical one too), or a change to the zone's committed layer
 *   (its method, say). Hand the result over after this. A hold no handover
 *   releases ends after HOLD_MAX_MS, so the exact rebuild always runs. With
 *   `now` (the edit was cancelled, or its result is already in) the committed
 *   layer shows at once; with `changed: false` (the gesture left the piece
 *   where it was) too, unless an earlier drag's result is still to come. A
 *   press that never drew leaves the zone as it was, a hold included.
 *
 * What a frame costs: today's front zone's canvases are 980 x 530 (art, 2.1 MB
 * RGBA) and 490 x 265 (relief, 0.5 MB); a side's 480 x 380 and 240 x 190
 * (0.9 MB both). On each: a clear or a blit of the rest, one clipped,
 * transformed draw of the sprite. No pixel reads, no builder, no allocation.
 * Then that pair uploads (with its mipmaps): about 2.6 MB for the front,
 * against 10.1 MB for the one whole-die pair (1560 x 1296 + 780 x 648) every
 * change used to upload. A sprite's relief turns with it but its normals are
 * not turned, so during a turn its light turns too, until the build after the
 * release; a move is exact.
 *
 * `textureScale` (default 1, at most 1) draws every zone's canvases, the
 * layers built for them, the stage's crops and the live sprites at that
 * fraction of die px: the rebuilt model's front island is about 1800 x 1000 die
 * px (7.2 MB of art canvas at 1, 2.6 MB at a phone's 0.6), and a frame's upload
 * and every build shrink with its square. The method looks are built at that
 * resolution with their sizes in mm (so they stay true to mm), except that a
 * stitch texture finer than MIN_PERIOD_PX of its relief canvas is drawn at
 * that period, which at 0.6 is about 1.1 mm.
 *
 * @param {HTMLElement} mv
 * @param {{ die: object, zones?: object, tagLogo?: object, defaultColor?: string, textureScale?: number,
 *   partFollows?: Record<string, string>, neverOwn?: Iterable<string>, plasticParts?: Iterable<string>,
 *   onReady?: () => void, onMeasure?: (spot: string, m: object | null) => void }} opts
 */
export function createHatLook(
  mv,
  { die, zones = null, tagLogo = null, defaultColor = DEFAULT_COLOR, textureScale = 1, partFollows, neverOwn, plasticParts, onReady, onMeasure } = {},
) {
  const TL = { ...TAG_LOGO, ...(tagLogo ?? {}), contrast: { ...TAG_LOGO.contrast, ...(tagLogo?.contrast ?? {}) } };
  // the style's part rules (read when used, so a lab that patches PART_FOLLOWS still sees its patch)
  const rules = { follows: partFollows ?? PART_FOLLOWS, neverOwn: new Set(neverOwn ?? NEVER_OWN) };
  const plastic = new Set(plasticParts ?? []);
  const W = die.stage.width;
  const H = die.stage.height;
  const ppi = die.pxPerInch;
  const pxmm = ppi / MM_PER_IN;
  // canvas px a die px, for every zone canvas, layer, crop and sprite
  const T = Number.isFinite(textureScale) && textureScale > 0 ? Math.min(1, Math.max(0.25, textureScale)) : 1;
  const NONE = "none";
  const reduced = () => window.matchMedia?.(REDUCED_MOTION).matches;
  const state = {
    // the design's part colours ({ crown_FL: "#rrggbb", ... }): a part not in it shows its default
    colors: {},
    spots: Object.fromEntries(
      SPOTS.map((s) => [s.id, { art: null, box: null, rev: 0, method: s.id === "label" ? "woven_label" : "embroidery", patch: "#2A2D33", border: "#F1F0EB" }]),
    ),
    label: { shape: "tall", ground: "#F1F0EB" },
    tagLogo: null, // the strap tag logo's current colour (hex), set with the strap colour
  };
  // Zone id -> its own canvases and textures on the loaded model: { zone, f
  // (zoneFrame), art, relief, g, rg, key (the layer its canvases show; null:
  // not a committed one), live, hold (a drag's last frame waiting for its
  // result), holdKey (the committed layer when it began), holdTimer }.
  const surfaces = new Map();
  // A print material with no zone on the die (a retired label shape) shows this clear pair.
  let blank = null;
  let timer = 0;
  let frame = 0;
  // Zone id -> its last built layer, by layer key.
  const cache = new Map();
  // The stage's art cut along its zones (setStageArt): zone id -> { art, box, hash } | null.
  const crops = new Map();
  // Live sprites, least recently used first, keyed with an id per art canvas.
  const sprites = new Map();
  const canvasIds = new WeakMap();
  let lastCanvasId = 0;

  const material = (name) => mv.model?.getMaterialByName?.(name) ?? mv.model?.materials.find((m) => m.name === name) ?? null;

  // iOS keeps a canvas's memory until its size is zeroed
  function zeroLayer(l) {
    l.color.width = 0;
    l.normals.width = 0;
  }

  function dropLive(s) {
    if (!s.live) return;
    s.live.restArt.width = 0;
    s.live.restRelief.width = 0;
    s.live = null;
  }

  function dropSurfaces() {
    for (const s of surfaces.values()) {
      release(s);
      dropLive(s);
      s.art.source.element.width = 0;
      s.relief.source.element.width = 0;
    }
    surfaces.clear();
    if (blank) {
      blank.art.source.element.width = 0;
      blank.relief.source.element.width = 0;
      blank = null;
    }
  }

  /** A canvas texture of a size it keeps: three.js allocates a texture at its first upload's size. */
  function canvasTexture(w, h) {
    const t = mv.createCanvasTexture();
    t.source.element.width = w;
    t.source.element.height = h;
    return t;
  }

  /**
   * A print material's slots onto its own pair, then (setTexture having reset
   * it to the slot's own) the sampler transform onto the zone's sub-rect,
   * clamped: model-viewer's canvas textures repeat, which would tile the
   * sub-canvas across the frame.
   */
  function bind(m, art, relief, zf) {
    m.pbrMetallicRoughness.baseColorTexture.setTexture(art);
    m.sheenColorTexture?.setTexture(art);
    m.normalTexture?.setTexture(relief);
    if (!zf) return;
    for (const [t, x] of [
      [art, zf.art],
      [relief, zf.relief],
    ]) {
      t.sampler.setWrapS(CLAMP_TO_EDGE);
      t.sampler.setWrapT(CLAMP_TO_EDGE);
      t.sampler.setScale(x.scale);
      t.sampler.setOffset(x.offset);
    }
  }

  function onLoad() {
    dropSurfaces();
    for (const l of cache.values()) zeroLayer(l);
    cache.clear();
    for (const name of PRINT_MATERIALS) {
      const m = material(name);
      if (!m) continue;
      const zone = die.zones.find((z) => ZONE_MATERIAL[z.id] === name);
      if (zone) {
        const f = zoneFrame(zone.rect, die, { textureScale: T });
        const art = canvasTexture(f.cw, f.ch);
        const relief = canvasTexture(f.rcw, f.rch);
        bind(m, art, relief, f);
        surfaces.set(zone.id, {
          zone, f, art, relief,
          g: art.source.element.getContext("2d"),
          rg: relief.source.element.getContext("2d"),
          key: null, live: null, hold: false, holdKey: null, holdTimer: 0,
        });
      } else {
        if (!blank) {
          blank = { art: canvasTexture(1, 1), relief: canvasTexture(1, 1) };
          const rg = blank.relief.source.element.getContext("2d");
          rg.fillStyle = FLAT_NORMAL;
          rg.fillRect(0, 0, 1, 1);
        }
        bind(m, blank.art, blank.relief, null);
      }
      const want = name.startsWith("print_label") ? "MASK" : "BLEND";
      if (m.getAlphaMode() !== want) m.setAlphaMode(want);
    }
    applyColors();
    applyLooks();
    paintNow();
    onReady?.();
  }

  const partColor = (id) => resolvePartColors(state.colors, [id], defaultColor, rules)[id];

  function applyColors() {
    if (!mv.model) return;
    const parts = mv.model.materials.filter((m) => m.name.startsWith(PART_PREFIX));
    const colors = resolvePartColors(state.colors, parts.map((m) => m.name.slice(PART_PREFIX.length)), defaultColor, rules);
    for (const m of parts) {
      const id = m.name.slice(PART_PREFIX.length);
      const lin = linearRgb(colors[id]);
      m.pbrMetallicRoughness.setBaseColorFactor([...lin, 1]);
      // a plastic part is shaded as it is, with no sheen to tint
      if (plastic.has(id)) continue;
      // sheen exists only on a physical material (the model exports KHR_materials_sheen)
      try {
        m.setSheenColorFactor(lin.map((c) => c * 0.5));
      } catch {
        /* a standard material: colour only */
      }
    }
    applyTagLogo();
  }

  /** The fixed strap tag logo: never a part colour, only its contrast with the strap. */
  function applyTagLogo() {
    const m = material(TL.material);
    if (!m) return;
    const hex = tagLogoColor(partColor(TL.follows), TL.contrast);
    const lin = linearRgb(hex);
    m.pbrMetallicRoughness.setBaseColorFactor([...lin, 1]);
    try {
      m.setSheenColorFactor(lin.map((c) => c * TL.sheen));
    } catch {
      /* a standard material: colour only */
    }
    state.tagLogo = hex;
  }

  function zoneMethod(zid) {
    const spot = ZONE_SPOT[zid];
    return spot === "label" ? "woven_label" : state.spots[spot]?.method ?? "embroidery";
  }

  function applyLooks() {
    for (const [zid, name] of [...Object.entries(OVERLAY_MATERIAL), ...Object.entries(LABEL_MATERIAL).map(([k, v]) => [LABEL_ZONE[k], v])]) {
      const m = material(name);
      if (!m) continue;
      const L = METHODS[zoneMethod(zid)].look;
      m.pbrMetallicRoughness.setRoughnessFactor(L.roughness);
      m.pbrMetallicRoughness.setMetallicFactor(0);
      try {
        m.setClearcoatFactor(L.clearcoat);
        m.setClearcoatRoughnessFactor(L.clearcoatRoughness);
        m.setSheenColorFactor([L.sheen, L.sheen, L.sheen]);
        m.setSheenRoughnessFactor(L.sheenRoughness);
      } catch {
        // a model exported without the 0.001 clearcoat has a standard material:
        // roughness is all that applies
      }
    }
  }

  /**
   * A zone's geometry for a builder, at T: `rect` the colour canvas (the
   * zone's rect at T, whole px), rx..rh the relief grid (relief px at T),
   * pxmm and rpxmm their px a mm. At T = 1 the rect is the zone's own.
   */
  function zoneGeom(zone) {
    const r = zone.rect;
    const k = RELIEF_SCALE * T;
    const rx = Math.round(r.x * k);
    const ry = Math.round(r.y * k);
    const rw = Math.round((r.x + r.w) * k) - rx;
    const rh = Math.round((r.y + r.h) * k) - ry;
    const rect = T === 1 ? r : { x: r.x * T, y: r.y * T, w: Math.max(1, Math.round(r.w * T)), h: Math.max(1, Math.round(r.h * T)) };
    return { rect, rx, ry, rw, rh, pxmm: (rect.w / r.w) * pxmm, rpxmm: (rw / r.w) * pxmm };
  }

  /** A box in die px (in a zone's rect) as the builder's px for that zone's geometry. */
  function boxAt(box, z, r) {
    const sx = z.rect.w / r.w;
    const sy = z.rect.h / r.h;
    return sx === 1 && sy === 1 ? box : { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
  }

  /** A layer's relief, drawn under a frame's relief draw: its grid is relief px at T, the draw takes relief px. */
  function drawRelief(rg, layer, z) {
    rg.imageSmoothingEnabled = false;
    if (T === 1) rg.drawImage(layer.normals, z.rx, z.ry);
    else rg.drawImage(layer.normals, z.rx / T, z.ry / T, layer.normals.width / T, layer.normals.height / T);
  }

  /** A zone's art: the stage's, cut to the zone, or else the spot's own (setSpot). */
  function artFor(zone, spot) {
    if (crops.has(zone.id)) return crops.get(zone.id);
    return spot.art ? { art: spot.art, box: spot.box } : null;
  }

  /** Where the art sits in its zone's rect: as placed on the stage, or fitted (contain, centred, inset for the method). */
  function placedBox(src, rect, method) {
    if (!src) return { x: 0, y: 0, w: 0, h: 0 };
    return src.box ?? fitBox(src.art.width, src.art.height, rect, artInset(method, ppi));
  }

  const specOf = (spot) => ({ patch: spot.patch, border: spot.border, ground: state.label.ground });

  /**
   * What a zone shows, as a string, cheap to compare: NONE (no art outside, or
   * the label shape not chosen), else its art (a stage crop by its content
   * hash, the spot's own art by its revision), method, patch, border and, on
   * the label, its ground.
   */
  function layerKey(zone) {
    const spotId = ZONE_SPOT[zone.id];
    if (!spotId) return NONE;
    const spot = state.spots[spotId];
    const isLabel = spotId === "label";
    if (isLabel && LABEL_ZONE[state.label.shape] !== zone.id) return NONE;
    const src = artFor(zone, spot);
    if (!isLabel && !src) return NONE;
    const art = !src ? "-" : crops.has(zone.id) ? `c${src.hash}` : `s${spot.rev}`;
    return [art, zoneMethod(zone.id), spot.patch, spot.border, isLabel ? state.label.ground : ""].join("|");
  }

  /** A zone's layer for its key: built (the slow part) only when the key is new. */
  function zoneLayer(zone, key) {
    if (key === NONE) return null;
    const hit = cache.get(zone.id);
    if (hit?.key === key) return hit;
    if (hit) zeroLayer(hit);
    const spot = state.spots[ZONE_SPOT[zone.id]];
    const src = artFor(zone, spot);
    const method = zoneMethod(zone.id);
    const z = zoneGeom(zone);
    const box = placedBox(src, zone.rect, method);
    const out = BUILDERS[method](z, src?.art ?? null, boxAt(box, z, zone.rect), specOf(spot));
    const layer = { key, ...out, box, z };
    cache.set(zone.id, layer);
    return layer;
  }

  function measure() {
    if (!onMeasure) return;
    for (const s of SPOTS) {
      const zid = s.id === "label" ? LABEL_ZONE[state.label.shape] : s.zones[0];
      const zone = die.zones.find((z) => z.id === zid);
      const src = zone ? artFor(zone, state.spots[s.id]) : null;
      if (!zone || !src) {
        onMeasure(s.id, zone ? { w: 0, h: 0, maxW: zone.maxImprint.w, maxH: zone.maxImprint.h } : null);
        continue;
      }
      const b = placedBox(src, zone.rect, zoneMethod(zid));
      onMeasure(s.id, { w: b.w / ppi, h: b.h / ppi, maxW: zone.maxImprint.w, maxH: zone.maxImprint.h });
    }
  }

  /** One zone's committed layer (or nothing) on its own canvases, upside down; that pair uploads. */
  function paintSurface(s, key) {
    const layer = zoneLayer(s.zone, key);
    const { f, g, rg } = s;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, f.cw, f.ch);
    rg.setTransform(1, 0, 0, 1, 0, 0);
    rg.fillStyle = FLAT_NORMAL;
    rg.fillRect(0, 0, f.rcw, f.rch);
    if (layer) {
      const r = s.zone.rect;
      g.setTransform(...f.art.draw);
      g.drawImage(layer.color, r.x, r.y, r.w, r.h);
      rg.setTransform(...f.relief.draw);
      drawRelief(rg, layer, layer.z);
      g.setTransform(1, 0, 0, 1, 0, 0);
      rg.setTransform(1, 0, 0, 1, 0, 0);
    }
    s.art.source.update();
    s.relief.source.update();
    s.key = key;
  }

  /** A zone not mid-drag: its committed layer, if it changed, unless a hold still waits for a drag's result. */
  function refresh(s) {
    const key = layerKey(s.zone);
    if (s.hold) {
      // the committed layer moving on (a new method, say) ends a hold too
      if (key === s.holdKey) return;
      release(s);
    }
    if (key !== s.key) paintSurface(s, key);
  }

  /** Repaints the zones whose layer changed, each on its own pair; a live or held zone is left be. */
  function paintNow() {
    clearTimeout(timer);
    timer = 0;
    if (!surfaces.size || !mv.model) return;
    for (const s of surfaces.values()) if (!s.live) refresh(s);
    measure();
  }

  /**
   * The zone keeps the frame its canvases show (s.key is null) until the
   * drag's result is handed over (setStageArt, a spot's art), its committed
   * layer moves on, or HOLD_MAX_MS passes, whichever is first.
   */
  function hold(s) {
    clearTimeout(s.holdTimer);
    s.hold = true;
    s.holdKey = layerKey(s.zone);
    s.holdTimer = setTimeout(() => {
      s.holdTimer = 0;
      release(s);
      // a zone mid-drag is its endLive's to repaint
      if (!s.live) paintNow();
    }, HOLD_MAX_MS);
  }

  function release(s) {
    clearTimeout(s.holdTimer);
    s.holdTimer = 0;
    s.hold = false;
  }

  function schedulePaint() {
    clearTimeout(timer);
    timer = setTimeout(paintNow, PAINT_DEBOUNCE_MS);
  }

  /**
   * One zone's art cut from the stage's art layer (any resolution of the die's
   * frame), at T; its box is die px in the zone's rect, as placedBox wants.
   */
  function cropZone(stage, zone) {
    const r = zone.rect;
    const sx = stage.width / W;
    const sy = stage.height / H;
    const c = canvas(r.w * T, r.h * T);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(stage, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height);
    const out = inkCrop(c);
    const kx = r.w / c.width;
    const ky = r.h / c.height;
    c.width = 0;
    if (!out || (kx === 1 && ky === 1)) return out;
    return { ...out, box: { x: out.box.x * kx, y: out.box.y * ky, w: out.box.w * kx, h: out.box.h * ky } };
  }

  function dropCrop(zid) {
    const c = crops.get(zid);
    // iOS keeps a canvas's memory until its size is zeroed
    if (c?.art) c.art.width = 0;
    crops.delete(zid);
  }

  function setView(spot) {
    const v = viewFor(spot, { zones, labelShape: state.label.shape });
    mv.cameraTarget = v.target;
    mv.cameraOrbit = v.orbit;
    mv.fieldOfView = `${FIELD_OF_VIEW}deg`;
    if (reduced()) mv.jumpCameraToGoal();
  }

  // ---- Live edit (see above) ----
  /**
   * @param {string} zoneId
   * @param {HTMLCanvasElement | null | undefined} art
   * @param {{ method?: string, scale?: number }} [opts]
   * @returns {HatSprite | null}
   */
  function buildSprite(zoneId, art, { method, scale = 1 } = {}) {
    const spotId = die.zones.some((z) => z.id === zoneId) ? ZONE_SPOT[zoneId] : null;
    if (!spotId || !art?.width || !art.height) return null;
    const spot = state.spots[spotId];
    const m = METHODS[method] ? method : zoneMethod(zoneId);
    let id = canvasIds.get(art);
    if (!id) canvasIds.set(art, (id = ++lastCanvasId));
    const key = [id, m, scale, spot.patch, spot.border].join("|");
    const hit = sprites.get(key);
    if (hit) {
      sprites.delete(key);
      sprites.set(key, hit);
      return hit;
    }
    const aw = Math.max(1, Math.round(art.width * scale));
    const ah = Math.max(1, Math.round(art.height * scale));
    const pad = Math.ceil(spriteMarginMm(m) * pxmm);
    const w = aw + 2 * pad;
    const h = ah + 2 * pad;
    // built at T: a canvas of cw x ch for the w x h die px box
    const cw = Math.max(1, Math.round(w * T));
    const ch = Math.max(1, Math.round(h * T));
    const kx = cw / w;
    const ky = ch / h;
    const rw = Math.max(1, Math.round(w * RELIEF_SCALE * T));
    const rh = Math.max(1, Math.round(h * RELIEF_SCALE * T));
    const z = { rect: { x: 0, y: 0, w: cw, h: ch }, rx: 0, ry: 0, rw, rh, pxmm: pxmm * kx, rpxmm: (rw / w) * pxmm, cutout: true };
    const build = m === "woven_label" ? wovenLabelPiece : BUILDERS[m];
    const out = build(z, art, { x: pad * kx, y: pad * ky, w: aw * kx, h: ah * ky }, specOf(spot));
    const sprite = { color: out.color, normals: out.normals, w, h, pad };
    sprites.set(key, sprite);
    for (const [k, old] of sprites) {
      if (sprites.size <= SPRITE_CACHE) break;
      sprites.delete(k);
      zeroLayer(old);
    }
    return sprite;
  }

  /**
   * @param {string} zoneId
   * @param {{ rest?: HTMLCanvasElement | null }} [opts]
   * @returns {boolean}
   */
  function beginLive(zoneId, { rest = null } = {}) {
    const s = surfaces.get(zoneId);
    const spotId = ZONE_SPOT[zoneId];
    if (!s || !spotId) return false;
    if (spotId === "label" && LABEL_ZONE[state.label.shape] !== zoneId) return false;
    dropLive(s);
    const { f, zone } = s;
    const r = zone.rect;
    const z = zoneGeom(zone);
    const method = zoneMethod(zoneId);
    const piece = rest?.width && rest.height ? rest : null;
    // the zone without the piece, as a paint would build it (a label's ground
    // and folds even with no art), composed upside down once, here
    const layer = piece || method === "woven_label"
      ? BUILDERS[method](z, piece, piece ? boxAt({ x: 0, y: 0, w: piece.width, h: piece.height }, z, r) : { x: 0, y: 0, w: 0, h: 0 }, specOf(state.spots[spotId]))
      : null;
    const restArt = canvas(f.cw, f.ch);
    const restRelief = canvas(f.rcw, f.rch);
    const rg = restRelief.getContext("2d");
    rg.fillStyle = FLAT_NORMAL;
    rg.fillRect(0, 0, f.rcw, f.rch);
    if (layer) {
      const g = restArt.getContext("2d");
      g.setTransform(...f.art.draw);
      g.drawImage(layer.color, r.x, r.y, r.w, r.h);
      rg.setTransform(...f.relief.draw);
      drawRelief(rg, layer, z);
      zeroLayer(layer);
    }
    // A hold from the drag before stays (paintNow leaves a live zone be): if
    // this press never draws, that frame is still what the zone shows, and
    // its result may still be on its way. The clips are die px and relief px.
    s.live = { restArt, restRelief, rect: r, reliefRect: { x: z.rx / T, y: z.ry / T, w: z.rw / T, h: z.rh / T }, drawn: false };
    return true;
  }

  /**
   * The per-frame path: canvas calls on numbers only.
   *
   * @param {string} zoneId
   * @param {HatSprite | null | undefined} sprite
   * @param {ArrayLike<number>} m
   * @returns {boolean}
   */
  function liveFrame(zoneId, sprite, m) {
    const s = surfaces.get(zoneId);
    const L = s?.live;
    if (!L || !sprite?.color.width || !sprite.normals.width) return false;
    const { f, g, rg } = s;
    const r = L.rect;
    const rr = L.reliefRect;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, f.cw, f.ch);
    g.drawImage(L.restArt, 0, 0);
    g.save();
    // die px to the canvas, upside down: the zone's own draw, as paintSurface's
    g.setTransform(...f.art.draw);
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "low";
    // over the sprite's w x h px, whatever the resolution it was built at
    g.drawImage(sprite.color, 0, 0, sprite.w, sprite.h);
    g.restore();
    // the rest's relief is opaque: drawn, it is the whole canvas
    rg.setTransform(1, 0, 0, 1, 0, 0);
    rg.drawImage(L.restRelief, 0, 0);
    rg.save();
    rg.setTransform(...f.relief.draw);
    rg.beginPath();
    rg.rect(rr.x, rr.y, rr.w, rr.h);
    rg.clip();
    // relief px <- die px <- sprite px <- the sprite's relief px
    rg.transform(RELIEF_SCALE, 0, 0, RELIEF_SCALE, 0, 0);
    rg.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    rg.transform(sprite.w / sprite.normals.width, 0, 0, sprite.h / sprite.normals.height, 0, 0);
    rg.imageSmoothingEnabled = true;
    rg.imageSmoothingQuality = "low";
    rg.drawImage(sprite.normals, 0, 0);
    rg.restore();
    s.art.source.update();
    s.relief.source.update();
    L.drawn = true;
    return true;
  }

  /**
   * @param {string} zoneId
   * @param {{ now?: boolean, changed?: boolean, sprite?: HatSprite | null, m?: ArrayLike<number> | null }} [opts]
   */
  function endLive(zoneId, { now = false, changed = true, sprite = null, m = null } = {}) {
    const s = surfaces.get(zoneId);
    if (!s?.live) return;
    // where the piece came to rest, so a hold never shows it pushed past the edge
    if (sprite && m) liveFrame(zoneId, sprite, m);
    const drawn = s.live.drawn;
    dropLive(s);
    if (!drawn) {
      // the canvases show what they did before the press, a hold included;
      // only what changed meanwhile (paintNow left this zone be) repaints
      refresh(s);
      return;
    }
    s.key = null;
    // unchanged, the committed layer is the result, unless an earlier drag's
    // is still to come (it would show that drag's piece where it was before)
    if (now || (!changed && !s.hold)) {
      release(s);
      paintSurface(s, layerKey(s.zone));
      return;
    }
    hold(s);
  }

  // Bound last: a model already loaded paints at once, and onLoad reaches every
  // helper above (a `const` one called before its line throws).
  mv.addEventListener("load", onLoad);
  if (mv.loaded && mv.model) onLoad();

  return {
    state,
    /** The design's part colours, all of them: a part left out shows its default. Applied at once. */
    setParts(parts) {
      state.colors = { ...(parts ?? {}) };
      cancelAnimationFrame(frame);
      frame = 0;
      applyColors();
    },
    /** Some part colours (null clears one). A colour drag sends many: at most one update a frame. */
    setColors(partial) {
      for (const [id, hex] of Object.entries(partial ?? {})) {
        if (hex == null) delete state.colors[id];
        else state.colors[id] = hex;
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyColors();
      });
    },
    /**
     * The design's art: the stage's art layer in the die's frame, without its
     * ground (the designer's exportArtCanvas({ color: false })), or null for
     * none. Each spot shows what was placed inside its zone's rect, where it
     * was placed (the label, its chosen shape's). Read here, not kept. It is
     * a drag's result handed over: every held zone (endLive) rebuilds, even
     * when its crop is the same as before.
     */
    setStageArt(stage) {
      for (const zid of [...crops.keys()]) dropCrop(zid);
      if (stage) for (const zone of die.zones) if (ZONE_SPOT[zone.id]) crops.set(zone.id, cropZone(stage, zone));
      for (const s of Object.values(state.spots)) s.rev++;
      for (const s of surfaces.values()) release(s);
      schedulePaint();
    },
    /**
     * spot: front | left | right | back | label; spec: { art?, box?, method?, patch?, border? }.
     * Art set here is fitted to the zone (contain, centred) unless `box` places
     * it (px in the zone's rect), and stands in for the stage's art on this
     * spot until the next setStageArt; art is a drag's result handed over, so
     * it ends the spot's holds (endLive). Nothing changed, nothing repainted:
     * Hat3D sets every method on every paint, and that must not end a hold.
     */
    setSpot(spot, spec) {
      const s = state.spots[spot];
      if (!s) return;
      let changed = false;
      if ("art" in spec) {
        s.art = spec.art ?? null;
        s.box = spec.box ?? null;
        for (const zid of SPOTS.find((x) => x.id === spot).zones) {
          dropCrop(zid);
          const sf = surfaces.get(zid);
          if (sf) release(sf);
        }
        changed = true;
      }
      for (const k of ["method", "patch", "border"]) {
        if (k in spec && spec[k] != null && s[k] !== spec[k]) {
          s[k] = spec[k];
          changed = true;
        }
      }
      if (spot === "label") s.method = "woven_label";
      if (!changed) return;
      s.rev++;
      applyLooks();
      schedulePaint();
    },
    /** shape: none | square | tall; ground: the label's woven ground colour */
    setLabel({ shape, ground } = {}) {
      let changed = false;
      if (shape && shape !== state.label.shape) {
        state.label.shape = shape;
        changed = true;
      }
      if (ground && ground !== state.label.ground) {
        state.label.ground = ground;
        changed = true;
      }
      if (!changed) return;
      state.spots.label.rev++;
      schedulePaint();
    },
    /** The camera on a spot (front | left | right | back | label) or the whole hat ("whole"); a jump under reduced motion. */
    view: setView,
    paintNow,
    buildSprite,
    beginLive,
    liveFrame,
    endLive,
    dispose() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      mv.removeEventListener("load", onLoad);
      for (const l of cache.values()) zeroLayer(l);
      cache.clear();
      for (const sp of sprites.values()) zeroLayer(sp);
      sprites.clear();
      for (const zid of [...crops.keys()]) dropCrop(zid);
      dropSurfaces();
    },
  };
}
