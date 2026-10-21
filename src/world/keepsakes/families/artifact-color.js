// @ts-check
// Colour for artifact keepsakes (docs/future/12): a baked artifact's own vertex colours carried
// through a few seeded moves in OKLab (turn the hue, scale the chroma, lift or sink the lightness,
// lean toward a tint), then laid over with patina, stains, bands and gilding by seeded noise on the
// surface. Also the plain colour words for a colour, so a name can say what it looks like. Pure.

import { hash32 } from '../../../core/rng.js';
import { linearToOklab, oklabToLinear } from '../../../render/color/oklab.js';

/** @typedef {[number, number, number]} Rgb linear sRGB */

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** @param {Rgb} a @param {Rgb} b @param {number} t @returns {Rgb} */
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Smooth value noise in 0..1 at a point, from a lattice of seeded hashes. @param {number} x @param {number} y
 * @param {number} z @param {number} seed
 */
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const s = (/** @type {number} */ t) => t * t * (3 - 2 * t);
  const c = (/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz) => (hash32(ix + dx + 4096, iy + dy + 4096, iz + dz + 4096, seed) >>> 8) / 16777216;
  const l = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
  const ux = s(fx), uy = s(fy), uz = s(fz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy), l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy), uz);
}

/**
 * The colour moves a variant makes on every vertex colour.
 * @typedef {{ hue: number, chroma: number, lightMul: number, lightAdd: number, tintHue: number, tintChroma: number }} Moves
 * hue: radians the colour wheel turns; chroma: a scale; tintHue and tintChroma: a vector added in the
 * colour plane (so a grey thing can lean blue)
 */

/** One colour through the moves. @param {Rgb} c @param {Moves} m @returns {Rgb} */
export function recolor(c, m) {
  const [L, a, b] = linearToOklab(c);
  const ch = Math.cos(m.hue), sh = Math.sin(m.hue);
  // The tint fades in toward mid lightness so black and white take less of it.
  const w = 1 - Math.abs(L - 0.6) * 1.1;
  let na = (a * ch - b * sh) * m.chroma + Math.cos(m.tintHue) * m.tintChroma * clamp(w, 0.25, 1);
  let nb = (a * sh + b * ch) * m.chroma + Math.sin(m.tintHue) * m.tintChroma * clamp(w, 0.25, 1);
  const nL = clamp(L * m.lightMul + m.lightAdd, 0.05, 0.96);
  // Back to linear; if it falls outside the display's colours, ease the chroma until it fits.
  for (let k = 0; k < 10; k++) {
    const o = oklabToLinear([nL, na, nb]);
    if (o[0] >= -0.001 && o[1] >= -0.001 && o[2] >= -0.001 && o[0] <= 1.001 && o[1] <= 1.001 && o[2] <= 1.001) return [clamp(o[0], 0, 1), clamp(o[1], 0, 1), clamp(o[2], 0, 1)];
    na *= 0.88; nb *= 0.88;
  }
  const o = oklabToLinear([nL, 0, 0]);
  return [clamp(o[0], 0, 1), clamp(o[1], 0, 1), clamp(o[2], 0, 1)];
}

/**
 * A plain colour word for a colour, such as "deep-teal", "rust", "pale-grey", "olive". Twenty hue sectors
 * (OKLab degrees) each with a dark and a pale word; warm, muted colours read as browns and tans.
 * @param {Rgb} rgb linear sRGB
 */
export function colorWord(rgb) {
  const [L, a, b] = linearToOklab(rgb);
  const C = Math.hypot(a, b), h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  if (C < 0.022) return L < 0.2 ? 'black' : L < 0.32 ? 'charcoal' : L < 0.45 ? 'dark-grey' : L < 0.62 ? 'grey' : L < 0.78 ? 'pale-grey' : L < 0.9 ? 'bone' : 'white';
  // Warm, muted colours are the browns.
  if (C < 0.07 && h >= 30 && h < 105) return L < 0.3 ? 'umber' : L < 0.42 ? 'dark-brown' : L < 0.55 ? 'brown' : L < 0.66 ? 'fawn' : L < 0.76 ? 'tan' : L < 0.86 ? 'buff' : 'ivory';
  /** @type {[number, string, string, string][]} upper hue bound, word, dark word, pale word */
  const wheel = [[12, 'rose', 'wine', 'blush'], [28, 'crimson', 'maroon', 'pink'], [45, 'red', 'oxblood', 'coral'], [60, 'orange', 'rust', 'peach'], [75, 'copper', 'bronze', 'apricot'],
    [90, 'amber', 'ochre', 'straw'], [105, 'yellow', 'mustard', 'cream'], [122, 'lime', 'olive', 'lemon'], [145, 'green', 'moss', 'mint'], [165, 'emerald', 'pine', 'sage'],
    [185, 'jade', 'bottle-green', 'celadon'], [205, 'teal', 'deep-teal', 'aqua'], [225, 'turquoise', 'petrol', 'ice-blue'], [245, 'azure', 'denim', 'powder-blue'], [262, 'blue', 'navy', 'cornflower'],
    [280, 'indigo', 'midnight', 'periwinkle'], [300, 'violet', 'aubergine', 'lavender'], [320, 'plum', 'damson', 'lilac'], [340, 'magenta', 'mulberry', 'orchid'], [361, 'raspberry', 'wine', 'blush']];
  const row = wheel.find((w) => h < w[0]) ?? wheel[0];
  if (C < 0.045) return `grey-${row[1]}`;
  return L < 0.38 ? row[2] : L > 0.78 ? row[3] : row[1];
}
/** Display colour (sRGB bytes) as a CSS string, for the lab's swatches. @param {Rgb} c */
export const cssOf = (c) => `rgb(${c.map((x) => Math.round(255 * clamp(x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055, 0, 1))).join(',')})`;
