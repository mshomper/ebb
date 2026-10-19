// @ts-check
// Field helpers for the ecology step (doc 11): the opened island's box on the habitat grid, square
// sums through a summed-area table (Crow 1984), a square maximum, and what each square holds of a
// plant. Pure and worker-safe; only + - * /, Math.floor/min/max.

import { HABITAT_ORIGIN } from '../growth/habitat.js';

/** @typedef {{ i0: number, j0: number, i1: number, j1: number }} Box  inclusive cell bounds */

/** The opened island's cells, boxed (cached per habitat). @type {WeakMap<object, Box>} */
const boxes = new WeakMap();

/**
 * The box around the opened island, grown by `pad` cells and kept on the grid.
 * @param {any} hab the habitat grid @param {number} [pad]
 * @returns {Box}
 */
export function openBox(hab, pad = 0) {
  let b = boxes.get(hab);
  if (!b) {
    const n = hab.n;
    let i0 = n, j0 = n, i1 = -1, j1 = -1;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!hab.open[j * n + i]) continue;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
    b = i1 < 0 ? { i0: 0, j0: 0, i1: -1, j1: -1 } : { i0, j0, i1, j1 };
    boxes.set(hab, b);
  }
  const n = hab.n;
  return { i0: Math.max(0, b.i0 - pad), j0: Math.max(0, b.j0 - pad), i1: Math.min(n - 1, b.i1 + pad), j1: Math.min(n - 1, b.j1 + pad) };
}

/**
 * Summed-area table of a field over the whole grid: S[(j + 1) * (n + 1) + (i + 1)] is the sum of
 * cells (0..i, 0..j). Float64, so sums of 0..1 shares stay exact enough and the same everywhere.
 * @param {ArrayLike<number>} a @param {number} n @param {number} [scale] each value is multiplied by this
 */
export function sat(a, n, scale = 1) {
  const W = n + 1;
  const S = new Float64Array(W * W);
  for (let j = 0; j < n; j++) {
    let row = 0;
    for (let i = 0; i < n; i++) {
      row += a[j * n + i] * scale;
      S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row;
    }
  }
  return S;
}

/**
 * Sum over the square of half-width r cells around (i, j), clipped to the grid: four lookups.
 * @param {Float64Array} S sat() @param {number} n @param {number} i @param {number} j @param {number} r
 */
export function boxSum(S, n, i, j, r) {
  const W = n + 1;
  const a0 = Math.max(0, i - r), b0 = Math.max(0, j - r);
  const a1 = Math.min(n - 1, i + r) + 1, b1 = Math.min(n - 1, j + r) + 1;
  return S[b1 * W + a1] - S[b0 * W + a1] - S[b1 * W + a0] + S[b0 * W + a0];
}

/**
 * The largest value within the square of half-width r cells around each cell (separable: rows,
 * then columns), inside a box; outside it the result is 0.
 * @param {Float32Array} a @param {number} n @param {number} r @param {Box} box
 */
export function boxMax(a, n, r, box) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      let m = 0;
      for (let d = Math.max(0, i - r); d <= Math.min(n - 1, i + r); d++) if (a[j * n + d] > m) m = a[j * n + d];
      tmp[j * n + i] = m;
    }
  }
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      let m = 0;
      for (let d = Math.max(box.j0, j - r); d <= Math.min(box.j1, j + r); d++) if (tmp[d * n + i] > m) m = tmp[d * n + i];
      out[j * n + i] = m;
    }
  }
  return out;
}

/**
 * How much of each square each plant holds, weighted: a clump adds weight x its size to the square
 * it stands in; a cover plant (rushes, and grass as painted times its cover) adds weight x its
 * share. With `max`, a square keeps its largest weighted plant instead of the sum.
 * @param {any} hab @param {any} growth state.growth @param {Record<string, number>} weights plant id to weight
 * @param {boolean} max
 */
export function plantField(hab, growth, weights, max) {
  const n = hab.n;
  const f = new Float32Array(n * n);
  const add = (/** @type {number} */ k, /** @type {number} */ v) => { f[k] = max ? (v > f[k] ? v : f[k]) : f[k] + v; };
  for (const p of growth?.plants ?? []) {
    const w = weights[p.sp];
    if (!w) continue;
    const i = Math.floor(p.x - HABITAT_ORIGIN), j = Math.floor(p.z - HABITAT_ORIGIN);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    add(j * n + i, w * Math.min(1, p.size));
  }
  for (const [sp, w] of Object.entries(weights)) {
    if (sp === 'grass') {
      const g = growth?.grass;
      if (!g) continue;
      for (let k = 0; k < n * n; k++) if (g[k] && hab.grass[k] && !hab.sea[k]) add(k, (w * hab.grass[k] * g[k]) / (255 * 255));
      continue;
    }
    const c = growth?.cover?.[sp];
    if (!c) continue;
    for (let k = 0; k < n * n; k++) if (c[k]) add(k, (w * c[k]) / 255);
  }
  return f;
}

/** Smooth 0..1 step between a and b. @param {number} x @param {number} a @param {number} b */
export function smooth(x, a, b) {
  const t = b === a ? (x >= b ? 1 : 0) : (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
