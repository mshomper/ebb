// @ts-check
// The camp's small lights (docs/06, Lanterns and small lights; docs/future/13 C-32): the fire and the
// lantern as point lights, a blackbody colour for each and a gentle flicker. Pure.

/**
 * A blackbody's colour at a temperature, as linear sRGB with luminance 1 (so a light's candela sets
 * its brightness alone): the Planckian locus (Kim et al. 2002 cubic fit) to XYZ, to linear sRGB,
 * negative channels clipped and the luminance put back to 1.
 * @param {number} kelvin 1667 to 25000 @returns {[number, number, number]}
 */
export function kelvinRgb(kelvin) {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
  const y = T <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  const r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
  const g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
  const b = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}

/**
 * A light's flicker, a multiplier near 1: two octaves of smooth noise on intensity (docs/06: about
 * ±6% at 3 Hz for a lantern; a fire more). Drawing only, from real time.
 * @param {number} t real seconds @param {number} amount 0..1 @param {number} hz @param {number} seed
 */
export function flicker(t, amount, hz, seed) {
  const n = (/** @type {number} */ u) => {
    const i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f);
    const h = (/** @type {number} */ k) => { const v = Math.sin((k + seed * 17.3) * 12.9898) * 43758.5453; return v - Math.floor(v); };
    return h(i) * (1 - s) + h(i + 1) * s;
  };
  const v = 0.65 * n(t * hz) + 0.35 * n(t * hz * 2.7 + 5.1);
  return 1 + amount * (v * 2 - 1);
}
