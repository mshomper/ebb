// @ts-check
// Curves and season helpers for the ambience (doc 17 "Ambience that reacts", doc 25).
// Every number that shapes a bed comes from recipes/audio/ambience.json as a small "value spec":
//
//   3                                   a plain number
//   {"in": "wind", "pts": [[0, -6], [1, 0]]}   a curve of one sound-state input (piecewise linear,
//                                        held flat past its ends; "log": true interpolates in log y)
//   {"bySeason": [a, b, c, d]}           spring, summer, autumn, winter, weighted by seasonBlend
//   {"sum": [spec, ...]}, {"mul": [spec, ...]}, {"max": [spec, ...]}, {"min": [spec, ...]}
//
// Lists are summed when they are decibels (gainDb) and multiplied when they are amounts (amount).

export const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/** @param {number} db */
export const dbToGain = (db) => Math.pow(10, db / 20);
/** @param {number} g */
export const gainToDb = (g) => (g > 1e-9 ? 20 * Math.log10(g) : -180);
/** @param {number} x */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** @param {number} a @param {number} b @param {number} x */
export const lerp = (a, b, x) => a + (b - a) * x;

/**
 * Piecewise-linear curve through [x, y] points, flat past the ends.
 * @param {number[][]} pts sorted by x
 * @param {number} x
 * @param {boolean} [logY] interpolate y logarithmically (for frequencies)
 */
export function curve(pts, x, logY = false) {
  if (!pts.length) return 0;
  if (!(x > pts[0][0])) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  let i = 1;
  while (pts[i][0] < x) i++;
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  const t = x1 > x0 ? (x - x0) / (x1 - x0) : 1;
  return logY ? y0 * Math.pow(y1 / y0, t) : y0 + (y1 - y0) * t;
}

/**
 * Evaluate one value spec.
 * @param {any} spec
 * @param {Record<string, number>} inp sound-state inputs
 * @param {number[]} blend four season weights
 * @returns {number}
 */
export function value(spec, inp, blend) {
  if (spec == null) return 0;
  if (typeof spec === 'number') return spec;
  if (spec.in !== undefined) {
    const x = inp[spec.in];
    if (x === undefined) throw new Error(`ambience: unknown input "${spec.in}"`);
    return curve(spec.pts, x, !!spec.log);
  }
  if (spec.bySeason) return seasonal(spec.bySeason, blend);
  if (spec.sum) return spec.sum.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + value(s, inp, blend), 0);
  if (spec.mul) return spec.mul.reduce((/** @type {number} */ a, /** @type {any} */ s) => a * value(s, inp, blend), 1);
  if (spec.max) return Math.max(...spec.max.map((/** @type {any} */ s) => value(s, inp, blend)));
  if (spec.min) return Math.min(...spec.min.map((/** @type {any} */ s) => value(s, inp, blend)));
  throw new Error(`ambience: cannot read value ${JSON.stringify(spec)}`);
}

/** Sum of a dB spec or list of specs. @param {any} list @param {Record<string, number>} inp @param {number[]} blend */
export function sumDb(list, inp, blend) {
  if (list == null) return 0;
  if (!Array.isArray(list)) return value(list, inp, blend);
  let s = 0;
  for (const v of list) s += value(v, inp, blend);
  return s;
}

/** Product of an amount spec or list of specs. @param {any} list @param {Record<string, number>} inp @param {number[]} blend */
export function product(list, inp, blend) {
  if (list == null) return 1;
  if (!Array.isArray(list)) return value(list, inp, blend);
  let p = 1;
  for (const v of list) p *= value(v, inp, blend);
  return p;
}

/** Weighted sum of four per-season numbers. @param {number[]} four @param {number[]} blend */
export function seasonal(four, blend) {
  return four[0] * blend[0] + four[1] * blend[1] + four[2] * blend[2] + four[3] * blend[3];
}

/**
 * Blend per-season objects of numbers: keys ending in Hz blend in log, the rest linearly.
 * @param {Record<string, Record<string, number>>} bySeason {spring: {...}, summer: {...}, ...}
 * @param {number[]} blend
 * @returns {Record<string, number>}
 */
export function blendObjects(bySeason, blend) {
  /** @type {Record<string, number>} */
  const out = {};
  const keys = Object.keys(bySeason.spring ?? bySeason[Object.keys(bySeason)[0]]);
  for (const k of keys) {
    const log = /Hz$/.test(k);
    let acc = 0, w = 0;
    for (let i = 0; i < 4; i++) {
      const o = bySeason[SEASONS[i]];
      if (!o || blend[i] <= 0) continue;
      acc += blend[i] * (log ? Math.log(o[k]) : o[k]);
      w += blend[i];
    }
    out[k] = w > 0 ? (log ? Math.exp(acc / w) : acc / w) : 0;
  }
  return out;
}

/** Normalize four weights to sum 1 (spring if all zero). @param {number[]|undefined} b */
export function normBlend(b) {
  if (!b || b.length !== 4) return [1, 0, 0, 0];
  const s = b[0] + b[1] + b[2] + b[3];
  if (!(s > 0)) return [1, 0, 0, 0];
  return [b[0] / s, b[1] / s, b[2] / s, b[3] / s];
}

/**
 * Season weights from a season position (0 = start of spring, 1 summer, 2 autumn, 3 winter, 4 =
 * next spring), crossfading over `edge` of a season centred on each boundary (doc 25).
 * @param {number} pos
 * @param {number} edge e.g. 0.2 = the last 10 percent of one season and the first 10 of the next
 * @returns {number[]}
 */
export function blendFromPosition(pos, edge) {
  const p = ((pos % 4) + 4) % 4;
  const s = Math.floor(p), f = p - s;
  const w = [0, 0, 0, 0];
  const h = Math.max(1e-6, edge / 2);
  if (f > 1 - h) {
    const x = (f - (1 - h)) / (2 * h); // 0 .. 0.5 into the next season
    w[s] = 1 - x; w[(s + 1) % 4] = x;
  } else if (f < h) {
    const x = (h - f) / (2 * h); // 0.5 .. 0 left of the previous season
    w[s] = 1 - x; w[(s + 3) % 4] = x;
  } else w[s] = 1;
  return w;
}

/**
 * Map the hour onto a standard day where sunrise is 6 and sunset is 18, so hour curves in the
 * recipe hold for long summer days and short winter ones alike.
 * @param {number} hour 0..24 display time
 * @param {number} riseH
 * @param {number} setH
 */
export function standardHour(hour, riseH = 6, setH = 18) {
  const h = ((hour % 24) + 24) % 24;
  const dayLen = Math.max(1, setH - riseH);
  if (h >= riseH && h < setH) return 6 + (12 * (h - riseH)) / dayLen;
  const since = (h - setH + 24) % 24;
  return (18 + (12 * since) / (24 - dayLen)) % 24;
}
