// The can cooler in 3D, as plain functions: the customer's design wrapped on
// the sleeve exactly as the die is cut, folded and sewn, on a can they can
// turn. A view, never an editor: the flat die stays the source of truth and
// is what production gets.
//
// Pulled out of Reel48-Storefront src/components/storefront/coozie/CanCooler3D.jsx
// (origin/main d78d90ee) without React, analytics or Tailwind: its view
// settings, its texture painting (`paint`) and its picture. A host owns the
// <model-viewer> element (createModelViewer builds one), loads the viewer
// (load-3d.js loadViewer), and on the element's `load` event calls
// attachCanCoolerTexture, then paintCanCooler on every design change.
//
// The models (built by the storefront's scripts/blender/can-cooler/): a foam
// sleeve whose UVs ARE the die's stage frame, on an unbranded can. The
// sleeve's "print" and "print_seam" materials take the live design; "thread"
// takes the can cooler's colour; "magnet" is hidden by its alpha unless the
// order has one.

import { linearRgb } from "./hat-look.js";
import { PICTURE, composePicture, coverView, nextFrame } from "./picture.js";

/** The approved view (Brayden, 2026-10-10): the front, a little above eye level. */
export const CAN_COOLER_ORBITS = Object.freeze({ front: "0deg 80deg auto", back: "180deg 80deg auto" });

/**
 * The <model-viewer> attributes the can cooler is shown with. Linear tone
 * mapping at CAN_COOLER_EXPOSURE is what keeps the print's colours true under
 * the studio (the default neutral mapper pushed saturated colours 8 to 12 ΔE
 * off).
 */
export const CAN_COOLER_VIEW = Object.freeze({
  "camera-orbit": CAN_COOLER_ORBITS.front,
  "min-camera-orbit": "auto 35deg auto",
  "max-camera-orbit": "auto 150deg auto",
  "field-of-view": "13deg",
  "tone-mapping": "linear",
  "shadow-intensity": "1",
  "shadow-softness": "0.9",
});

/**
 * A number, set as the element's PROPERTY: model-viewer silently ignores an
 * exposure that is a string (it would render at 1).
 */
export const CAN_COOLER_EXPOSURE = 2.15;

/**
 * model-viewer frames a model by its ideal aspect (its widest at any turn,
 * over its height), measured per can, so a column that wide holds the can at
 * the same size; SHADOW_ROOM keeps its soft shadow whole. On a touch screen
 * only the can's own column takes the drag, so a thumb can still scroll the
 * page past it.
 */
export const CAN_COOLER_IDEAL_ASPECT = Object.freeze({ standard: 0.585, slim: 0.42 });
export const CAN_COOLER_SHADOW_ROOM = 1.15;

/** One gentle full turn the first time the 3D is seen, so it is plain that it turns. */
export const TURN_MS = 2800;
/**
 * Repaint pacing, both 3D views': the art is retaken PAINT_DEBOUNCE_MS
 * (hat-look.js, 120) after a gesture settles, and retried on these delays
 * while the stage can't hand it over (still measuring, or a line being typed
 * on it, which hides that line).
 */
export const PAINT_RETRY_MS = Object.freeze([300, 300, 600, 1000]);
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The attributes every Reel48 <model-viewer> carries, the hat's and the can
 * cooler's: turned by a drag, never zoomed, panned or tapped, no prompt, and
 * every touch is the view's.
 */
export const MODEL_VIEWER_ATTRIBUTES = Object.freeze({
  "camera-controls": "",
  "disable-zoom": "",
  "disable-pan": "",
  "disable-tap": "",
  "interaction-prompt": "none",
  "touch-action": "none",
  loading: "eager",
});

/**
 * A <model-viewer> element, built with setAttribute and child nodes only (no
 * markup, no `style` attribute), with its loading bar and pan target slotted
 * out: model-viewer's own grey bar stays a second after the model is in, and
 * its pan target is a dot outside the drag surface's touch-action, which
 * scrolled the page under a thumb. `display: block` is set through CSSOM.
 * Load the viewer (loadViewer) first, so the element upgrades.
 *
 * @param {{ src: string, environment: string, alt: string, view: Record<string, string>,
 *   exposure: number, className?: string, document?: Document }} options
 * @returns {HTMLElement}
 */
export function createModelViewer({ src, environment, alt, view, exposure, className, document: doc = globalThis.document }) {
  const mv = doc.createElement("model-viewer");
  for (const [k, v] of Object.entries({ ...MODEL_VIEWER_ATTRIBUTES, ...view })) mv.setAttribute(k, v);
  mv.setAttribute("src", src);
  mv.setAttribute("environment-image", environment);
  mv.setAttribute("alt", alt);
  if (className) mv.className = className;
  mv.style.display = "block";
  /** @type {any} */ (mv).exposure = exposure;
  for (const slot of ["progress-bar", "pan-target"]) {
    const div = doc.createElement("div");
    div.setAttribute("slot", slot);
    mv.appendChild(div);
  }
  return mv;
}

/**
 * The texture the design is painted into, made on a loaded model (the
 * element's `load` event) at the die's native size, and bound to the
 * sleeve's print materials.
 *
 * @param {any} mv the <model-viewer>, its model loaded
 * @param {{ width: number, height: number }} stage the die's native stage size
 * @returns {any} the texture (a model-viewer CanvasTexture)
 */
export function attachCanCoolerTexture(mv, { width, height }) {
  const texture = mv.createCanvasTexture();
  const canvas = texture.source.element;
  canvas.width = width;
  canvas.height = height;
  for (const m of mv.model.materials) {
    if (m.name === "print" || m.name === "print_seam") m.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
  }
  return texture;
}

/**
 * Paints the design on: the can cooler's colour, then the art over it, drawn
 * upside down (three.js uploads a canvas texture with flipY, the model's own
 * textures without). The fill also keeps the die's empty outside from
 * bleeding dark into the seams as the texture mips down. The thread is always
 * the can cooler's colour (Brayden, 2026-10-10); the magnet shows only when
 * the order has one.
 *
 * `art` is the stage's art layer at the die's native size without its ground
 * colour (DesignStage's exportArtCanvas({ color: false })): pattern, logos and
 * text, transparent elsewhere. Keep it and pass it again on a colour change:
 * a new colour is a new fill under the same art, so the can follows a colour
 * drag frame by frame. Returns false (and paints nothing) before the model
 * and the texture are there, or without art.
 *
 * @param {any} mv
 * @param {any} texture attachCanCoolerTexture's
 * @param {{ color: string, art: HTMLCanvasElement | ImageBitmap | null, magnet?: boolean }} design
 * @returns {boolean}
 */
export function paintCanCooler(mv, texture, { color, art, magnet = false }) {
  if (!mv?.model || !texture || !art) return false;
  const canvas = texture.source.element;
  const { width, height } = canvas;
  const g = canvas.getContext("2d");
  g.save();
  g.fillStyle = color;
  g.fillRect(0, 0, width, height);
  g.translate(0, height);
  g.scale(1, -1);
  g.drawImage(art, 0, 0, width, height);
  g.restore();
  texture.source.update();
  const thread = mv.model.materials.find((m) => m.name === "thread");
  thread?.pbrMetallicRoughness.setBaseColorFactor([...linearRgb(color), 1]);
  const mag = mv.model.materials.find((m) => m.name === "magnet");
  if (mag) {
    const [r, g2, b] = mag.pbrMetallicRoughness.baseColorFactor;
    mag.setAlphaMode(magnet ? "OPAQUE" : "BLEND");
    mag.pbrMetallicRoughness.setBaseColorFactor([r, g2, b, magnet ? 1 : 0]);
  }
  return true;
}

/** @param {number} t */
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * One gentle full turn, then back to the front. JavaScript motion, so it is
 * skipped under reduced motion (CSS can't stop a timer). Returns a function
 * that stops it at the front (call it on the first drag: model-viewer's
 * `camera-change` with `detail.source === "user-interaction"`).
 *
 * @param {any} mv
 * @param {{ reducedMotion?: boolean }} [options]
 * @returns {() => void}
 */
export function turnCanCoolerOnce(mv, { reducedMotion = false } = {}) {
  if (reducedMotion) return () => {};
  const start = performance.now();
  let raf = 0;
  let done = false;
  const frame = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - start) / TURN_MS);
    mv.cameraOrbit = t < 1 ? `${360 * easeInOut(t)}deg 80deg auto` : CAN_COOLER_ORBITS.front;
    mv.jumpCameraToGoal();
    if (t < 1) raf = requestAnimationFrame(frame);
    else done = true;
  };
  raf = requestAnimationFrame(frame);
  return () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    mv.cameraOrbit = CAN_COOLER_ORBITS.front;
    mv.jumpCameraToGoal();
  };
}

/**
 * The front and the back side by side (PICTURE), as a PNG: the order's
 * picture-3d.png. Paint the design first (paintCanCooler). The camera visits
 * the front and the back, with hand turning off meanwhile, and is put back;
 * with `cover.host` the view is covered by a still of itself for the few
 * frames that takes. Null when the element was removed mid-picture, or isn't
 * rendering (model-viewer stops drawing one scrolled out of sight, and its
 * toBlob would hand back its last frame). Never inside a tap that shares: the
 * share sheet needs the tap's own activation.
 *
 * @param {any} mv
 * @param {{ cover?: { host?: HTMLElement | null, className?: string } }} [options]
 * @returns {Promise<Blob | null>}
 */
export async function canCoolerPicture(mv, { cover } = {}) {
  if (!mv?.model || !mv.isConnected || !mv.modelIsVisible) return null;
  const gone = () => !mv.isConnected;
  mv.cameraControls = false;
  const orbit = mv.getCameraOrbit();
  /** @type {ImageBitmap[]} */
  const shots = [];
  let uncover = () => {};
  try {
    await nextFrame();
    uncover = await coverView(mv, cover);
    for (const o of [CAN_COOLER_ORBITS.front, CAN_COOLER_ORBITS.back]) {
      mv.cameraOrbit = o;
      mv.jumpCameraToGoal();
      await nextFrame();
      await nextFrame();
      if (gone()) return null;
      shots.push(await createImageBitmap(await mv.toBlob({ mimeType: "image/png", idealAspect: true })));
    }
  } finally {
    mv.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
    mv.jumpCameraToGoal();
    mv.cameraControls = true;
    await nextFrame();
    await nextFrame();
    uncover();
  }
  if (gone()) return null;
  return composePicture(shots, { document: mv.ownerDocument, picture: PICTURE });
}
