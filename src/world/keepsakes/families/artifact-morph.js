// @ts-check
// The shape moves for artifact keepsakes (docs/future/12): a baked artifact (tools/bake-find-model.mjs)
// is smoothed, stretched, tapered, twisted, bent and lumped by a handful of seeded numbers, mirrored,
// cleanly cut or chipped, or paired with a smaller twin, and then refitted to its hand size with the
// base on y = 0 and its normals made again. Every move is a function of the numbers, so a kept
// artifact rebuilds exactly. Pure; no Node or DOM.

import { hash32 } from '../../../core/rng.js';
import { lumps, makeWaves, u01 } from './common.js';

/**
 * A baked artifact prepared for morphing: positions, normals and colours as flat arrays, the
 * triangles, and each vertex's neighbours (for smoothing).
 * @typedef {{ n: number, pos: Float32Array, nrm: Float32Array, col: Float32Array, idx: Uint32Array, nbrStart: Uint32Array, nbrs: Uint32Array }} Base
 */

/**
 * Join a model's parts into one prepared base. @param {{ vertices: Float32Array, count: number, indices: Uint32Array }[]} parts
 * @returns {Base}
 */
export function prepareBase(parts) {
  let n = 0, ni = 0;
  for (const p of parts) { n += p.count; ni += p.indices.length; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let at = 0, ia = 0;
  for (const p of parts) {
    for (let i = 0; i < p.count; i++) {
      for (let k = 0; k < 3; k++) { pos[(at + i) * 3 + k] = p.vertices[i * 9 + k]; nrm[(at + i) * 3 + k] = p.vertices[i * 9 + 3 + k]; col[(at + i) * 3 + k] = p.vertices[i * 9 + 6 + k]; }
    }
    for (let k = 0; k < p.indices.length; k++) idx[ia++] = p.indices[k] + at;
    at += p.count;
  }
  // Neighbours: every vertex a triangle edge touches, once.
  const sets = Array.from({ length: n }, () => /** @type {Set<number>} */ (new Set()));
  for (let t = 0; t < ni; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + ((e + 1) % 3)]; if (a !== b) { sets[a].add(b); sets[b].add(a); } }
  const nbrStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) nbrStart[i + 1] = nbrStart[i] + sets[i].size;
  const nbrs = new Uint32Array(nbrStart[n]);
  for (let i = 0; i < n; i++) { let k = nbrStart[i]; for (const j of sets[i]) nbrs[k++] = j; }
  return { n, pos, nrm, col, idx, nbrStart, nbrs };
}

/**
 * What a variant's numbers say about shape.
 * @typedef {{ sx: number, sy: number, sz: number, taper: number, twist: number, bend: number, lump: number,
 *   lumpSeed: number, smooth: number, mirror: number, swell?: number, shear?: number, ripAmp?: number,
 *   ripFreq?: number, lobeAmp?: number, lobeK?: number, lobePhase?: number }} Morph
 * swell: a barrel (+) or a waist (-); shear: a lean; ripAmp and ripFreq: rings along it; lobeAmp,
 * lobeK and lobePhase: lobes round it
 * @typedef {{ theta: number, phi: number, depth: number }} Cut
 */

/**
 * Move a base's positions by the morph; returns positions in the base's own scale. Also returns the
 * vertex normals pushed along with them (only to size lumps; the final normals are made again).
 * @param {Base} B @param {Morph} m @returns {Float32Array}
 */
export function morphPositions(B, m) {
  const N = B.n;
  let P = Float32Array.from(B.pos);
  // Wear: a few passes of pulling each vertex toward the middle of its neighbours rounds the baked edges.
  for (let it = 0; it < m.smooth; it++) {
    const Q = new Float32Array(P);
    for (let i = 0; i < N; i++) {
      const a = B.nbrStart[i], b = B.nbrStart[i + 1];
      if (b === a) continue;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let j = a; j < b; j++) s += P[B.nbrs[j] * 3 + k];
        Q[i * 3 + k] = P[i * 3 + k] * 0.5 + (s / (b - a)) * 0.5;
      }
    }
    P = Q;
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9) / 2;
  const hy = ((hi[1] - lo[1]) / 2 / half) * m.sy;
  const waves = makeWaves((i) => u01(hash32(m.lumpSeed, i)), 0, 5, [1.2, 3.2], 1);
  for (let i = 0; i < N; i++) {
    let x = (P[i * 3] - c[0]) / half, y = (P[i * 3 + 1] - c[1]) / half, z = (P[i * 3 + 2] - c[2]) / half;
    const dl = Math.hypot(x, y, z) || 1;
    const d = m.lump ? lumps([x / dl, y / dl, z / dl], waves) * m.lump : 0;
    x *= m.sx; y *= m.sy; z *= m.sz;
    const v = Math.max(-1, Math.min(1, y / Math.max(hy, 1e-6)));
    const f = Math.max(0.25, 1 + m.taper * v);
    x *= f; z *= f;
    // Round the profile: a barrel or a waist, rings along it, lobes round it.
    const radial = (1 + (m.swell ?? 0) * (1 - v * v)) * (1 + (m.ripAmp ?? 0) * Math.sin((m.ripFreq ?? 0) * (v + 1) * Math.PI)) * (1 + (m.lobeAmp ?? 0) * Math.cos((m.lobeK ?? 0) * Math.atan2(z, x) + (m.lobePhase ?? 0)));
    x *= radial; z *= radial;
    const a = m.twist * v, ca = Math.cos(a), sa = Math.sin(a);
    [x, z] = [x * ca - z * sa, x * sa + z * ca];
    x += m.bend * v * v * hy + (m.shear ?? 0) * y;
    x += B.nrm[i * 3] * d; y += B.nrm[i * 3 + 1] * d; z += B.nrm[i * 3 + 2] * d;
    if (m.mirror) x = -x;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
  }
  return P;
}

/**
 * Cut one side off by a plane, flattening whatever lies beyond it onto the plane (the break face).
 * Returns each vertex's flag (1 = on the cut) and the plane's outward normal.
 * @param {Float32Array} P positions, changed in place @param {Cut} cut @returns {{ flag: Uint8Array, normal: number[] }}
 */
export function cutPositions(P, cut) {
  const N = P.length / 3;
  const dir = [Math.sin(cut.phi) * Math.cos(cut.theta), Math.cos(cut.phi), Math.sin(cut.phi) * Math.sin(cut.theta)];
  let smin = Infinity, smax = -Infinity;
  for (let i = 0; i < N; i++) { const s = P[i * 3] * dir[0] + P[i * 3 + 1] * dir[1] + P[i * 3 + 2] * dir[2]; smin = Math.min(smin, s); smax = Math.max(smax, s); }
  const d = smax - cut.depth * (smax - smin);
  const flag = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const s = P[i * 3] * dir[0] + P[i * 3 + 1] * dir[1] + P[i * 3 + 2] * dir[2];
    if (s > d) { flag[i] = 1; for (let k = 0; k < 3; k++) P[i * 3 + k] -= (s - d) * dir[k]; }
  }
  return { flag, normal: dir };
}

/**
 * Add a smaller twin grown against the object's side. Returns the doubled arrays; the second copy
 * is turned by yaw, scaled, and stood on the same base.
 * @param {Float32Array} P @param {Float32Array} col @param {Uint32Array} idx @param {Uint8Array} flag
 * @param {number} scale @param {number} yaw
 */
export function addTwin(P, col, idx, flag, scale, yaw) {
  const N = P.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const Q = new Float32Array(N * 3);
  let qlo = Infinity, qhi = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = (P[i * 3] - cx) * scale, z = (P[i * 3 + 2] - cz) * scale;
    Q[i * 3] = cy * x + sy * z; Q[i * 3 + 1] = (P[i * 3 + 1] - lo[1]) * scale + lo[1]; Q[i * 3 + 2] = -sy * x + cy * z;
    qlo = Math.min(qlo, Q[i * 3]); qhi = Math.max(qhi, Q[i * 3]);
  }
  // Its near edge overlaps the first's far edge by a fifth of its width.
  const shift = hi[0] - qlo - (qhi - qlo) * 0.2;
  for (let i = 0; i < N; i++) { Q[i * 3] += shift; Q[i * 3 + 2] += cz; }
  const P2 = new Float32Array(N * 6), C2 = new Float32Array(N * 6), I2 = new Uint32Array(idx.length * 2), F2 = new Uint8Array(N * 2);
  P2.set(P); P2.set(Q, N * 3); C2.set(col); C2.set(col, N * 3); F2.set(flag); F2.set(flag, N);
  I2.set(idx);
  for (let k = 0; k < idx.length; k++) I2[idx.length + k] = idx[k] + N;
  return { P: P2, col: C2, idx: I2, flag: F2 };
}

/**
 * Refit to a size (largest extent, meters), centred on x and z with the base on y = 0, and build
 * the creature pass's vertex layout (position, normal, albedo) with smooth normals made again.
 * Vertices flagged as a cut face take the cut's flat normal.
 * @param {Float32Array} P @param {Float32Array} col @param {Uint32Array} idx @param {number} sizeM
 * @param {{ flag: Uint8Array, normal: number[] } | null} cut @param {boolean} [flip] turn the winding over (a mirrored object)
 * @returns {{ vertices: Float32Array, count: number, indices: Uint32Array }}
 */
export function finish(P, col, idx, sizeM, cut, flip = false) {
  const N = P.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
  const sc = sizeM / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
  const mid = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const V = new Float32Array(N * 9);
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { V[i * 9 + k] = (P[i * 3 + k] - mid[k]) * sc; V[i * 9 + 6 + k] = col[i * 3 + k]; }
  const I = Uint32Array.from(idx);
  if (flip) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  // Smooth normals: each triangle's area-weighted normal added to its three vertices.
  const Nn = new Float32Array(N * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = V[b * 9] - V[a * 9], uy = V[b * 9 + 1] - V[a * 9 + 1], uz = V[b * 9 + 2] - V[a * 9 + 2];
    const vx = V[c * 9] - V[a * 9], vy = V[c * 9 + 1] - V[a * 9 + 1], vz = V[c * 9 + 2] - V[a * 9 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { Nn[v * 3] += nx; Nn[v * 3 + 1] += ny; Nn[v * 3 + 2] += nz; }
  }
  // Outward overall: if most normals point in toward the middle, the winding was the other way.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += V[i * 9] / N; cy += V[i * 9 + 1] / N; cz += V[i * 9 + 2] / N; }
  let out = 0;
  for (let i = 0; i < N; i++) out += Nn[i * 3] * (V[i * 9] - cx) + Nn[i * 3 + 1] * (V[i * 9 + 1] - cy) + Nn[i * 3 + 2] * (V[i * 9 + 2] - cz);
  const sgn = out < 0 ? -1 : 1;
  if (sgn < 0) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  for (let i = 0; i < N; i++) {
    let nx = Nn[i * 3] * sgn, ny = Nn[i * 3 + 1] * sgn, nz = Nn[i * 3 + 2] * sgn;
    if (cut?.flag[i]) { nx = cut.normal[0]; ny = cut.normal[1]; nz = cut.normal[2]; }
    if (!(Math.hypot(nx, ny, nz) > 0)) { nx = 0; ny = 1; nz = 0; }
    const l = Math.hypot(nx, ny, nz);
    V[i * 9 + 3] = nx / l; V[i * 9 + 4] = ny / l; V[i * 9 + 5] = nz / l;
  }
  return { vertices: V, count: N, indices: I };
}
