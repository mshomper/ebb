// @ts-check
// The mouth room's shape (docs/future/19, 'The mouth room'; F16's mouth): the spring cave's chamber
// field (src/world/spring/cave-field.js caveShape) with two passages cut off it, one each side: the
// arch, a soot-ringed way on into the dark (closed until the Hollow: it ends blind past the light),
// and the bear's passage, choked with rubble. The chimney over the way in is the cleft in the stack's
// foot, open to the sky, so daylight falls in by the door. Its own frame: x into the stack from the
// cleft's back (the origin), z across, y up from the floor. Pure and deterministic, meshed in a worker.
// Numbers: recipes/world/stack-mouth.json shape.

import { caveShape } from '../spring/cave-field.js';
import { hash32 } from '../../core/rng.js';
import { noise3 } from '../hollow/field.js';
import { surfaceNets, gridNormals } from '../mesh/surface-nets.js';

/** @param {number} a @param {number} b @param {number} k */
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** @param {number} a @param {number} b @param {number} k */
const smax = (a, b, k) => -smin(-a, -b, k);

/**
 * The mouth's shape: the chamber's functions, plus the two passages.
 * @param {any} S stack-mouth.json shape @param {number} seed
 */
export function mouthShape(S, seed) {
  const base = caveShape(S, seed);
  /**
   * How far inside a passage a point is (m, negative outside): from its root at `at` along `dir`
   * (unit [x, z]) for lengthM, halfWidthM either side, under an arched roof heightM high at its middle.
   * @param {any} P @param {number} x @param {number} y @param {number} z
   */
  function passage(P, x, y, z) {
    const dx = x - P.at[0], dz = z - P.at[1], s = dx * P.dir[0] + dz * P.dir[1], t = Math.abs(-dx * P.dir[1] + dz * P.dir[0]);
    // Ragged, not a doorway: its width and roof wander with the rock (seeded, the same every time).
    const g = S.passageRag, k = 1 + g.amount * (noise3(seed + 11, x * g.scale, y * g.scale, z * g.scale) - 0.5) * 2;
    const hw = P.halfWidthM * k, roof = P.heightM * (1 + g.amount * (noise3(seed + 13, x * g.scale, 0.5, z * g.scale) - 0.5) * 2) * Math.sqrt(Math.max(0, 1 - (t / hw) ** 2));
    return Math.min(hw - t, roof - y, y + 0.05, P.lengthM - s, s + 1.2);
  }
  /** The rock's wear, as the chamber's (cave-field.js air): the passages are worn the same. @param {number} x @param {number} y @param {number} z */
  const wear = (x, y, z) => {
    const g = S.wallNoiseScale, f = S.fineNoiseScale;
    return (noise3(seed + 3, x * g, y * g, z * g) - 0.5) * 2 * S.wallNoiseM + (noise3(seed + 5, x * f, y * f, z * f) - 0.5) * 2 * S.fineNoiseM;
  };
  /** @param {number} x @param {number} y @param {number} z */
  function air(x, y, z) {
    // The chamber and its passages cut, then the stone forms over all of it (cave-field.js stoneAt).
    let a = base.rawAir(x, y, z);
    for (const P of [S.arch, S.rubble]) { const q = passage(P, x, y, z); if (q > -0.8) a = smax(a, q + wear(x, y, z) * S.passageRag.wear, 0.25); }
    return base.stoneAt(a, x, y, z);
  }
  /** The floor: the chamber's, or level in a passage. @param {number} x @param {number} z */
  function floorAt(x, z) {
    for (const P of [S.arch, S.rubble]) if (passage(P, x, 0.3, z) > 0) return Math.min(base.floorAt(x, z), 0.02);
    return base.floorAt(x, z);
  }
  /** How far in from any wall (the chamber's or a passage's) a point is. @param {number} x @param {number} z */
  function inside(x, z) {
    let k = base.inside(x, z);
    for (const P of [S.arch, S.rubble]) k = Math.max(k, passage(P, x, 0.3, z));
    return k;
  }
  return { ...base, air, floorAt, inside, passage };
}

/** The sampling grid's size (samples along x, y, z). @param {any} S @param {number} top the chimney's top */
export function mouthGrid(S, top) {
  const [x0, y0, z0, x1, , z1] = S.boundsM, c = S.cellM;
  return [Math.round((x1 - x0) / c) + 1, Math.round((top - y0) / c) + 1, Math.round((z1 - z0) / c) + 1];
}

/**
 * The field's samples for z rows k0 up to k1, clamped to the surface's neighbourhood (so every worker
 * can sample a share of the room at once). @param {any} S @param {number} seed @param {number} top @param {number} k0 @param {number} k1
 */
export function mouthFieldRows(S, seed, top, k0, k1) {
  const shape = mouthShape(S, seed), [x0, y0, z0] = S.boundsM, c = S.cellM, n = mouthGrid(S, top);
  const out = new Float32Array((k1 - k0) * n[1] * n[0]);
  for (let k = k0; k < k1; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    out[((k - k0) * n[1] + j) * n[0] + i] = Math.max(-0.5, Math.min(0.5, shape.air(x0 + i * c, y0 + j * c, z0 + k * c)));
  }
  return out;
}

/** The mesh of the sampled field. @param {any} S @param {number} top @param {Float32Array} field */
export function mouthNets(S, top, field) {
  const [x0, y0, z0] = S.boundsM, c = S.cellM, n = mouthGrid(S, top);
  const m = surfaceNets(field, n, [x0, y0, z0], c);
  const nrm = gridNormals(field, n, [x0, y0, z0], c, m.pos, m.count);
  return { pos: Float32Array.from(m.pos.subarray(0, m.count * 3)), nrm, idx: m.idx, count: m.count };
}

/**
 * The mouth's mesh (as caveMesh does the spring's), on one thread. @param {any} S @param {number} seed @param {number} top the chimney's top
 * @returns {{ pos: Float32Array, nrm: Float32Array, idx: Uint32Array, count: number }}
 */
export function mouthMesh(S, seed, top) {
  return mouthNets(S, top, mouthFieldRows(S, seed, top, 0, mouthGrid(S, top)[2]));
}

/**
 * The rubble choking its passage (decision 0001; Matt, November 2, 2026: a pile, never towers with
 * gaps between): a talus heap filling the passage from the dug face back, its surface rising from
 * toeM at the face at `slope` (rise per metre) until it meets the roof, filled in layers on a
 * jittered grid spacingM apart with stones big enough to touch their neighbours, the surface's shell
 * only (stones deeper than shellM under it are never seen). Pure: the same passage, front and seed
 * give the same stones.
 * @param {any} P the passage (stack-mouth.json shape.rubble) @param {any} B things.rubble @param {number} front
 *   where the heap starts (m along the passage) @param {(x: number, z: number) => number} floorAt
 * @returns {{ x: number, z: number, base: number, r: number, i: number, depth: number }[]} each stone's
 *   place, base height, radius, seed index, and how far under the heap's surface it lies (m)
 */
export function rubbleHeap(P, B, front, floorAt) {
  const u = (/** @type {number} */ i, /** @type {number} */ k) => (hash32(B.seed, i, k) >>> 8) / 16777216;
  const g = B.spacingM, hw = P.halfWidthM;
  /** The heap's surface height over the floor at s along, t across. @param {number} s @param {number} t */
  const surface = (s, t) => Math.min(P.heightM * Math.sqrt(Math.max(0, 1 - (t / hw) ** 2)) - B.roofGapM, B.toeM + (s - front) * B.slope);
  /** @type {{ x: number, z: number, base: number, r: number, i: number, depth: number }[]} */ const out = [];
  const ns = Math.ceil((P.lengthM - front) / g) + 1, nt = Math.ceil((2 * hw) / g) + 1;
  for (let L = 0; L * g * B.layerK < P.heightM; L++) {
    const y = L * g * B.layerK;
    for (let a = 0; a < ns; a++) for (let b = 0; b < nt; b++) {
      const i = (L * 1000 + a) * 100 + b;
      // Each layer's grid shifted half a step from the last, so stones sit in the hollows below.
      const s = front + (a + (L % 2) * 0.5 + (u(i, 1) - 0.5) * 0.5) * g;
      const t = -hw + (b + (L % 2) * 0.5 + (u(i, 2) - 0.5) * 0.5) * g;
      if (s < front - g * 0.3 || s > P.lengthM || Math.abs(t) > hw) continue;
      const r = B.radiusM[0] + (B.radiusM[1] - B.radiusM[0]) * u(i, 3);
      const top = surface(s, t), depth = top - (y + r * B.flat);
      if (depth < -r * 0.3) continue;             // above the heap's surface
      if (depth > B.shellM && s > front + B.shellM / B.slope) continue;   // deep inside it, unseen
      const x = P.at[0] + P.dir[0] * s - P.dir[1] * t, z = P.at[1] + P.dir[1] * s + P.dir[0] * t;
      out.push({ x, z, base: floorAt(x, z) + y - r * 0.25, r, i, depth: Math.max(0, depth) });
    }
  }
  return out;
}

/**
 * Light baked into the rock once, per vertex (the mouth's lantern is a real light, Matt, November 1,
 * 2026: the cave must look its best with the lantern lit): how much of each lantern spot a vertex
 * sees (soft shadows marched through the field toward it, so ledges, the arch's lip and the rubble
 * throw shade), and its ambient occlusion (hollows and corners go dark). Mouth frame.
 * @param {any} S @param {number} seed @param {Float32Array} pos @param {Float32Array} nrm @param {number} count
 * @param {number[][]} lamps lantern spots [x, y, z] (mouth frame) @param {any} B stack-mouth.json bake
 * @returns {Float32Array} per vertex: [one visibility per lamp..., ao]
 */
/**
 * How much of a lantern spot a point sees (0..1): a soft shadow marched through the field toward it.
 * @param {{ air: (x: number, y: number, z: number) => number }} shape @param {number} px @param {number} py @param {number} pz
 * @param {number[]} L the spot @param {any} B stack-mouth.json bake
 */
export function lampSight(shape, px, py, pz, L, B) {
  const dx = L[0] - px, dy = L[1] - py, dz = L[2] - pz, d = Math.hypot(dx, dy, dz) || 1;
  let res = 1, t = 0.02;
  while (t < d - B.lampClearM && res > 0.01) {
    const h = shape.air(px + (dx / d) * t, py + (dy / d) * t, pz + (dz / d) * t);
    if (h < 0.002) { res = 0; break; }
    res = Math.min(res, (B.penumbra * h) / t);
    t += Math.min(Math.max(h, B.minStepM), B.maxStepM);
  }
  return Math.max(0, Math.min(1, res));
}

export function bakeLight(S, seed, pos, nrm, count, lamps, B) {
  const shape = mouthShape(S, seed), K = lamps.length + 1, out = new Float32Array(count * K);
  for (let i = 0; i < count; i++) {
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const px = pos[i * 3] + nx * B.liftM, py = pos[i * 3 + 1] + ny * B.liftM, pz = pos[i * 3 + 2] + nz * B.liftM;
    lamps.forEach((L, k) => { out[i * K + k] = lampSight(shape, px, py, pz, L, B); });
    // Ambient occlusion: how far the open air falls short of the distance out along the normal.
    let occ = 0, w = 1;
    for (const r of B.aoM) {
      occ += w * Math.max(0, r - shape.air(px + nx * r, py + ny * r, pz + nz * r)) / r;
      w *= 0.7;
    }
    out[i * K + lamps.length] = Math.max(0, Math.min(1, 1 - occ * B.aoStrength));
  }
  return out;
}

/**
 * Lantern sight for vertices i0 up to i1 only (so every worker can bake a share at once): as
 * bakeLight, for that slice. @param {any} S @param {number} seed @param {Float32Array} pos @param {Float32Array} nrm
 * @param {number} i0 @param {number} i1 @param {number[][]} lamps @param {any} B
 */
export function bakeLightRange(S, seed, pos, nrm, i0, i1, lamps, B) {
  return bakeLight(S, seed, pos.subarray(i0 * 3, i1 * 3), nrm.subarray(i0 * 3, i1 * 3), i1 - i0, lamps, B);
}

/** Workers' jobs (src/core/workers.js): a share of the field's rows. @param {{ S: any, seed: number, top: number, k0: number, k1: number }} a */
export function mouthFieldJob(a) {
  const f = mouthFieldRows(a.S, a.seed, a.top, a.k0, a.k1);
  return { field: f, __transfer: [f.buffer] };
}
/** The mesh of the whole sampled field. @param {{ S: any, top: number, field: Float32Array }} a */
export function mouthNetsJob(a) {
  const m = mouthNets(a.S, a.top, a.field);
  return { ...m, __transfer: [m.pos.buffer, m.nrm.buffer, m.idx.buffer] };
}
/** A share of the lantern bake. @param {{ S: any, seed: number, pos: Float32Array, nrm: Float32Array, i0: number, i1: number, lamps: number[][], bake: any }} a */
export function mouthBakeJob(a) {
  const l = bakeLightRange(a.S, a.seed, a.pos, a.nrm, a.i0, a.i1, a.lamps, a.bake);
  return { light: l, __transfer: [l.buffer] };
}

/**
 * The worker's job (src/core/workers.js): the mesh, and its light baked for the lantern's spots.
 * @param {{ S: any, seed: number, top: number, lamps?: number[][], bake?: any }} a
 */
export function mouthMeshJob(a) {
  const m = mouthMesh(a.S, a.seed, a.top);
  const light = a.lamps && a.bake ? bakeLight(a.S, a.seed, m.pos, m.nrm, m.count, a.lamps, a.bake) : new Float32Array(0);
  return { ...m, light, __transfer: [m.pos.buffer, m.nrm.buffer, m.idx.buffer, light.buffer] };
}
