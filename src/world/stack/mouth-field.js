// @ts-check
// The mouth room's shape (docs/future/19, 'The mouth room'; F16's mouth): the spring cave's chamber
// field (src/world/spring/cave-field.js caveShape) with two passages cut off it, one each side: the
// arch, a soot-ringed way on into the dark (closed until the Hollow: it ends blind past the light),
// and the bear's passage, choked with rubble. The chimney over the way in is the cleft in the stack's
// foot, open to the sky, so daylight falls in by the door. Its own frame: x into the stack from the
// cleft's back (the origin), z across, y up from the floor. Pure and deterministic, meshed in a worker.
// Numbers: recipes/world/stack-mouth.json shape.

import { caveShape } from '../spring/cave-field.js';
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
    const roof = P.heightM * Math.sqrt(Math.max(0, 1 - (t / P.halfWidthM) ** 2));
    return Math.min(P.halfWidthM - t, roof - y, y + 0.05, P.lengthM - s, s + 1.2);
  }
  /** @param {number} x @param {number} y @param {number} z */
  function air(x, y, z) {
    let a = base.air(x, y, z, 0);
    for (const P of [S.arch, S.rubble]) a = smax(a, passage(P, x, y, z), 0.25);
    return a;
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

/**
 * The mouth's mesh (as caveMesh does the spring's). @param {any} S @param {number} seed @param {number} top the chimney's top
 * @returns {{ pos: Float32Array, nrm: Float32Array, idx: Uint32Array, count: number }}
 */
export function mouthMesh(S, seed, top) {
  const shape = mouthShape(S, seed), [x0, y0, z0, x1, , z1] = S.boundsM, c = S.cellM;
  const n = [Math.round((x1 - x0) / c) + 1, Math.round((top - y0) / c) + 1, Math.round((z1 - z0) / c) + 1];
  const field = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    field[(k * n[1] + j) * n[0] + i] = Math.max(-0.5, Math.min(0.5, shape.air(x0 + i * c, y0 + j * c, z0 + k * c)));
  }
  const m = surfaceNets(field, n, [x0, y0, z0], c);
  const nrm = gridNormals(field, n, [x0, y0, z0], c, m.pos, m.count);
  return { pos: Float32Array.from(m.pos.subarray(0, m.count * 3)), nrm, idx: m.idx, count: m.count };
}

/** The worker's job (src/core/workers.js). @param {{ S: any, seed: number, top: number }} a */
export function mouthMeshJob(a) {
  const m = mouthMesh(a.S, a.seed, a.top);
  return { ...m, __transfer: [m.pos.buffer, m.nrm.buffer, m.idx.buffer] };
}
