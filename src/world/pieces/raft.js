// @ts-check
// The reed raft (the turtles' gift; doc 09): a mat of reed bundles laid side by side and tied with
// bands, staked on open fresh water. It rides the water as it is now, a few centimetres proud, and
// settles on the bed when a pond drops away under it; it never keeps a water depth. Turtles bask on
// it and herons stand on it (pieces.seats). Here: its shapes, baked from the recipe on load, each 1
// mesh unit long along z with its base on y = 0 (the draw pass scales it to the raft's length), and
// where it floats. Vertex albedo is linear and physical (docs/05): dry straw, darker bands and cut
// ends. Pure.
//
// A record: { id, kind: 'raft', x, z, yaw, seed, size, placedHour }: size its length (m).

import { hash32 } from '../../core/rng.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
const span = (r, u) => r[0] + (r[1] - r[0]) * u;

/**
 * One raft shape: `bundles` reed bundles side by side across its width, each a round sheaf that
 * thins to its cut ends, a little longer or shorter and higher or lower than its neighbours, and
 * pinched in where the bands tie it.
 * @param {any} S pieces.json raft.shape @param {number} i which shape
 * @returns {{ mesh: Mesh, hx: number, hz: number, hy: number }}
 */
export function bakeRaft(S, i) {
  const h = hash32(S.seed, i);
  const width = span(S.widthShare, u01(hash32(h, 1)));
  const n = S.bundles, A = S.around, L = S.rings;
  const r0 = (width / n) * 0.5 * S.fatten;
  const bands = Array.from({ length: S.bands }, (_, b) => (b + 0.5) / S.bands - 0.5 + (u01(hash32(h, 30, b)) - 0.5) * 0.06);
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  for (let b = 0; b < n; b++) {
    const hb = hash32(h, 10, b);
    const cx = -width / 2 + (b + 0.5) * (width / n);
    const r = r0 * span([0.88, 1.08], u01(hash32(hb, 1)));
    // The outer bundles are shorter, so the mat is rounded at its corners.
    const edge = Math.abs(cx) / (width / 2);
    const half = 0.5 * (1 - S.round * edge * edge) * span([0.94, 1], u01(hash32(hb, 2)));
    const dz = (u01(hash32(hb, 3)) - 0.5) * 0.04, lift = (u01(hash32(hb, 4)) - 0.5) * r * 0.25;
    const ph = u01(hash32(hb, 5)) * 6.28;
    const first = v.length / 9;
    for (let k = 0; k < L; k++) {
      const t = k / (L - 1), z = dz + (t - 0.5) * 2 * half;
      // Thinning toward the cut ends, and pinched where a band ties it.
      const end = Math.min(1, (1 - Math.abs(2 * t - 1)) / S.taper);
      let pinch = 0;
      for (const bz of bands) pinch = Math.max(pinch, Math.exp(-((z - bz) ** 2) / (S.bandM * S.bandM)));
      const rr = r * (0.55 + 0.45 * Math.sqrt(end)) * (1 - S.pinch * pinch);
      const cy = r + lift;
      for (let j = 0; j < A; j++) {
        const a = (j / A) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        // Reed stems: fine streaks along the bundle, each stem a little lighter or darker, and the
        // odd broken one across it; the bands darker; the cut ends browner.
        const stem = u01(hash32(hb, 40, j)) - 0.5;
        const streak = 1 + S.streak * (Math.sin(a * 7 + ph) * Math.sin(a * 3 + ph * 2) + 1.6 * stem) + 0.05 * Math.sin(z * 90 + j * 1.7);
        const tone = (1 - S.bandDark * pinch) * streak;
        const cut = 1 - end;
        const alb = [0, 1, 2].map((ch) => (S.albedo[ch] * (1 - cut) + S.endAlbedo[ch] * cut) * tone);
        v.push(cx + c * rr, cy + s * rr, z, c, s, 0, alb[0], alb[1], alb[2]);
      }
    }
    for (let k = 0; k < L - 1; k++) for (let j = 0; j < A; j++) {
      const a = first + k * A + j, bb = first + k * A + ((j + 1) % A), c = a + A, d = bb + A;
      idx.push(a, bb, c, bb, d, c);
    }
    // Cut ends: a fan to the middle.
    for (const e of [0, L - 1]) {
      const ring = first + e * A;
      let mx = 0, my = 0, mz = 0;
      for (let j = 0; j < A; j++) { mx += v[(ring + j) * 9] / A; my += v[(ring + j) * 9 + 1] / A; mz += v[(ring + j) * 9 + 2] / A; }
      const mid = v.length / 9, nz = e ? 1 : -1;
      v.push(mx, my, mz, 0, 0, nz, S.endAlbedo[0], S.endAlbedo[1], S.endAlbedo[2]);
      for (let j = 0; j < A; j++) {
        const a = ring + j, bb = ring + ((j + 1) % A);
        if (e) idx.push(mid, a, bb); else idx.push(mid, bb, a);
      }
    }
  }
  const V = new Float32Array(v), count = v.length / 9;
  let hy = 0, zlo = Infinity, zhi = -Infinity;
  for (let q = 0; q < count; q++) { hy = Math.max(hy, V[q * 9 + 1]); zlo = Math.min(zlo, V[q * 9 + 2]); zhi = Math.max(zhi, V[q * 9 + 2]); }
  // Exactly 1 long.
  const len = zhi - zlo, zc = (zlo + zhi) / 2;
  for (let q = 0; q < count; q++) {
    const o = q * 9;
    V[o] /= len; V[o + 1] /= len; V[o + 2] = (V[o + 2] - zc) / len;
  }
  return { mesh: { vertices: V, count, indices: Uint32Array.from(idx) }, hx: width / 2 / len, hz: 0.5, hy: hy / len };
}

/** Every raft shape. @param {any} recipe pieces.json */
export function raftShapes(recipe) {
  return Array.from({ length: recipe.raft.shape.count }, (_, i) => bakeRaft(recipe.raft.shape, i));
}

/**
 * A new raft at a point on the water: its length, turn and shape from a seed of the island's piece
 * seed and its number. @param {number} piecesSeed @param {number} n its number (the id is p<n>)
 * @param {number} x @param {number} z @param {number} hour @param {any} R pieces.json raft
 */
export function makeRaft(piecesSeed, n, x, z, hour, R) {
  const seed = hash32(piecesSeed, n, 0x4af7);
  return { id: `p${n}`, kind: /** @type {'raft'} */ ('raft'), x, z, yaw: u01(hash32(seed, 1)) * 2 * Math.PI, seed, size: span(R.sizeM, u01(hash32(seed, 2))), placedHour: hour };
}

/**
 * Where a raft's base rests now: floating at the water's surface (sunk by draftM of its depth),
 * else, where the water has gone, on the highest ground under it.
 * @param {{ x: number, z: number, yaw: number, size: number }} p @param {{ hx: number }} sh its shape
 * @param {(x: number, z: number) => number} ground @param {(x: number, z: number) => number} depth water over a point now
 * @param {any} R pieces.json raft
 * @returns {{ y: number, afloat: boolean }}
 */
export function raftRest(p, sh, ground, depth, R) {
  const d = depth(p.x, p.z), g = ground(p.x, p.z);
  // The ground under its middle and four points toward its rim (its own axes turned by its yaw).
  const ax = Math.sin(p.yaw), az = Math.cos(p.yaw), w = sh.hx * p.size * 0.8, l = 0.4 * p.size;
  let high = g;
  for (const [u, t] of [[w, 0], [-w, 0], [0, l], [0, -l]]) high = Math.max(high, ground(p.x + az * u + ax * t, p.z - ax * u + az * t));
  const surface = g + d, base = surface - R.draftM;
  return base > high ? { y: base, afloat: d > R.draftM } : { y: high, afloat: false };
}
