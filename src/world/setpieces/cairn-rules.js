// @ts-check
// The cairn builder's shapes (docs/future/14): where the trail of cairns runs, and each cairn as a
// stack of flat stones baked in code. Pure: the same ground, seed and recipe give the same trail and
// the same stones. Numbers: recipes/setpieces/cairns.json trail and look.

import { hash32 } from '../../core/rng.js';
import { pebbleMesh } from '../pack/pickup-meshes.js';

/** @typedef {import('../pack/pickup-meshes.js').Mesh} Mesh */

/** A seeded share 0..1. @param {number} seed @param {...number} k */
const u01 = (seed, ...k) => (hash32(seed, ...k) >>> 8) / 16777216;

/**
 * Plan the trail: from `from` (the camp pad, or the island's middle), out along the longest line of
 * dry land (of `dirs` directions, ties by seed), or toward `end` when one is given (the old keeper's
 * cache); `count` points, the first startM out, evenly spaced to just short of the shore (or the
 * end), each nudged onto dry land at least landM up if it fell in water. Returns [x, z] rounded to
 * centimetres, or null when there is no land to run on.
 * @param {{ x: number, z: number }} from @param {(x: number, z: number) => number} ground land height (the sea is 0)
 * @param {any} T recipes/setpieces/cairns.json trail @param {number} seed
 * @param {{ x: number, z: number } | null} [end] @param {number} [dirs]
 * @returns {[number, number][] | null}
 */
export function planTrail(from, ground, T, seed, end = null, dirs = 24) {
  const dry = (/** @type {number} */ x, /** @type {number} */ z) => ground(x, z) >= T.landM;
  const step = T.stepM ?? 1;
  /** How far dry land runs from `from` along (dx, dz), stepping over small ponds (up to 3 m). @param {number} dx @param {number} dz */
  const runOf = (dx, dz) => {
    let last = 0, wet = 0;
    for (let s = step; s <= T.endSearchM; s += step) {
      if (dry(from.x + dx * s, from.z + dz * s)) { last = s; wet = 0; } else if ((wet += step) > 3) break;
    }
    return last;
  };
  let dx = 0, dz = 1, len = 0;
  if (end) {
    const l = Math.hypot(end.x - from.x, end.z - from.z);
    if (l < 1e-3) return null;
    dx = (end.x - from.x) / l; dz = (end.z - from.z) / l; len = l;
  } else {
    const turn = u01(seed, 1) * 2 * Math.PI;
    for (let i = 0; i < dirs; i++) {
      const a = turn + (i / dirs) * 2 * Math.PI, ax = Math.sin(a), az = Math.cos(a);
      const r = runOf(ax, az);
      if (r > len + 1e-6) { len = r; dx = ax; dz = az; }
    }
    // Stop short of the shore.
    len -= T.shoreM ?? 4;
  }
  const n = T.count;
  if (len < T.startM + 1) return null;
  const gap = n > 1 ? Math.max(0, (len - T.startM) / (n - 1)) : 0;
  /** @type {[number, number][]} */ const out = [];
  for (let i = 0; i < n; i++) {
    // A little to one side and the other, so the trail wanders.
    const side = (u01(seed, 10, i) - 0.5) * Math.min(4, gap * 0.5);
    let x = from.x + dx * (T.startM + gap * i) - dz * side, z = from.z + dz * (T.startM + gap * i) + dx * side;
    if (!dry(x, z)) {
      // Nudged onto the nearest dry ground within 4 m.
      let best = null;
      for (let r = 0.5; r <= 4 && !best; r += 0.5) for (let k = 0; k < 12 && !best; k++) {
        const a = (k / 12) * 2 * Math.PI;
        if (dry(x + Math.sin(a) * r, z + Math.cos(a) * r)) best = [x + Math.sin(a) * r, z + Math.cos(a) * r];
      }
      if (best) { x = best[0]; z = best[1]; }
    }
    out.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
  }
  return out;
}

/**
 * Which way a cairn leans: toward the next on the trail (the last toward the one before, reversed,
 * so it leans on, away from where you came). Radians, as yaw (atan2(x, z)).
 * @param {[number, number][]} trail @param {number} i
 */
export function leanYaw(trail, i) {
  const a = trail[i], b = trail[i + 1] ?? null, p = trail[i - 1] ?? null;
  if (b) return Math.atan2(b[0] - a[0], b[1] - a[1]);
  if (p) return Math.atan2(a[0] - p[0], a[1] - p[1]);
  return 0;
}

/** Linear blend of two colours. @param {number[]} a @param {number[]} b @param {number} t */
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * How much moss a cairn has gathered: none when built, up to mossMax after mossDays game days, in
 * five steps (so its mesh is baked again only now and then). @param {number} ageH @param {any} L look
 */
export const mossOf = (ageH, L) => Math.round(Math.min(1, Math.max(0, ageH / (L.mossDays * 24))) * 5) / 5 * L.mossMax;

/**
 * A cairn: `stones` flat stones stacked, the widest at the bottom, each smaller, turned and nudged a
 * little, the whole leaning leanDeg toward +z (the drawing turns it toward the next cairn); moss on
 * the lower stones by `moss` (0..1 share of the moss colour); a folded letter under the top stone
 * when `letter`. Base on the ground at y 0. @param {number} stones @param {number} seed
 * @param {any} L recipes/setpieces/cairns.json look @param {number} leanDeg @param {number} moss
 * @param {boolean} letter @returns {Mesh}
 */
export function cairnMesh(stones, seed, L, leanDeg, moss, letter) {
  /** @type {{ m: Mesh, dx: number, dy: number, dz: number, yaw: number }[]} */ const parts = [];
  const lean = Math.tan((leanDeg * Math.PI) / 180);
  let y = 0;
  for (let i = 0; i < stones; i++) {
    const t = stones > 1 ? i / (stones - 1) : 0;
    const u = (/** @type {number} */ k) => u01(seed, i, k);
    const w = L.baseM[0] + (L.topM[0] - L.baseM[0]) * t, d = L.baseM[1] + (L.topM[1] - L.baseM[1]) * t;
    const th = L.thickM[0] + (L.thickM[1] - L.thickM[0]) * t;
    const shade = 1 + (u(1) - 0.5) * 2 * L.shade;
    const low = stones > 1 ? 1 - t : 1;
    const col = mix(L.color.map((/** @type {number} */ c) => c * shade), L.moss, moss * low * low);
    const m = pebbleMesh(hash32(seed, 0x5a, i), [w / 2, th / 2, d / 2], L.lump ?? 0.12, col, 0.05);
    const yaw = (u(2) - 0.5) * 2 * (L.turnDeg * Math.PI / 180);
    parts.push({ m, dx: (u(3) - 0.5) * 2 * L.jitterM, dy: y, dz: (u(4) - 0.5) * 2 * L.jitterM + y * lean, yaw });
    y += th * 0.82;
    if (letter && i === stones - 2) {
      const S = L.letter.sizeM;
      parts.push({ m: slabMesh(S[0], S[2], S[1], L.letter.color), dx: 0.02, dy: y - 0.003, dz: y * lean + 0.02, yaw: 0.4 });
    }
  }
  return joinMeshes(parts);
}

/** A thin flat box (the folded letter), base at y 0. @param {number} w @param {number} h @param {number} d @param {number[]} col @returns {Mesh} */
export function slabMesh(w, h, d, col) {
  const v = [], idx = [];
  const faces = [[[0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]], [[0, -1, 0], [[-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1]]],
    [[1, 0, 0], [[1, 0, -1], [1, 0, 1], [1, 1, 1], [1, 1, -1]]], [[-1, 0, 0], [[-1, 0, 1], [-1, 0, -1], [-1, 1, -1], [-1, 1, 1]]],
    [[0, 0, 1], [[1, 0, 1], [-1, 0, 1], [-1, 1, 1], [1, 1, 1]]], [[0, 0, -1], [[-1, 0, -1], [1, 0, -1], [1, 1, -1], [-1, 1, -1]]]];
  for (const [n, q] of faces) {
    const b = v.length / 9;
    for (const c of q) v.push((c[0] * w) / 2, c[1] * h, (c[2] * d) / 2, ...n, ...col);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) };
}

/**
 * Meshes joined into one, each turned about y by its yaw and moved by (dx, dy, dz).
 * @param {{ m: Mesh, dx: number, dy: number, dz: number, yaw: number }[]} parts @returns {Mesh}
 */
export function joinMeshes(parts) {
  const count = parts.reduce((s, p) => s + p.m.count, 0), ni = parts.reduce((s, p) => s + p.m.indices.length, 0);
  const vertices = new Float32Array(count * 9), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw), V = p.m.vertices;
    for (let i = 0; i < p.m.count; i++) {
      const k = i * 9, o = (vo + i) * 9;
      const x = V[k], z = V[k + 2], nx = V[k + 3], nz = V[k + 5];
      vertices[o] = x * c + z * s + p.dx; vertices[o + 1] = V[k + 1] + p.dy; vertices[o + 2] = -x * s + z * c + p.dz;
      vertices[o + 3] = nx * c + nz * s; vertices[o + 4] = V[k + 4]; vertices[o + 5] = -nx * s + nz * c;
      vertices[o + 6] = V[k + 6]; vertices[o + 7] = V[k + 7]; vertices[o + 8] = V[k + 8];
    }
    for (let i = 0; i < p.m.indices.length; i++) indices[io + i] = p.m.indices[i] + vo;
    vo += p.m.count; io += p.m.indices.length;
  }
  return { vertices, count, indices };
}

/** A cairn's height (m), for its tap ray. @param {number} stones @param {any} L */
export const cairnHeight = (stones, L) => stones * ((L.thickM[0] + L.thickM[1]) / 2) * 0.82 + L.thickM[1];
