// @ts-check
// Shared pieces for keepsake families (docs/future/12): fixed, numbered draws from one hash (so a
// number added later with a new gen leaves the others where they were), and small mesh helpers in
// the creature pass's layout (position, normal, linear albedo).

import { hash32 } from '../../../core/rng.js';

/** @param {number} h */
export const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
export const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;
/** Four decimals keep a saved keepsake small. @param {number} x */
export const r4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * Numbered draws from one hash. @param {number} h0
 */
export function draws(h0) {
  const u = (/** @type {number} */ i) => u01(hash32(h0, i));
  return {
    u,
    /** A number in a range. @param {number[]} r @param {number} i */
    range: (r, i) => r4(lerp(r, u(i))),
    /** A whole number in a range. @param {number[]} r @param {number} i */
    int: (r, i) => Math.round(lerp(r, u(i))),
    /** One of a list. @template T @param {T[]} list @param {number} i @returns {T} */
    pick: (list, i) => list[Math.min(list.length - 1, Math.floor(u(i) * list.length))],
    /** A colour from a palette, its lightness nudged. @param {number[]} c @param {number} jitter @param {number} i */
    tone: (c, jitter, i) => { const k = 1 + jitter * (u(i) * 2 - 1); return c.map((x) => r4(Math.min(1, x * k))); },
    /** True with a chance. @param {number} p @param {number} i */
    chance: (p, i) => u(i) < p,
  };
}

/**
 * A grid of points (rows by cols, cols wrapping round) as a mesh with smooth normals, each vertex
 * coloured. Normals point away from each row's centre. Rows are closed to a point at either end
 * when capStart or capEnd is set.
 * @param {ReturnType<typeof import('../../finds/procedural.js').builder>} b
 * @param {Float32Array} P positions, (rows * cols) * 3 @param {Float32Array} C colours, same layout
 * @param {number} rows @param {number} cols @param {Float32Array} centres rows * 3
 * @param {{ capStart?: boolean, capEnd?: boolean, flip?: boolean }} [o]
 */
export function gridMesh(b, P, C, rows, cols, centres, o = {}) {
  const at = (/** @type {number} */ i, /** @type {number} */ j) => (i * cols + ((j + cols) % cols)) * 3;
  let base = -1;
  for (let i = 0; i < rows; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(rows - 1, i + 1);
    for (let j = 0; j < cols; j++) {
      const k = at(i, j), a0 = at(i0, j), a1 = at(i1, j), p0 = at(i, j - 1), p1 = at(i, j + 1);
      const dt = [P[a1] - P[a0], P[a1 + 1] - P[a0 + 1], P[a1 + 2] - P[a0 + 2]];
      const dp = [P[p1] - P[p0], P[p1 + 1] - P[p0 + 1], P[p1 + 2] - P[p0 + 2]];
      let nx = dt[1] * dp[2] - dt[2] * dp[1], ny = dt[2] * dp[0] - dt[0] * dp[2], nz = dt[0] * dp[1] - dt[1] * dp[0];
      const ox = P[k] - centres[i * 3], oy = P[k + 1] - centres[i * 3 + 1], oz = P[k + 2] - centres[i * 3 + 2];
      if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (!(nx || ny || nz)) { nx = ox; ny = oy; nz = oz; }
      const v = b.vert([P[k], P[k + 1], P[k + 2]], [nx, ny, nz], [C[k], C[k + 1], C[k + 2]]);
      if (base < 0) base = v;
    }
  }
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * cols + j, c1 = base + i * cols + ((j + 1) % cols), c = base + (i + 1) * cols + j, d = base + (i + 1) * cols + ((j + 1) % cols);
      if (o.flip) { b.tri(a, c1, c); b.tri(c1, d, c); } else { b.tri(a, c, c1); b.tri(c1, c, d); }
    }
  }
  const cap = (/** @type {number} */ i, /** @type {boolean} */ start) => {
    const n = start ? -1 : 1;
    const t = b.vert([centres[i * 3], centres[i * 3 + 1], centres[i * 3 + 2]], [0, n, 0], [C[i * cols * 3], C[i * cols * 3 + 1], C[i * cols * 3 + 2]]);
    for (let j = 0; j < cols; j++) {
      const a = base + i * cols + j, c1 = base + i * cols + ((j + 1) % cols);
      if (start !== !!o.flip) b.tri(t, a, c1); else b.tri(t, c1, a);
    }
  };
  if (o.capStart) cap(0, true);
  if (o.capEnd) cap(rows - 1, false);
  return base;
}

/**
 * A closed body like a pebble or a starfish: a sphere's rings from top to bottom, each point placed
 * and coloured by `at`, fitted to size and capped at both ends. at(dir, th, ph) gets the sphere
 * direction and its angles (th from the top) and returns the point and its colour.
 * @param {ReturnType<typeof import('../../finds/procedural.js').builder>} b
 * @param {number} rows @param {number} cols @param {number} size largest extent (m)
 * @param {(dir: number[], th: number, ph: number) => { p: number[], c: number[] }} at
 */
export function closedBody(b, rows, cols, size, at) {
  const P = new Float32Array((rows + 1) * cols * 3), C = new Float32Array(P.length), cen = new Float32Array((rows + 1) * 3);
  for (let i = 0; i <= rows; i++) {
    // Rings stop short of the poles, which are capped, so no ring shrinks to a point.
    const th = ((i + 0.5) / (rows + 1)) * Math.PI;
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const r = at([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)], th, ph);
      const k = (i * cols + j) * 3;
      P.set(r.p, k); C.set(r.c, k);
      sx += r.p[0]; sy += r.p[1]; sz += r.p[2];
    }
    cen.set([sx / cols, sy / cols, sz / cols], i * 3);
  }
  fitTo(P, cen, size);
  // Outward from the body's middle height, so normals face out on flat and armed bodies alike.
  let my = 0;
  for (let i = 0; i <= rows; i++) my += cen[i * 3 + 1];
  my /= rows + 1;
  const mid = new Float32Array(cen.length);
  for (let i = 0; i <= rows; i++) mid.set([cen[i * 3], my, cen[i * 3 + 2]], i * 3);
  const first = gridMesh(b, P, C, rows + 1, cols, mid);
  for (const [i, up] of [[0, 1], [rows, -1]]) {
    const t = b.vert([cen[i * 3], cen[i * 3 + 1], cen[i * 3 + 2]], [0, up, 0], [C[i * cols * 3], C[i * cols * 3 + 1], C[i * cols * 3 + 2]]);
    for (let j = 0; j < cols; j++) {
      const a = first + i * cols + j, c = first + i * cols + ((j + 1) % cols);
      if (up > 0) b.tri(t, c, a); else b.tri(t, a, c);
    }
  }
}

/**
 * Scale positions so the largest extent is size, centred on x and z (the builder sets the base on
 * y = 0). @param {Float32Array} P @param {Float32Array} centres @param {number} size
 */
export function fitTo(P, centres, size) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k += 3) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], P[k + r]); hi[r] = Math.max(hi[r], P[k + r]); }
  const sc = size / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
  const mid = [(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2];
  for (let k = 0; k < P.length; k += 3) for (let r = 0; r < 3; r++) P[k + r] = (P[k + r] - mid[r]) * sc;
  for (let k = 0; k < centres.length; k += 3) for (let r = 0; r < 3; r++) centres[k + r] = (centres[k + r] - mid[r]) * sc;
}

/**
 * A smooth lumpy value on a sphere direction, from a few seeded waves (no noise library).
 * @param {number[]} dir unit vector @param {number[][]} waves [ax, ay, az, freq, phase, amp] each
 */
export function lumps(dir, waves) {
  let s = 0;
  for (const w of waves) s += w[5] * Math.sin(w[3] * (dir[0] * w[0] + dir[1] * w[1] + dir[2] * w[2]) + w[4]);
  return s;
}

/**
 * Seeded waves for lumps(). @param {(i: number) => number} u draws @param {number} at first draw index
 * @param {number} n how many @param {number[]} freq range @param {number} amp
 */
export function makeWaves(u, at, n, freq, amp) {
  /** @type {number[][]} */ const out = [];
  for (let i = 0; i < n; i++) {
    const a = u(at + i * 4) * Math.PI * 2, z = u(at + i * 4 + 1) * 2 - 1, s = Math.sqrt(1 - z * z);
    out.push([s * Math.cos(a), z, s * Math.sin(a), lerp(freq, u(at + i * 4 + 2)), u(at + i * 4 + 3) * Math.PI * 2, amp / (1 + i * 0.6)]);
  }
  return out;
}
