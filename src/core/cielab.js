// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/hat/cielab.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// Screen colours as CIELAB, for the hat's colour decisions that should follow
// what an eye sees rather than the RGB numbers: the nearest Pantone colour to
// a hex (pms-palette.js), the sweatband that suits the front panels
// (sweatband.js), and which hue family a Pantone colour is browsed under.
//
// sRGB (D65) to CIE L*a*b* (D65), and the CIEDE2000 difference between two
// colours. Plain maths, no dependency.

const HEX = /^#?([0-9a-f]{6})$/i;

/** `#rrggbb` (or `rrggbb`) as [r, g, b] in 0–255, or null. */
export function hexToRgb(hex) {
  const m = HEX.exec(typeof hex === "string" ? hex.trim() : "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

// D65 white, as XYZ with Y = 1.
const WHITE = [0.95047, 1, 1.08883];

/** A hex as `{ L, a, b }`, or null when it is not a hex. */
export function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linear);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const [fx, fy, fz] = [x / WHITE[0], y / WHITE[1], z / WHITE[2]].map(f);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab as lightness, chroma and hue angle (degrees, 0–360). */
export function labToLch({ L, a, b }) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

/** A hex as `{ L, C, h }`, or null. */
export function hexToLch(hex) {
  const lab = hexToLab(hex);
  return lab && labToLch(lab);
}

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * CIEDE2000 (Sharma, Wu and Dalal, 2005): how different two Lab colours look.
 * About 1 is a just-noticeable difference; under 2 is a close match.
 */
export function deltaE2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (ap, bb) => (ap === 0 && bb === 0 ? 0 : (deg(Math.atan2(bb, ap)) + 360) % 360);
  const hp1 = hp(ap1, b1);
  const hp2 = hp(ap2, b2);

  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh / 2));

  const Lbar = (L1 + L2) / 2;
  const Cbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbar - 30)) +
    0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) -
    0.2 * Math.cos(rad(4 * hbar - 63));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbar;
  const SH = 1 + 0.015 * Cbar * T;
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7));
  const RT = -RC * Math.sin(rad(2 * dTheta));
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
