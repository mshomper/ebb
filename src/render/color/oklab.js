// @ts-check
// Color conversions for palettes (docs/05): sRGB transfer, OKLab and OKLCh (Bjorn Ottosson,
// "A perceptual color space for image processing", 2020), and gamut clipping that keeps
// lightness and hue and lowers chroma until the color fits sRGB. Pure functions, no DOM.
// src/shaders/lib-oklab.wgsl holds the same math for the GPU.

/** @typedef {[number, number, number]} Vec3 */

/** One sRGB channel, display-encoded 0..1 -> linear. @param {number} c */
export function srgbChannelToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** One linear channel -> display-encoded sRGB. @param {number} c */
export function linearChannelToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** @param {Vec3} c display-encoded sRGB @returns {Vec3} linear sRGB */
export function srgbToLinear(c) {
  return [srgbChannelToLinear(c[0]), srgbChannelToLinear(c[1]), srgbChannelToLinear(c[2])];
}

/** @param {Vec3} c linear sRGB @returns {Vec3} display-encoded sRGB */
export function linearToSrgb(c) {
  return [linearChannelToSrgb(c[0]), linearChannelToSrgb(c[1]), linearChannelToSrgb(c[2])];
}

/** @param {Vec3} c linear sRGB @returns {Vec3} OKLab [L, a, b] */
export function linearToOklab(c) {
  const [r, g, b] = c;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/**
 * The inverse uses the exact inverses of the two forward matrices (Ottosson's published inverse,
 * rounded to 10 digits, agrees within 1e-8 but makes the round trip drift by about 1e-6).
 * @param {Vec3} lab OKLab @returns {Vec3} linear sRGB (may fall outside 0..1)
 */
export function oklabToLinear(lab) {
  const [L, a, b] = lab;
  const l = 0.9999999984505199 * L + 0.39633779217376786 * a + 0.2158037580607588 * b;
  const m = 1.0000000088817607 * L - 0.10556134232365634 * a - 0.0638541747717059 * b;
  const s = 1.000000054672411 * L - 0.08948418209496577 * a - 1.291485537864092 * b;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  return [
    4.076741661347994 * l3 - 3.3077115904081933 * m3 + 0.23096992872942784 * s3,
    -1.268438004092176 * l3 + 2.6097574006633715 * m3 - 0.34131939631021946 * s3,
    -0.004196086541837046 * l3 - 0.7034186144594494 * m3 + 1.7076147009309446 * s3,
  ];
}

/** @param {Vec3} lab @returns {Vec3} [L, C, h] with h in radians */
export function oklabToOklch(lab) {
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
}

/** @param {Vec3} lch [L, C, h radians] @returns {Vec3} */
export function oklchToOklab(lch) {
  return [lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])];
}

/** '#RRGGBB' or '#RGB' -> display-encoded sRGB 0..1. @param {string} hex @returns {Vec3} */
export function hexToSrgb(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex color: ${hex}`);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Display-encoded sRGB 0..1 -> '#RRGGBB' (clamped, rounded). @param {Vec3} c */
export function srgbToHex(c) {
  const to = (/** @type {number} */ v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`.toUpperCase();
}

/** Shorthand: '#RRGGBB' -> OKLab. @param {string} hex @returns {Vec3} */
export function hexToOklab(hex) {
  return linearToOklab(srgbToLinear(hexToSrgb(hex)));
}

/** Shorthand: OKLab -> '#RRGGBB' (gamut clipped). @param {Vec3} lab */
export function oklabToHex(lab) {
  return srgbToHex(linearToSrgb(oklabToLinear(gamutClipOklab(lab))));
}

// Strict: the result's final clamp must not move anything, or near-black hues would drift.
const GAMUT_EPS = 0;
const CLIP_STEPS = 30;

/** @param {Vec3} rgb */
function inUnitCube(rgb) {
  return rgb[0] >= -GAMUT_EPS && rgb[0] <= 1 + GAMUT_EPS
    && rgb[1] >= -GAMUT_EPS && rgb[1] <= 1 + GAMUT_EPS
    && rgb[2] >= -GAMUT_EPS && rgb[2] <= 1 + GAMUT_EPS;
}

/**
 * Bring an OKLab color inside sRGB: L clamps to 0..1, then chroma shrinks at constant L and hue
 * (bisection on a chroma scale) until it fits. In-gamut colors come back unchanged.
 * @param {Vec3} lab
 * @returns {Vec3}
 */
export function gamutClipOklab(lab) {
  const L = Math.min(1, Math.max(0, lab[0]));
  const a = lab[1], b = lab[2];
  if (inUnitCube(oklabToLinear([L, a, b]))) return [L, a, b];
  let lo = 0, hi = 1;
  for (let i = 0; i < CLIP_STEPS; i++) {
    const mid = 0.5 * (lo + hi);
    if (inUnitCube(oklabToLinear([L, a * mid, b * mid]))) lo = mid; else hi = mid;
  }
  return [L, a * lo, b * lo];
}

/**
 * Gamut clip for linear sRGB (Ottosson's constant-lightness, constant-hue clip). The result is
 * linear sRGB clamped into 0..1.
 * @param {Vec3} rgb linear sRGB, possibly out of gamut
 * @returns {Vec3}
 */
export function gamutClipSrgb(rgb) {
  const c = oklabToLinear(gamutClipOklab(linearToOklab(rgb)));
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/** @param {number} v */
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
