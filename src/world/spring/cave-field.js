// @ts-check
// The spring's cave, its shape (the spring-ore plan, O3): a small chamber round a pool, under the
// hole where the ground gave way, with a round chimney up to the hole. Worked out in 2.5 parts that
// the walker and the light can read directly (the floor's height, the ceiling's, how far in from the
// wall, the pool's depth), blended into one signed field for the surface-nets mesher (positive in
// the air, the Hollow's convention, src/world/hollow/field.js) and worn with seeded 3D noise. Pure
// and deterministic: the same recipe and seed give the same cave in every browser and worker.
// Frame: meters from the hole's axis (x, z), y up from the cave's floor level. Numbers:
// recipes/world/spring-cave.json shape.

import { hash32, det } from '../../core/rng.js';
import { noise3 } from '../hollow/field.js';
import { surfaceNets, gridNormals } from '../mesh/surface-nets.js';

/** Smooth minimum (as the Hollow's field). @param {number} a @param {number} b @param {number} k */
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** @param {number} a @param {number} b @param {number} k */
const smax = (a, b, k) => -smin(-a, -b, k);
/** A seeded share 0..1. @param {number} seed @param {...number} k */
const u01 = (seed, ...k) => (hash32(seed, ...k) >>> 8) / 16777216;

/**
 * The cave's shape functions. @param {any} S spring-cave.json shape @param {number} seed
 */
export function caveShape(S, seed) {
  const [cx, cz] = S.centre, [rx, rz] = S.radiusM;
  const lobes = Array.from({ length: S.wobbleLobes }, (_, i) => ({ k: i + 2, a: u01(seed, 1, i) * det.PI * 2, m: (u01(seed, 2, i) - 0.5) * 2 / (i + 1) }));
  const P = S.pool, H = S.shaft, D = S.dripstone;
  // Dripstone (seeded): hanging from the roof and rising from the floor, clear of the rope, the
  // hole's light and the pool. Each: where (x, z), its root radius and length.
  const drips = [];
  for (let i = 0; i < (D ? D.hanging + D.rising : 0) * 6 && drips.length < D.hanging + D.rising; i++) {
    const up = drips.filter((q) => q.up).length < D.rising && i % 2 === 1;
    const x = cx + (u01(seed, 30, i) - 0.5) * 2 * rx, z = cz + (u01(seed, 31, i) - 0.5) * 2 * rz;
    if (Math.hypot(x, z) < D.clearM || Math.hypot(x - P.at[0], z - P.at[1]) < P.radiusM + 0.25) continue;
    if (!up && drips.filter((q) => !q.up).length >= D.hanging) continue;
    drips.push({ x, z, up, r: D.radiusM[0] + (D.radiusM[1] - D.radiusM[0]) * u01(seed, 32, i), len: D.lengthM[0] + (D.lengthM[1] - D.lengthM[0]) * u01(seed, 33, i) });
  }
  /** How far inside the wall a point is, in meters (negative outside the chamber). @param {number} x @param {number} z */
  function inside(x, z) {
    const dx = (x - cx) / rx, dz = (z - cz) / rz, th = det.atan2(dz, dx), e = Math.sqrt(dx * dx + dz * dz);
    let w = 0;
    for (const L of lobes) w += L.m * det.sin(L.k * th + L.a);
    const R = 1 + (S.wobbleM / Math.min(rx, rz)) * w;
    return (R - e) * Math.min(rx, rz);
  }
  /** The pool basin's dip below the floor (m, 0 outside it). @param {number} x @param {number} z */
  const basin = (x, z) => { const d = Math.hypot(x - P.at[0], z - P.at[1]) / P.radiusM; return d >= 1 ? 0 : P.depthM * (1 - d * d) * (1 - d * d); };
  /** The floor's height (m): gently bumped, rising into the walls, dipping into the pool. @param {number} x @param {number} z */
  function floorAt(x, z) {
    const n = (noise3(seed, x * 1.3, 0.5, z * 1.3) - 0.5) * 2 * S.floorNoiseM;
    const near = Math.max(0, 1 - inside(x, z) / 0.9);
    return n + S.floorRiseM * near * near - basin(x, z);
  }
  /** The ceiling's height (m): a low dome. @param {number} x @param {number} z */
  function ceilAt(x, z) {
    const e = Math.max(0, inside(x, z)) / Math.min(rx, rz);
    return S.ceilingM + S.domeM * Math.min(1, e * 1.6) + (noise3(seed + 7, x * 0.9, 3.1, z * 0.9) - 0.5) * 0.3;
  }
  /** The water over the floor (m, 0 where dry): only in the pool's basin, never in the floor's other dips. @param {number} x @param {number} z */
  const poolDepth = (x, z) => (Math.hypot(x - P.at[0], z - P.at[1]) < P.radiusM * 1.15 ? Math.max(0, P.levelM - floorAt(x, z)) : 0);
  /**
   * The chimney: inside its radius (m, negative outside), flaring where it meets the ceiling. It runs
   * on up past the sampled box, so the mesh stays open to the sky at the top.
   * @param {number} x @param {number} y @param {number} z
   */
  function shaftIn(x, y, z) {
    const c0 = ceilAt(0, 0), flare = Math.max(0, 1 - (y - c0) / 0.8) * H.flareM;
    return H.radiusM + flare - Math.hypot(x, z);
  }
  /**
   * The signed field at a point: positive in the air. @param {number} x @param {number} y @param {number} z @param {number} top
   * the chimney's top (the island's ground at the hole, in this frame)
   */
  function air(x, y, z, top) {
    const b = S.blendM;
    let a = smin(smin(y - floorAt(x, z), ceilAt(x, z) - y, b), inside(x, z), b);
    // The chimney: from just under the ceiling up to the hole.
    const sh = Math.min(shaftIn(x, y, z), y - (ceilAt(0, 0) - 0.6));
    a = smax(a, sh, b * 0.6);
    // Dripstone: rock cones out of the roof and up from the floor, taking from the air.
    for (const q of drips) {
      const d = Math.hypot(x - q.x, z - q.z);
      if (d > q.r + 0.2) continue;
      const root = q.up ? floorAt(q.x, q.z) - 0.05 : ceilAt(q.x, q.z) + 0.05, k = q.up ? (y - root) / q.len : (root - y) / q.len;
      if (k < -0.2 || k > 1.1) continue;
      const cone = d - q.r * Math.max(0, 1 - k) * (1 - k * 0.15);
      a = smax(a, cone, 0.06);
    }
    const g = S.wallNoiseScale, f = S.fineNoiseScale ?? 0;
    const wear = (noise3(seed + 3, x * g, y * g, z * g) - 0.5) * 2 * S.wallNoiseM + (f ? (noise3(seed + 5, x * f, y * f, z * f) - 0.5) * 2 * (S.fineNoiseM ?? 0) : 0);
    return a + wear;
  }
  return { inside, floorAt, ceilAt, poolDepth, air, basin, shaftIn, drips };
}

/**
 * The cave's mesh: the field sampled over shape.boundsM at cellM, meshed by surface nets, with
 * normals from the field. @param {any} S shape @param {number} seed @param {number} top the chimney's top, the
 * island's ground at the hole (m, cave frame)
 * @returns {{ pos: Float32Array, nrm: Float32Array, idx: Uint32Array, count: number }}
 */
export function caveMesh(S, seed, top) {
  const shape = caveShape(S, seed), [x0, y0, z0, x1, , z1] = S.boundsM, c = S.cellM;
  // The box ends at the hole: the chimney is air there, so its mouth stays open to the sky.
  const y1 = top;
  const n = [Math.round((x1 - x0) / c) + 1, Math.round((y1 - y0) / c) + 1, Math.round((z1 - z0) / c) + 1];
  const field = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const v = shape.air(x0 + i * c, y0 + j * c, z0 + k * c);
    // Keep only the surface's neighbourhood sharp; far values clamp, as the Hollow's do.
    field[(k * n[1] + j) * n[0] + i] = Math.max(-0.5, Math.min(0.5, v));
  }
  const m = surfaceNets(field, n, [x0, y0, z0], c);
  const nrm = gridNormals(field, n, [x0, y0, z0], c, m.pos, m.count);
  return { pos: Float32Array.from(m.pos.subarray(0, m.count * 3)), nrm, idx: m.idx, count: m.count };
}

/** A mesh's hash (FNV-1a over its positions to the millimetre), for the determinism check. @param {{ pos: ArrayLike<number> }} m */
export function meshHash(m) {
  let h = 0x811c9dc5;
  for (let i = 0; i < m.pos.length; i++) {
    const w = Math.round(m.pos[i] * 1000) | 0;
    for (let b = 0; b < 32; b += 8) { h ^= (w >>> b) & 0xff; h = Math.imul(h, 0x01000193); }
  }
  return h >>> 0;
}

/**
 * The worker's job (src/core/workers.js): the cave's mesh, its buffers handed back without a copy.
 * @param {{ S: any, seed: number, top: number }} a
 */
export function caveMeshJob(a) {
  const m = caveMesh(a.S, a.seed, a.top);
  return { ...m, __transfer: [m.pos.buffer, m.nrm.buffer, m.idx.buffer] };
}
