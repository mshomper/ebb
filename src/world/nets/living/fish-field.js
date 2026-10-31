// @ts-check
// A fish's grown pattern (docs/future/17, catch gen 2): a field over its body grid, u nose to
// tail and v top to bottom, that colours its mesh and its sketch. Spots, maze, squiggles, lace and
// rings are grown by reaction diffusion (Gray-Scott) on the fish's own grid, so marks crowd toward
// the head and tail as the grid narrows there; each species has its own feature size and grain, and
// each individual nudges the growth constants a little. Bars, stripes, mottle, speckle, an eyespot
// and light organs are drawn. The growth runs once per fish (a worker job, growFieldJob) and is
// cached by seed. Seeded through src/core/rng.js. Pure.

import { stream } from '../../../core/rng.js';
import { makeMap, clamp, smooth, hsl } from './fish-species.js';

const TAU = Math.PI * 2;

/** Smooth value noise from a seed, the lab's (fBm over a 256 x 256 table). @param {number} seed */
export function makeNoise(seed) {
  const r = stream(seed, 0x9015);
  const P = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) P[i] = r.next();
  const g = (/** @type {number} */ x, /** @type {number} */ y) => P[((y & 255) << 8) | (x & 255)];
  const n = (/** @type {number} */ x, /** @type {number} */ y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (/** @type {number} */ x, /** @type {number} */ y, o = 3) => {
    let s = 0, amp = 0.5, f = 1, tot = 0;
    for (let i = 0; i < o; i++) { s += amp * n(x * f + i * 17.3, y * f + i * 9.1); tot += amp; f *= 2; amp *= 0.5; }
    return s / tot;
  };
}

/**
 * Gray-Scott reaction diffusion on an nu x nv grid, the B field normalised to 0..1, or null if it
 * died out. w: the grain (how much it spreads along u against v); Ds: the feature size.
 * @param {number} nu @param {number} nv @param {number} F @param {number} K @param {number} iters
 * @param {{ next: () => number }} r @param {number} [w] @param {number} [Ds]
 */
export function grayScott(nu, nv, F, K, iters, r, w = 0.5, Ds = 0.18) {
  const n = nu * nv;
  let A = new Float32Array(n).fill(1), B = new Float32Array(n), A2 = new Float32Array(n), B2 = new Float32Array(n);
  for (let i = 0; i < n; i++) if (r.next() < 0.05) { A[i] = 0.5; B[i] = 0.25 + r.next() * 0.5; }
  const ax = Ds * w, ay = Ds * (1 - w);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < nv; y++) {
      const ym = (y > 0 ? y - 1 : y) * nu, y0 = y * nu, yp = (y < nv - 1 ? y + 1 : y) * nu;
      for (let x = 0; x < nu; x++) {
        const xm = x > 0 ? x - 1 : x, xp = x < nu - 1 ? x + 1 : x, i = y0 + x;
        const la = ax * (A[y0 + xm] + A[y0 + xp] - 2 * A[i]) + ay * (A[ym + x] + A[yp + x] - 2 * A[i]);
        const lb = ax * (B[y0 + xm] + B[y0 + xp] - 2 * B[i]) + ay * (B[ym + x] + B[yp + x] - 2 * B[i]);
        const a = A[i], b = B[i], abb = a * b * b;
        A2[i] = a + (la - abb + F * (1 - a));
        B2[i] = b + (0.5 * lb + abb - (K + F) * b);
      }
    }
    let t = A; A = A2; A2 = t; t = B; B = B2; B2 = t;
  }
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, B[i]); hi = Math.max(hi, B[i]); }
  if (hi - lo < 0.05) return null;
  for (let i = 0; i < n; i++) B[i] = (B[i] - lo) / (hi - lo);
  return B;
}

/** Where an eyespot and light organs sit, in the side view. @param {any} sp @param {(u: number, v: number) => number[]} map */
export function marksOf(sp, map) {
  const oc = sp.pattern === 'ocellus' ? map(sp.pp.uc, sp.pp.vc) : null;
  /** @type {number[][]} */ const dots = [];
  if (sp.pattern === 'photophores') for (const row of sp.pp.rows) for (let k = 0; k < sp.pp.n; k++) dots.push(map(0.16 + (0.74 * (k + 0.5)) / sp.pp.n, row));
  return { oc, dots };
}

/**
 * A drawn pattern's value at a grid point: above 0 the second colour, below 0 the accent.
 * @param {any} sp @param {{ oc: number[] | null, dots: number[][] }} M @param {number} u @param {number} v
 * @param {number} x @param {number} y side view @param {(x: number, y: number, o?: number) => number} nz
 */
function patternValue(sp, M, u, v, x, y, nz) {
  const P = sp.pp, s = sp.pscale;
  if (sp.special === 'stone') { const m = smooth(0.42, 0.6, nz(u * 7, v * 3.5, 4)), patch = smooth(0.7, 0.77, nz(u * 5 + 9, v * 3, 3)); return m - patch * 0.9; }
  switch (sp.pattern) {
    case 'plain': return 0.3 * (nz(u * 5 * s, v * 2.5 * s, 3) - 0.5);
    case 'bars': {
      const w = Math.sin(TAU * (u * P.n + P.ph) + 1.4 * (nz(u * 3, v * 2 + 7, 3) - 0.5) + v * P.tilt);
      return smooth(P.t, P.t + 0.25, w) * (sp.special === 'lion' ? smooth(0, 0.04, u) : smooth(0.1, 0.22, u)) * (1 - smooth(0.9, 0.99, u));
    }
    case 'stripes': { const w = Math.sin(TAU * (v * P.n * 0.5 + P.ph) + 1.6 * (nz(u * 2.5, v + 3, 3) - 0.5)); return smooth(0.25, 0.55, w) * smooth(0.12, 0.25, u); }
    case 'mottle': return smooth(0.45, 0.62, nz(u * 7 * s, v * 3.5 * s, 4));
    case 'speckle': return smooth(0.64, 0.72, nz(u * 30 * s, v * 15 * s, 2)) * 0.9 + 0.15 * (nz(u * 4, v * 2, 2) - 0.5);
    case 'ocellus': {
      const oc = /** @type {number[]} */ (M.oc), d = Math.hypot(x - oc[0], y - oc[1]) / P.r;
      if (d < 0.5) return 1;
      if (d < 1) return -0.9;
      return 0.3 * (nz(u * 5, v * 3, 3) - 0.5);
    }
    case 'photophores': { for (const p of M.dots) if (Math.hypot(x - p[0], y - p[1]) < P.r) return -1; return 0.3 * (nz(u * 5, v * 3, 3) - 0.5); }
  }
  return 0;
}

/**
 * The field for one individual: Nu x Nv values over its grid. Pure (and a worker job through
 * growFieldJob). @param {any} sp a species (fish-species.js) @param {number} seed the individual's
 * @param {any} g its growth grid @param {any} G fishing.json gen
 * @returns {{ Nu: number, Nv: number, field: Float32Array }}
 */
export function growField(sp, seed, g, G) {
  const P = G.patterns, rd = !!P.rd[sp.pattern];
  const Nu = rd ? P.rdGrid : P.drawnGrid;
  const Nv = clamp(Math.round(Nu * g.depth * 1.8), 12, 84);
  const r = stream(seed, 0xf1e1d);
  const nz = makeNoise(Math.floor(r.next() * 1e9));
  const map = makeMap(g), M = marksOf(sp, map);
  const field = new Float32Array(Nu * Nv);
  let B = null;
  if (rd) {
    const p = P.rd[sp.pattern];
    B = grayScott(Nu, Nv, p.F * (0.97 + 0.06 * r.next()), p.K * (0.985 + 0.03 * r.next()), P.rdIters, r,
      clamp(sp.aniso + (r.next() - 0.5) * 0.1, 0.22, 0.78), sp.ds * (0.92 + 0.16 * r.next()));
  }
  for (let j = 0; j < Nv; j++) for (let i = 0; i < Nu; i++) {
    const u = (i + 0.5) / Nu, v = -1 + (2 * (j + 0.5)) / Nv, k = j * Nu + i;
    if (rd) field[k] = B ? smooth(0.3, 0.6, B[k]) : smooth(0.45, 0.62, nz(u * 7, v * 3.5, 4));
    else { const [x, y] = map(u, v); field[k] = patternValue(sp, M, u, v, x, y, nz); }
    if (sp.zone === 'back' && field[k] > 0) field[k] *= 1 - smooth(-0.15, 0.4, v);
    if (sp.zone === 'rear' && field[k] > 0) field[k] *= smooth(0.3, 0.55, u);
  }
  return { Nu, Nv, field };
}

/**
 * Worker job: the field, its buffer handed back. @param {{ sp: any, seed: number, g: any, G: any }} a
 * @returns {{ Nu: number, Nv: number, field: Float32Array, __transfer: ArrayBuffer[] }}
 */
export function growFieldJob(a) {
  const f = growField(a.sp, a.seed, a.g, a.G);
  return { ...f, __transfer: [/** @type {ArrayBuffer} */ (f.field.buffer)] };
}

/**
 * A body cell's colour (sRGB 0..255): the base shaded dark above and pale below (countershading),
 * the second colour where the field is above 0, the accent where below, a little darker at the
 * edges. @param {any} col an individual's colours @param {number} v @param {number} p the field there
 */
export function cellRgb(col, v, p) {
  const l = col.l + v * col.counter * 16, s = col.s - Math.max(0, v) * col.counter * 25;
  let b = hsl(col.h, s, l);
  const mix = (/** @type {number[]} */ a, /** @type {number[]} */ c, /** @type {number} */ t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  if (p > 0) b = mix(b, hsl(col.h2, col.s2, col.l2 + v * col.counter * 8), Math.min(1, p * col.strength));
  else if (p < 0) b = mix(b, col.accent, Math.min(1, -p));
  const e = 1 - 0.22 * Math.pow(Math.abs(v), 5);
  return [b[0] * e, b[1] * e, b[2] * e];
}

/** The field at (u, v) by nearest cell. @param {{ Nu: number, Nv: number, field: Float32Array }} F @param {number} u @param {number} v */
export function fieldAt(F, u, v) {
  const i = clamp(Math.floor(u * F.Nu), 0, F.Nu - 1), j = clamp(Math.floor(((v + 1) / 2) * F.Nv), 0, F.Nv - 1);
  return F.field[j * F.Nu + i];
}
