// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/sweatband.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// The sweatband is not the customer's to colour (Brayden, 2026-10-21: "It
// should be black for darker hat colors, grey for grey colors, and white for
// lighter colors"; 2026-10-22: white only for a hat "very close to a white
// color"). It follows the front panels: black unless the hat is a grey or
// nearly white. The inside label's default ground is the band's colour.
//
// Worked out from the front panels' colour in CIELAB, wherever a design's
// parts change: the colour step and the presets (hat-config.js), a draft or a
// design link opened again (hat-draft.js), and once more on the server
// (hat-submit.ts), which writes `parts.sweatband` so the 3D, the spec, the
// team email and the hub all show the band that will be sewn. Which part is
// "the front panels" is the hat style's (hat-style-config.js
// sweatbandFollows): every caller on the site passes its style's.
//
// It imports nothing but cielab.js: the model labs copy this file and load it
// on their own.

import { hexToLch } from "./cielab.js";

/**
 * The three bands. PLACEHOLDER shades (2026-10-21) until Brayden gives the
 * real ones: the lab's black and off-white, and a mid heather grey.
 */
export const SWEATBANDS = Object.freeze({
  black: Object.freeze({ id: "black", label: "Black", hex: "#1C1C1E" }),
  grey: Object.freeze({ id: "grey", label: "Heather grey", hex: "#8E8E8C" }),
  white: Object.freeze({ id: "white", label: "White", hex: "#F1F0EB" }),
});

/**
 * The part the band follows when a caller names none: the No. 7's
 * (hat-style-config.js sweatbandFollows; tests/hat-style-config.test.ts holds
 * the two equal), for the labs, which load this file without the registry.
 */
export const SWEATBAND_FOLLOWS = "crown_FL";

/**
 * Which band suits a front-panel colour (Brayden, 2026-10-22: "To have a
 * white sweatband, the hat needs to be very close to a white color"; brown
 * hats get black):
 *   - white only when the hat is nearly white: L* 90 and up, chroma 8 or less
 *     (PANTONE 9285 C, 9224 C and the rest of the 9000s near-whites);
 *   - grey for a near-neutral (chroma under 10) that is mid or light (L* 45
 *     up to that white): a grey hat, PANTONE Cool Gray 1 C to 7 C;
 *   - black for everything else: browns, tans, stone, light blues, pastels,
 *     creams, reds, navy, and charcoal (L* about 30).
 * Of the 3,219 PMS C colours, 26 get white. tests/sweatband.test.ts holds the
 * examples the bounds were tuned on. Null for anything that is not a hex.
 */
export function sweatbandFor(hex) {
  const lch = hexToLch(hex);
  if (!lch) return null;
  const { L, C } = lch;
  if (L >= 90 && C <= 8) return "white";
  if (C < 10 && L >= 45) return "grey";
  return "black";
}

/**
 * The ground an inside label is woven on when the customer picks none: the
 * sweatband's colour, so it follows the hat (Brayden, 2026-10-22: "I want
 * the default label background to be the same color as the sweatband"). A
 * hat with no front colour yet gets the black band's. `follows` is the
 * style's front part.
 */
export function labelGroundFor(parts, follows = SWEATBAND_FOLLOWS) {
  return SWEATBANDS[sweatbandFor(parts?.[follows]) ?? "black"].hex;
}

/**
 * `parts` with the sweatband its front panels (`follows`, the style's front
 * part) call for. The same object when it already has it. With no
 * front-panel colour, any band is taken off: there is nothing to follow.
 */
export function withSweatband(parts, follows = SWEATBAND_FOLLOWS) {
  const band = sweatbandFor(parts?.[follows]);
  const hex = band ? SWEATBANDS[band].hex : undefined;
  if (parts?.sweatband === hex) return parts;
  const next = { ...parts };
  delete next.sweatband;
  return hex ? { ...next, sweatband: hex } : next;
}
