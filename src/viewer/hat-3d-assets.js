// Each 3D hat style's fixed facts (the No. 7's and the No. 6's): the die frame
// its model's print UVs are on, its poster's size, and the camera placements
// (where each die zone sits on the model: hat-look.js viewFor). Keyed by the
// style's handle (core hat-style-config.js), and a host picks them by the
// style of the die it is given, never by the die's frame alone.
//
// Ported from Reel48-Storefront src/components/storefront/hat/hat-3d-assets.js
// (origin/main d78d90ee). The storefront's file named its own URLs
// (/3d/hats/...). Here the URLs are the HOST's: it serves the files
// (@reel48/designer/models/*, under whatever hashed names its build gives
// them) and passes their URLs in (hat3DFilesOf, warmHat3D).
//
// The models: the No. 7 is round E1, the whole-panel model (Brayden signed it
// off on 2026-10-21), its print UVs on the "hat-no-7-v2" die's frame. The
// No. 6 (signed off 2026-10-24) is on the "hat-no-6" die's frame. Each
// surface was extracted from its model (hat-surface.js); each poster is a
// still of the hat in the default view and navy. The studio (the HDR) is the
// can cooler's: the hats' colours were checked under it at hat-look.js EXPOSURE.
import { DEFAULT_HAT_STYLE } from "../core/hat-style-config.js";
import { warm3D, webglAvailable } from "./load-3d.js";
import NO_6_PLACEMENTS from "./hat-no6-placements.js";
import NO_7_PLACEMENTS from "./hat-no7-placements.js";

/**
 * The die frame (px) the No. 7 model's print UVs are on: round E1's stage
 * (hat-no-7-v2). A host paints only a No. 7 die on this frame (another's art
 * would land in the wrong places).
 */
export const MODEL_FRAME = Object.freeze({ width: 3720, height: 1808 });
/** The No. 7 poster's size in pixels, for its box before it loads. */
export const POSTER_SIZE = Object.freeze({ width: 1200, height: 900 });

/**
 * Each style's fixed 3D facts, by its handle: the `frame` its print UVs are
 * on, the poster's `posterSize`, and the camera `placements`. The files
 * themselves (`model`, `surface`, `poster`) are the host's URLs:
 * hat3DFilesOf adds them.
 */
export const HAT_3D_STYLES = Object.freeze({
  "no-7": Object.freeze({
    frame: MODEL_FRAME,
    posterSize: POSTER_SIZE,
    placements: NO_7_PLACEMENTS,
  }),
  "no-6": Object.freeze({
    frame: Object.freeze({ width: 3480, height: 2336 }),
    posterSize: Object.freeze({ width: 1200, height: 900 }),
    placements: NO_6_PLACEMENTS,
  }),
});

/**
 * @typedef {{ model: string, surface?: string | null, poster?: string | null }} HatFileUrls
 *   The host's URLs for one style's files: the GLB, the surface JSON (only
 *   needed to edit a spot on the hat) and the poster.
 * @typedef {{ model: string, surface: string | null, poster: string | null,
 *   frame: { width: number, height: number }, posterSize: { width: number, height: number },
 *   placements: Record<string, any> }} HatFiles
 */

/**
 * A style's 3D files: its fixed facts with the host's URLs. Null for a style
 * with no 3D (its host shows the flat die), or without a model URL.
 *
 * @param {{ handle: string } | null | undefined} style
 * @param {HatFileUrls | null | undefined} urls
 * @returns {HatFiles | null}
 */
export function hat3DFilesOf(style, urls) {
  if (!style || !Object.prototype.hasOwnProperty.call(HAT_3D_STYLES, style.handle)) return null;
  if (!urls || typeof urls.model !== "string" || !urls.model) return null;
  const fixed = HAT_3D_STYLES[/** @type {keyof typeof HAT_3D_STYLES} */ (style.handle)];
  return { ...fixed, model: urls.model, surface: urls.surface ?? null, poster: urls.poster ?? null };
}

/**
 * Whether a die can be painted on a style's model: its frame is the one the
 * model's print UVs are on. Another die's art would land in the wrong places.
 *
 * @param {{ stage?: { width: number, height: number } } | null | undefined} die
 * @param {{ frame: { width: number, height: number } } | null | undefined} files
 */
export function dieFitsModel(die, files) {
  return !!files && die?.stage?.width === files.frame.width && die?.stage?.height === files.frame.height;
}

/**
 * Starts everything the hat's 3D needs downloading at once (the studio and
 * the model, and with `edit` the surface the on-hat editor maps by) instead
 * of one after another as the viewer asks for them. Returns false where the
 * 3D can't run, and for a style with no 3D. The viewer's code is loadViewer's.
 *
 * @param {{ edit?: boolean, style?: { handle: string }, urls: HatFileUrls, environment?: string | null }} options
 * @returns {boolean}
 */
export function warmHat3D({ edit = false, style = DEFAULT_HAT_STYLE, urls, environment = null }) {
  const files = hat3DFilesOf(style, urls);
  if (!files || !webglAvailable()) return false;
  return warm3D(edit ? [environment, files.model, files.surface] : [environment, files.model]);
}
