// The hat in 3D, the host's side, as plain functions: its view settings, the
// design put on the look, and its picture. Pulled out of Reel48-Storefront
// src/components/storefront/hat/Hat3D.jsx (origin/main d78d90ee) without
// React, analytics or Tailwind. The look itself is hat-look.js
// (createHatLook), the on-hat editor hat-edit.js (createEditSession).
//
// A host's sequence, as Hat3D does it:
//   1. hat3DFilesOf(hatStyleOf(die.id), urls) and dieFitsModel(die, files):
//      a die not on its model's frame shows the flat die instead.
//   2. webglAvailable(), then loadViewer({ meshoptDecoderLocation }).
//   3. createModelViewer({ src: files.model, environment, alt, view: HAT_VIEW,
//      exposure: EXPOSURE }) (or the same attributes in the host's own markup).
//   4. createHatLook(mv, { die, zones: files.placements, tagLogo, partFollows,
//      neverOwn, plasticParts (the style's), textureScale, onReady }).
//   5. On each design change: look.setStageArt(stage.exportArtCanvas({ color:
//      false, scale: textureScale })), applyHatDesign(look, ...), look.paintNow().
//   6. look.view(spot) to fly to "front", "left", "right", "back", "label" or "whole".
//   7. To edit a spot on the hat: loadSurfaceJson(files.surface), check its
//      frame is the die's stage, createSurface(json), then createEditSession
//      with HAT_EDIT_INTERPOLATION_DECAY and camera controls off.

import { LABEL_SHAPES } from "../core/hat-config.js";
import { labelGroundFor } from "../core/sweatband.js";
import { FIELD_OF_VIEW, GENERIC_VIEWS, LABEL_ZONE, METHODS } from "./hat-look.js";
import { PICTURE, composePicture, coverView, nextFrame } from "./picture.js";

/**
 * The view Brayden judged the hat in at L1 and L3 (the lab's): the whole hat
 * from the front left, a little above. Linear tone mapping at hat-look's
 * EXPOSURE keeps the colours true under the studio, as on the can cooler. The
 * camera may go almost straight up and almost straight under (the inside label
 * is seen through the opening, from below), and in close enough for a spot
 * edited on the hat to fill a phone's view (hat-edit.js fitSpot stops at 0.12 m).
 */
export const HAT_VIEW = Object.freeze({
  "camera-orbit": GENERIC_VIEWS.whole.orbit,
  "field-of-view": `${FIELD_OF_VIEW}deg`,
  "min-camera-orbit": "auto 8deg 0.06m",
  "max-camera-orbit": "auto 172deg auto",
  "interpolation-decay": "110",
  "tone-mapping": "linear",
  "shadow-intensity": "1",
  "shadow-softness": "0.9",
});

/**
 * While a spot is edited on the hat the camera eases at model-viewer's own
 * rate, the placement lab's, which Brayden tried on his iPhone (HAT_VIEW's 110
 * is for its flights between spots).
 */
export const HAT_EDIT_INTERPOLATION_DECAY = 50;

const OUTSIDE_SPOTS = ["front", "left", "right", "back"];

/**
 * The inside label's shape a design's spots have chosen: "tall", "square", or "none".
 *
 * @param {Record<string, unknown> | null | undefined} zones
 * @returns {"tall" | "square" | "none"}
 */
export function labelShapeOf(zones) {
  for (const [zone, shape] of Object.entries(LABEL_SHAPES)) if (zones?.[zone]) return /** @type {"tall" | "square"} */ (shape);
  return "none";
}

/**
 * Puts a design's colours, methods and label on the look; what hasn't changed
 * is left alone. A label's ground follows the sweatband until one is picked.
 *
 * @param {any} look createHatLook's
 * @param {{ parts?: Record<string, string>, zones?: Record<string, any>,
 *   labelShape?: "tall" | "square" | "none", style: { sweatbandFollows: string } }} design
 */
export function applyHatDesign(look, { parts, zones, labelShape, style }) {
  look.setParts(parts);
  for (const spot of OUTSIDE_SPOTS) {
    const method = zones?.[spot]?.method;
    look.setSpot(spot, { method: METHODS[/** @type {keyof typeof METHODS} */ (method)] ? method : "embroidery" });
  }
  const shape = labelShape ?? labelShapeOf(zones);
  look.setLabel({
    shape,
    ground: zones?.[/** @type {Record<string, string>} */ (LABEL_ZONE)[shape]]?.ground ?? labelGroundFor(parts, style.sweatbandFollows),
  });
}

/**
 * The front and the back side by side (PICTURE), as a PNG: the order's
 * picture-3d.png. Paint the design first (applyHatDesign, look.paintNow).
 * The camera visits the hat's front and back views and is put back; in an
 * edit (`session`, createEditSession's) the editor's outline is hidden for
 * the shots and its camera goal kept. With `cover.host` the view is covered
 * by a still of itself meanwhile. Null when the element was removed
 * mid-picture or isn't rendering.
 *
 * @param {any} mv
 * @param {{ session?: any, cover?: { host?: HTMLElement | null, className?: string } }} [options]
 * @returns {Promise<Blob | null>}
 */
export async function hatPicture(mv, { session = null, cover } = {}) {
  if (!mv?.model || !mv.isConnected || !mv.modelIsVisible) return null;
  const gone = () => !mv.isConnected;
  mv.cameraControls = false;
  session?.setChromeHidden(true);
  const orbit = mv.getCameraOrbit();
  const target = mv.getCameraTarget();
  const fov = mv.getFieldOfView();
  // In an edit the camera's goal is the editor's, and a flight to it carries
  // on from where the picture found the camera.
  const goal = session ? { orbit: mv.cameraOrbit, target: mv.cameraTarget } : null;
  /** @type {ImageBitmap[]} */
  const shots = [];
  let uncover = () => {};
  try {
    await nextFrame();
    uncover = await coverView(mv, cover);
    for (const v of [GENERIC_VIEWS.front, GENERIC_VIEWS.back]) {
      mv.cameraTarget = v.target;
      mv.cameraOrbit = v.orbit;
      mv.fieldOfView = `${FIELD_OF_VIEW}deg`;
      mv.jumpCameraToGoal();
      await nextFrame();
      await nextFrame();
      if (gone()) return null;
      shots.push(await createImageBitmap(await mv.toBlob({ mimeType: "image/png", idealAspect: true })));
    }
  } finally {
    mv.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
    mv.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
    mv.fieldOfView = `${fov}deg`;
    mv.jumpCameraToGoal();
    if (goal) {
      mv.cameraTarget = goal.target;
      mv.cameraOrbit = goal.orbit;
    }
    // Turned by hand again, unless a spot is edited on it: the editor turns it.
    mv.cameraControls = !session;
    await nextFrame();
    await nextFrame();
    uncover();
    session?.setChromeHidden(false);
  }
  if (gone()) return null;
  return composePicture(shots, { document: mv.ownerDocument, picture: PICTURE });
}
