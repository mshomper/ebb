// @ts-check
// Seeded, counter-based randomness and deterministic math (doc 03).
// Everything here uses only integer ops, + - * /, Math.sqrt, Math.floor and
// Math.abs, so results are bit-identical in every browser and worker.

/**
 * PCG hash, one round (Jarzynski and Olano, JCGT 2020). Same as lib-hash.wgsl.
 * @param {number} v uint32
 * @returns {number} uint32
 */
function pcg(v) {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/**
 * Hash any number of integers to a uint32. Inputs are taken as uint32 (x >>> 0).
 * h = pcg(a); h = pcg(h ^ b); h = pcg(h ^ c) ...
 * @param {...number} ints
 * @returns {number} uint32
 */
export function hash32(...ints) {
  let h = pcg(ints.length > 0 ? ints[0] >>> 0 : 0);
  for (let i = 1; i < ints.length; i++) h = pcg(h ^ (ints[i] >>> 0));
  return h;
}

/**
 * Derive a named sub-seed from the world seed, e.g. subSeed(seed, 'growth').
 * @param {number} worldSeed
 * @param {string} name
 * @returns {number} uint32
 */
export function subSeed(worldSeed, name) {
  let h = pcg(worldSeed >>> 0);
  for (let i = 0; i < name.length; i++) h = pcg(h ^ name.charCodeAt(i));
  return pcg(h ^ name.length);
}

/**
 * @typedef {Object} Stream
 * @property {() => number} nextU32       next uint32
 * @property {() => number} next          float in [0, 1), 24-bit resolution
 * @property {(a: number, b: number) => number} range  float in [a, b)
 * @property {(n: number) => number} int  integer in [0, n)
 * @property {() => number} counter       how many values have been drawn
 */

/**
 * Counter-based stream keyed by seed and integer keys (e.g. system id, hour index).
 * Value i is hash32(hash32(seed, ...keys), i), so it never depends on call order elsewhere.
 * @param {number} seed
 * @param {...number} keys
 * @returns {Stream}
 */
export function stream(seed, ...keys) {
  const base = pcg(hash32(seed, ...keys));
  let c = 0;
  const nextU32 = () => pcg(base ^ c++);
  const next = () => (nextU32() >>> 8) / 16777216;
  return {
    nextU32,
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (n) => Math.floor(next() * n),
    counter: () => c,
  };
}

// ---------------------------------------------------------------------------
// Deterministic math. Accurate to about 1e-15 relative over normal ranges.

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const TWO_OVER_PI = 0.6366197723675814;
// pi/2 split in three parts (fdlibm), so k * P1 and k * P2 are exact for |k| < 2^20.
const P1 = 1.57079632673412561417e+00;
const P2 = 6.07710050630396597660e-11;
const P3 = 2.02226624879595063154e-21;
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const LOG2E = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;
const SQRT3 = Math.sqrt(3);
const PI_6 = 0.5235987755982989;
const TAN_PI_12 = 0.2679491924311227;

// Taylor coefficients 1/n!, computed once with plain division (deterministic).
/** @type {number[]} */
const INV_FACT = [1];
for (let n = 1; n <= 20; n++) INV_FACT[n] = INV_FACT[n - 1] / n;

const bits = new DataView(new ArrayBuffer(8));

/**
 * Exact 2^k for integer k in [-1074, 1023] by repeated squaring of 2 or 1/2.
 * @param {number} k
 */
function pow2i(k) {
  let n = k < 0 ? -k : k;
  let b = k < 0 ? 0.5 : 2;
  let r = 1;
  while (n > 0) {
    if (n & 1) r *= b;
    b *= b;
    n >>>= 1;
  }
  return r;
}

/** sin(r) for |r| <= pi/4. @param {number} r */
function sinPoly(r) {
  const z = r * r;
  let p = INV_FACT[17];
  for (let n = 15; n >= 3; n -= 2) p = (n % 4 === 3 ? -INV_FACT[n] : INV_FACT[n]) + z * p;
  return r + r * z * p;
}

/** cos(r) for |r| <= pi/4. @param {number} r */
function cosPoly(r) {
  const z = r * r;
  let p = INV_FACT[18] * -1;
  for (let n = 16; n >= 2; n -= 2) p = (n % 4 === 2 ? -INV_FACT[n] : INV_FACT[n]) + z * p;
  return 1 + z * p;
}

/**
 * Reduce x to r in [-pi/4, pi/4] and quadrant q in 0..3. Exact reduction for |x| < ~1.6e6.
 * @param {number} x
 * @returns {[number, number]}
 */
function reduce(x) {
  const k = Math.floor(x * TWO_OVER_PI + 0.5);
  const r = ((x - k * P1) - k * P2) - k * P3;
  const q = ((k % 4) + 4) % 4;
  return [r, q];
}

/** @param {number} x */
function sin(x) {
  if (!isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  if (q === 0) return sinPoly(r);
  if (q === 1) return cosPoly(r);
  if (q === 2) return -sinPoly(r);
  return -cosPoly(r);
}

/** @param {number} x */
function cos(x) {
  if (!isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  if (q === 0) return cosPoly(r);
  if (q === 1) return -sinPoly(r);
  if (q === 2) return -cosPoly(r);
  return sinPoly(r);
}

/** @param {number} x */
function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;
  const k = Math.floor(x * LOG2E + 0.5);
  const r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= ~0.347
  let p = INV_FACT[14];
  for (let n = 13; n >= 0; n--) p = INV_FACT[n] + r * p;
  const h = k >> 1;
  return p * pow2i(h) * pow2i(k - h);
}

/** @param {number} x */
function log(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; e = -54; } // subnormal: scale by 2^54
  bits.setFloat64(0, x);
  const hi = bits.getUint32(0);
  e += ((hi >>> 20) & 0x7ff) - 1023;
  bits.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);
  let m = bits.getFloat64(0); // m in [1, 2)
  if (m > SQRT2) { m *= 0.5; e += 1; }
  const s = (m - 1) / (m + 1); // |s| <= 0.1716
  const z = s * s;
  let p = 1 / 23;
  for (let n = 21; n >= 1; n -= 2) p = 1 / n + z * p;
  const logm = 2 * s * p;
  return e * LN2_HI + (e * LN2_LO + logm);
}

/** @param {number} x @param {number} y */
function pow(x, y) {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (x === 1) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (Math.floor(y) === y && Math.abs(y) <= 1024) {
    // small integer powers by repeated squaring: exact for small results like (-2)^3
    let n = Math.abs(y), b = x, r = 1;
    while (n > 0) {
      if (n % 2 === 1) r *= b;
      b *= b;
      n = Math.floor(n / 2);
    }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    const mag = exp(y * log(-x));
    return Math.abs(y % 2) === 1 ? -mag : mag;
  }
  return exp(y * log(x));
}

/** atan(t) for t >= 0. @param {number} t */
function atanPos(t) {
  let flip = false;
  if (t > 1) { t = 1 / t; flip = true; }
  let off = 0;
  if (t > TAN_PI_12) { t = (t * SQRT3 - 1) / (t + SQRT3); off = PI_6; }
  const z = t * t; // |t| <= 0.268
  let p = -1 / 31; // series t * (1 - z/3 + z^2/5 - ... - z^15/31)
  for (let n = 29; n >= 1; n -= 2) p = (n % 4 === 1 ? 1 / n : -1 / n) + z * p;
  let a = off + t * p;
  if (flip) a = HALF_PI - a;
  return a;
}

/** @param {number} t */
function atan(t) {
  if (t !== t) return NaN;
  return t < 0 ? -atanPos(-t) : atanPos(t);
}

/** @param {number} y @param {number} x */
function atan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (!isFinite(x) && !isFinite(y)) {
    const a = x > 0 ? PI / 4 : 3 * PI / 4;
    return y > 0 ? a : -a;
  }
  if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  const a = atan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

/** Deterministic transcendental functions for simulation code (never Math.sin etc.). */
export const det = Object.freeze({ PI, sin, cos, exp, log, pow, atan, atan2 });
