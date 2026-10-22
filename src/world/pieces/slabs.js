// @ts-check
// Rounded slab meshes (docs 09: "Each stone is an instance of a rounded-slab mesh from a small
// library of 16 shapes"): the pond's stepping stones and the treads of Steps. Each is a seeded,
// gently wobbled superellipse footprint 1 mesh unit long (along z), with a nearly flat, slightly
// domed and tilted top that rounds over a bevel into sides that batter out a little and then fall
// straight down a long skirt to y = 0. The skirt is long because a pond stone stands on a bed up to a
// meter below the water while being only half a meter long; the draw pass sinks what it does not
// need into the ground. Seeded from the recipe, so the shapes are the same on every load. Vertex
// albedo is linear and physical (docs/05): weathered grey stone, mottled, the top a touch lighter and
// smoother, the sides stained darker toward the skirt; the palette paints at tonemap.

import { hash32 } from '../../core/rng.js';

/** @typedef {import('./meshes.js').Mesh} Mesh */
/** @typedef {{ mesh: Mesh, hx: number, hz: number, hy: number, cap: number }} SlabShape hx, hz: the top's half width and length; hy: the top's height; cap: how far below the top the sides turn straight (mesh units) */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** A soft 0..1 field from a few seeded waves (mottling only: render, not simulation). @param {number[]} p @param {number} ph */
const waves = (p, ph) => 0.5 + 0.5 * Math.sin(p[0] * 1.7 + ph) * Math.sin(p[1] * 2.3 + ph * 1.3) * Math.sin(p[2] * 1.9 + ph * 0.7);

/**
 * Bake one slab: its footprint, then ring by ring from the top's middle out over the bevel and down
 * the sides and skirt, closed by a flat bottom; normals from the faces; then its tone.
 * @param {any} S pieces.json stepping.slab @param {number} i which shape
 * @returns {SlabShape}
 */
export function bakeSlab(S, i) {
  const h = hash32(S.seed, i);
  const r = (/** @type {number} */ k, /** @type {number[]} */ range) => range[0] + (range[1] - range[0]) * u01(hash32(h, k));
  const A = S.around, T = S.topRings, B = S.bevelRows;
  const TAU = Math.PI * 2;

  // Footprint: a superellipse |x/a|^p + |z/b|^p = 1, its outline wobbled by a few low harmonics, then
  // set exactly 1 long along z and centered.
  const a = r(1, S.widthShare) * 0.5, b = 0.5, p = r(2, S.power);
  const nh = S.wobbleHarmonics[0] + Math.floor(u01(hash32(h, 3)) * (S.wobbleHarmonics[1] - S.wobbleHarmonics[0] + 1));
  const harm = Array.from({ length: nh }, (_, k) => ({ k: k + 2, ph: u01(hash32(h, 30, k)) * TAU, amp: S.wobble * (0.5 + 0.5 * u01(hash32(h, 31, k))) }));
  /** @type {number[][]} */ let foot = [];
  for (let j = 0; j < A; j++) {
    const th = (j / A) * TAU, c = Math.cos(th), s = Math.sin(th);
    let rad = (Math.abs(c / a) ** p + Math.abs(s / b) ** p) ** (-1 / p);
    for (const w of harm) rad *= 1 + w.amp * Math.sin(w.k * th + w.ph);
    foot.push([c * rad, s * rad]);
  }
  let xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  for (const [x, z] of foot) { xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); }
  const len = zhi - zlo, fx = (xlo + xhi) / 2, fz = (zlo + zhi) / 2;
  foot = foot.map(([x, z]) => [(x - fx) / len, (z - fz) / len]);
  const hx = (xhi - xlo) / len / 2;
  /** A footprint point moved in toward the middle by d. @param {number[]} P @param {number} d */
  const inset = (P, d) => { const k = Math.max(0.05, 1 - d / Math.hypot(P[0], P[1])); return [P[0] * k, P[1] * k]; };

  // The top: a slight dome and a slight tilt; the bevel's radius and the cap's thickness.
  const dome = r(4, S.domeShare);
  const tilt = Math.tan((r(5, S.tiltDeg) * Math.PI) / 180), psi = u01(hash32(h, 6)) * TAU;
  const tx = tilt * Math.cos(psi), tz = tilt * Math.sin(psi);
  const rb = r(7, S.bevelShare), cap = Math.max(r(8, S.capShare), rb * 1.6);
  const hy = S.skirtUnits + cap;
  const surf = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ f) => dome * (1 - f * f) + tx * x + tz * z;
  const rim = foot.map((P) => inset(P, rb));
  // Lift the top so its highest point is exactly hy.
  let top = dome;
  for (let t = 1; t <= T; t++) for (const Q of rim) top = Math.max(top, surf(Q[0] * t / T, Q[1] * t / T, t / T));
  const lift = hy - top;
  const eRim = rim.map((Q) => lift + surf(Q[0], Q[1], 1));

  // A gentle lumpiness on the sides, fading in below the bevel.
  const lp1 = u01(hash32(h, 9)) * TAU, lp2 = u01(hash32(h, 10)) * TAU;
  const lump = (/** @type {number} */ j, /** @type {number} */ y) => {
    const th = (j / A) * TAU;
    return 1 + S.lump * Math.sin(th * 3 + lp1 + y * 2.1) * Math.sin(th * 2 - lp2 + y * 1.3);
  };

  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  const put = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => { v.push(x, y, z, 0, 0, 0, 0, 0, 0); return v.length / 9 - 1; };
  /** @type {number[]} */ const rings = [];
  const mid = put(0, lift + dome, 0);
  // Top: concentric rings out to the bevel's inner edge.
  for (let t = 1; t <= T; t++) {
    const f = t / T;
    rings.push(v.length / 9);
    for (const Q of rim) put(Q[0] * f, lift + surf(Q[0] * f, Q[1] * f, f), Q[1] * f);
  }
  // Bevel: a quarter round from the top's edge out to the footprint, rb lower.
  for (let k = 1; k <= B; k++) {
    const phi = (k / B) * (Math.PI / 2), d = rb * (1 - Math.sin(phi)), dy = rb * (1 - Math.cos(phi));
    rings.push(v.length / 9);
    for (let j = 0; j < A; j++) { const Q = inset(foot[j], d); put(Q[0], eRim[j] - dy, Q[1]); }
  }
  // Cap side: down to the cap's depth, battering outward.
  const capRows = [0.5, 1];
  for (const t of capRows) {
    rings.push(v.length / 9);
    for (let j = 0; j < A; j++) {
      const y = eRim[j] - rb - (cap - rb) * t;
      const k = (1 + S.batterShare * t) * (1 + (lump(j, y) - 1) * t);
      put(foot[j][0] * k, y, foot[j][1] * k);
    }
  }
  // Skirt: straight down to y = 0.
  for (const s of [0, 1, 2]) {
    rings.push(v.length / 9);
    for (let j = 0; j < A; j++) {
      const yc = eRim[j] - cap - 0.12;
      const y = s === 0 ? yc : s === 1 ? yc * 0.45 : 0;
      const k = (1 + S.batterShare) * lump(j, y);
      put(foot[j][0] * k, y, foot[j][1] * k);
    }
  }
  const bot = put(0, 0, 0);

  // Faces, each wound to look outward (the top and sides away from a point a unit below the top;
  // the bottom down).
  const tri = (/** @type {number} */ q0, /** @type {number} */ q1, /** @type {number} */ q2, /** @type {number[]} */ out) => {
    const e1 = [0, 1, 2].map((k) => v[q1 * 9 + k] - v[q0 * 9 + k]), e2 = [0, 1, 2].map((k) => v[q2 * 9 + k] - v[q0 * 9 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const o = out.length ? out : [0, 1, 2].map((k) => (v[q0 * 9 + k] + v[q1 * 9 + k] + v[q2 * 9 + k]) / 3 - (k === 1 ? hy - 1 : 0));
    if (f[0] * o[0] + f[1] * o[1] + f[2] * o[2] < 0) idx.push(q0, q2, q1); else idx.push(q0, q1, q2);
  };
  for (let j = 0; j < A; j++) tri(mid, rings[0] + j, rings[0] + ((j + 1) % A), []);
  for (let n = 0; n < rings.length - 1; n++) for (let j = 0; j < A; j++) {
    const q = rings[n] + j, qn = rings[n] + ((j + 1) % A), d = rings[n + 1] + j, dn = rings[n + 1] + ((j + 1) % A);
    tri(q, d, qn, []); tri(qn, d, dn, []);
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < A; j++) tri(bot, last + j, last + ((j + 1) % A), [0, -1, 0]);

  const count = v.length / 9;
  const V = new Float32Array(v);
  const acc = new Float64Array(count * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [q0, q1, q2] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => V[q1 * 9 + k] - V[q0 * 9 + k]), e2 = [0, 1, 2].map((k) => V[q2 * 9 + k] - V[q0 * 9 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const q of [q0, q1, q2]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += f[k];
  }
  for (let q = 0; q < count; q++) {
    const l = Math.hypot(acc[q * 3], acc[q * 3 + 1], acc[q * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) V[q * 9 + 3 + k] = acc[q * 3 + k] / l;
  }

  // Tone: mottled at two scales, the top a touch lighter and smoother, the sides stained toward the
  // skirt (below the top's lowest edge by more than stainUnits it reads as underside).
  const M = S.mottle;
  const ph = u01(hash32(h, 11)) * TAU, ph2 = u01(hash32(h, 12)) * TAU;
  const edgeLo = Math.min(...eRim);
  for (let q = 0; q < count; q++) {
    const o = q * 9;
    const P = [V[o], V[o + 1], V[o + 2]];
    const up = Math.min(1, Math.max(0, (V[o + 4] - 0.6) / 0.3));
    const broad = waves(P.map((x) => x * M.broadPerUnit), ph), fine = waves(P.map((x) => x * M.finePerUnit), ph2);
    const tone = (1 + S.topLift * up) * (1 + M.broad * (broad - 0.5) * 2 + M.fine * (1 - S.topSmooth * up) * (fine - 0.5) * 2);
    const warm = M.hue * (broad - 0.5) * 2;
    const hue = [1 + warm, 1, 1 - warm];
    const below = Math.min(1, Math.max(0, (edgeLo - P[1]) / S.stainUnits));
    const under = Math.min(1, below * below + Math.max(0, -V[o + 4]) * 0.6);
    for (let c = 0; c < 3; c++) V[o + 6 + c] = (S.albedo[c] * hue[c] * (1 - under) + S.underside[c] * under) * tone;
  }
  return { mesh: { vertices: V, count, indices: Uint32Array.from(idx) }, hx, hz: 0.5, hy, cap };
}

/**
 * Every slab shape. @param {any} recipe pieces.json
 * @returns {SlabShape[]}
 */
export function slabShapes(recipe) {
  const S = recipe.stepping.slab;
  return Array.from({ length: S.count }, (_, i) => bakeSlab(S, i));
}
