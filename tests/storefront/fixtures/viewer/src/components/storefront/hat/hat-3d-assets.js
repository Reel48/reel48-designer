// Copied byte-for-byte from Reel48-Storefront src/components/storefront/hat/hat-3d-assets.js (origin/main d78d90ee) but for this line; read as text by scripts/blender/hat-no7/lab/extract_surface.mjs here, never imported.
// Each 3D hat style's files (the No. 7's and the No. 6's), and the warm-up that
// starts them downloading. The 3D dependency comes in through the can cooler's loader
// (../coozie/load-3d), the one door to it, which stays untouched: this file
// only builds on its loadViewer() and webglAvailable(). The files are keyed by
// the style's handle (src/lib/hat/hat-style-config.js), and Hat3D picks them by
// the style of the die it is given, never by the die's frame alone.
//
// The No. 7's model is built by scripts/blender/hat-no7/ (its README). It is round E1,
// the whole-panel model: logos go anywhere on the two front panels, anywhere
// on each side panel, on the back's 2.79 x 0.98 in, and on the inside label.
// Brayden signed it off on 2026-10-21 after trying it on his iPhone: "I tried
// round E1 on my iPhone and the whole-panel areas feel right. The back
// position and keeping today's largest logo sizes are fine. Go ahead with the
// designer package and the site." (The model before it, signed off at L3 the
// same morning, "The production model is perfect. Ship it to the site.", is
// what E1 was built from.) Its print UVs are on the E1 die's frame (3720 x
// 1808 at 200 px/in, scripts/blender/hat-no7/e1/die_no7.json, which the
// designer package ships as "hat-no-7-v2").
//
// The surface is the editor's map between the screen and the die
// (hat-surface.js), extracted from this very model by
// scripts/blender/hat-no7/lab/extract_surface.mjs --die e1/die_no7.json; it is
// fetched only when a spot is edited on the hat. The poster is a still of the
// hat in the default view and the default colour, for the moment before the
// 3D is ready and for browsers that can't draw it. Each name carries the first
// 8 hex of its file's SHA-256, and next.config serves /3d/ as immutable, so a
// rebuilt file is a new name; tests/hat-3d.test.ts checks each name against
// its file, and tests/hat-surface.test.ts the surface against the model. The
// studio is the can cooler's: the hat's colours were checked under it (linear
// tone mapping at hat-look.js EXPOSURE).
import { DEFAULT_HAT_STYLE } from "@/lib/hat/hat-style-config";
import { STUDIO, loadViewer, webglAvailable } from "../coozie/load-3d";
import NO_6_PLACEMENTS from "./hat-no6-placements.json";
import NO_7_PLACEMENTS from "./hat-no7-placements.json";

// The No. 7's files (the lab scripts read MODEL from this line, as written).
export const MODEL = "/3d/hats/hat-no7.dd00635f.glb";
/**
 * The die frame (px) MODEL's print UVs are on: round E1's stage. Hat3D paints
 * only a No. 7 die on this frame (another's art would land in the wrong
 * places), and tests/hat-3d.test.ts pins it to the surface and the E1 die.
 */
export const MODEL_FRAME = Object.freeze({ width: 3720, height: 1808 });
export const SURFACE = "/3d/hats/hat-no7-surface.14936a94.json";
export const POSTER = "/3d/hats/hat-no7-poster.a570b9af.webp";
/** The poster's size in pixels, for its box before it loads. */
export const POSTER_SIZE = { width: 1200, height: 900 };

/**
 * Each style's 3D files, by its handle: `model`, the `frame` its print UVs
 * are on, the editor's `surface`, the `poster` and its `posterSize`, and the
 * camera `placements` (where each die zone sits on the model: hat-look.js
 * viewFor).
 */
export const HAT_3D_FILES = Object.freeze({
  "no-7": Object.freeze({
    model: MODEL,
    frame: MODEL_FRAME,
    surface: SURFACE,
    poster: POSTER,
    posterSize: POSTER_SIZE,
    placements: NO_7_PLACEMENTS,
  }),
  // The No. 6 (S3 of its plan): Brayden signed its model off on 2026-10-24
  // ("Perfect. Dark-back the eyelets, then run the rebuild of record."); this
  // is that model with its part-colour lines cleaned up the same day (his ask:
  // "Check this area under the bill and let's clean it up a little bit. Let's
  // also go around the rest of the hat and do a color test and make sure all
  // of the lines are clearly defined and clean."), the shape unchanged. Built
  // by scripts/blender/hat-no6/ (its README). Its print UVs are on its own die's frame (die_no6.json, which the
  // designer package ships as "hat-no-6"); its surface was extracted from this
  // very model by scripts/blender/hat-no6/lab/extract_surface.mjs, and its
  // poster is a still of it in the default view and navy, as the No. 7's is.
  // Written inline, never as a `MODEL = "…"` line: the No. 7's lab scripts
  // read that one.
  "no-6": Object.freeze({
    model: "/3d/hats/hat-no6.482b4e5f.glb",
    frame: Object.freeze({ width: 3480, height: 2336 }),
    surface: "/3d/hats/hat-no6-surface.bf420096.json",
    poster: "/3d/hats/hat-no6-poster.f84213ad.webp",
    posterSize: { width: 1200, height: 900 },
    placements: NO_6_PLACEMENTS,
  }),
});

/**
 * A style's 3D files, or null for a style with none (its designer shows the
 * flat die).
 *
 * @param {{ handle: string } | null | undefined} style
 */
export function hat3DFilesOf(style) {
  return style && Object.prototype.hasOwnProperty.call(HAT_3D_FILES, style.handle) ? HAT_3D_FILES[style.handle] : null;
}

export { STUDIO, loadViewer, webglAvailable };

const warmed = new Set();
/**
 * Starts everything the hat's 3D needs downloading at once (the viewer's
 * code, the studio and the model, and with `edit` the surface the on-hat
 * editor maps by) instead of one after another as the viewer asks for them.
 * The bodies are read through so each lands whole in the HTTP cache, where
 * the viewer's own requests find it. Returns false where the 3D can't run, so
 * a caller fetches nothing for it, or for a style with no 3D files.
 *
 * @param {{ edit?: boolean, style?: { handle: string } }} [options] `edit`: a
 *   spot is about to be edited on the hat; `style`: whose files
 */
export function warmHat3D({ edit = false, style = DEFAULT_HAT_STYLE } = {}) {
  const files = hat3DFilesOf(style);
  if (!files || !webglAvailable()) return false;
  loadViewer().catch(() => {});
  for (const url of edit ? [STUDIO, files.model, files.surface] : [STUDIO, files.model]) {
    if (warmed.has(url)) continue;
    warmed.add(url);
    fetch(url)
      .then((r) => r.arrayBuffer())
      .catch(() => warmed.delete(url));
  }
  return true;
}
