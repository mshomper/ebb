// @ts-check
// Pond stones (doc 09, stepping stones; the shaper's trail's first stop, a pool a metre deep): flat
// rounded slabs (slabs.js) laid along a line you drag, or one at a tap, the classic way across a
// pond. In water a stone stands on the bed with its top a few centimetres above the water as it is
// when you lay it, so it is cut as tall as the water is deep (up to stepping.maxDepthM) and a little
// broader the deeper it stands; on land it is set in, a few centimetres proud. The water level is
// never kept: a stone keeps its rise (its top over the ground under its middle), so when a pond
// drops in late summer the stone stands on the mud, and when it fills again it is a stepping stone
// again. Stones of one line share a run, and the walker steps from one to the next along it.
//
// A record: { id, kind: 'stepping', x, z, yaw, seed, size, rise, run, placedHour }: size its length
// (m), rise its top above the ground (m), run the id of the first stone of its line. Pure.

import { hash32, det } from '../../core/rng.js';

/**
 * @typedef {{ id: string, kind: 'stepping', x: number, z: number, yaw: number, seed: number, size: number,
 *   rise: number, run: string, placedHour: number }} SteppingStone
 */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
const span = (r, u) => r[0] + (r[1] - r[0]) * u;

/**
 * A new pond stone at a ground point with depth meters of water over it now (0 on land).
 * @param {number} piecesSeed subSeed(worldSeed, 'pieces') @param {number} n its number (the id is p<n>)
 * @param {number} x @param {number} z @param {number} depth @param {number} hour @param {string | null} run its line's first id (null: it starts one)
 * @param {any} S pieces.json stepping
 * @returns {SteppingStone}
 */
export function makeStepping(piecesSeed, n, x, z, depth, hour, run, S) {
  const seed = hash32(piecesSeed, n, 0x57e9);
  const wet = depth > S.wetM;
  const size = span(S.sizeM, u01(hash32(seed, 2))) + (wet ? depth * S.growPerM : 0);
  const rise = wet ? depth + span(S.freeboardM, u01(hash32(seed, 3))) : span(S.landRiseM, u01(hash32(seed, 3)));
  return { id: `p${n}`, kind: 'stepping', x, z, yaw: u01(hash32(seed, 1)) * 2 * det.PI, seed, size, rise, run: run ?? `p${n}`, placedHour: hour };
}

/** How far apart the next stone of a line goes, from the one before (seeded). @param {number} seed @param {any} S */
export const strideAfter = (seed, S) => span(S.spacingM, u01(hash32(seed, 4)));

/** A stone's sideways nudge off the line (seeded, meters). @param {number} seed @param {any} S */
export const jitterOf = (seed, S) => (u01(hash32(seed, 5)) - 0.5) * 2 * S.jitterM;

/**
 * Where a stone's top is, on the ground it stands on now. @param {SteppingStone} p @param {(x: number, z: number) => number} ground
 */
export const topOf = (p, ground) => ground(p.x, p.z) + p.rise;

/**
 * The pairs of stones the walker steps between: each stone and the next of its line (by id order),
 * when they are no further apart than linkM. @param {SteppingStone[]} list @param {any} S
 * @returns {[SteppingStone, SteppingStone][]}
 */
export function links(list, S) {
  /** @type {Map<string, SteppingStone[]>} */ const runs = new Map();
  for (const p of list) { const r = runs.get(p.run); if (r) r.push(p); else runs.set(p.run, [p]); }
  /** @type {[SteppingStone, SteppingStone][]} */ const out = [];
  const n = (/** @type {string} */ id) => Number.parseInt(id.slice(1), 10) || 0;
  for (const r of runs.values()) {
    r.sort((a, b) => n(a.id) - n(b.id));
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1], b = r[i], dx = b.x - a.x, dz = b.z - a.z;
      if (dx * dx + dz * dz <= S.linkM * S.linkM) out.push([a, b]);
    }
  }
  return out;
}

/**
 * The top of the footing under a point (for the walker), or -Infinity: within footReachM of a stone's
 * middle, or of the line between two linked stones (the top eased from one to the other), so the
 * walk grid's half-metre cells never miss a stone and a line of them reads as one way across.
 * @param {SteppingStone[]} list @param {[SteppingStone, SteppingStone][]} linked @param {(x: number, z: number) => number} ground
 * @param {any} S @param {number} x @param {number} z
 */
export function footingAt(list, linked, ground, S, x, z) {
  const r2 = S.footReachM * S.footReachM;
  let best = -Infinity;
  for (const p of list) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz <= r2) best = Math.max(best, topOf(p, ground));
  }
  for (const [a, b] of linked) {
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const dx = x - (a.x + ex * t), dz = z - (a.z + ez * t);
    if (dx * dx + dz * dz <= r2) best = Math.max(best, topOf(a, ground) * (1 - t) + topOf(b, ground) * t);
  }
  return best;
}
