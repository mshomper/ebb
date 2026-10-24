// @ts-check
// What the ground offers a plant, and how well a species likes it (docs 10, docs/future/10). Pure
// and worker-safe, read by the growth step (coarse.js) and by the Plant tool, the journal and the
// labs through coarse.js. Split out of coarse.js, unchanged.

import { habitatCell } from './habitat.js';

export const smooth01 = (/** @type {number} */ t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * Plateau bell: 1 inside [lo, hi], easing to 0 a tolerance beyond either side.
 * @param {number} x @param {number[]} r [lo, hi, tolerance]
 */
function bell(x, r) {
  if (x < r[0]) return smooth01((x - (r[0] - r[2])) / r[2]);
  if (x > r[1]) return smooth01(((r[1] + r[2]) - x) / r[2]);
  return 1;
}

/**
 * What the ground offers a plant at a world point: moisture and salt 0..1, water depth (m; the
 * sea counts as far too deep), still 1 in still water and damp ground, or null off the grid or
 * outside the opened island.
 * @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 */
export function groundAt(hab, x, z) {
  return groundAtCell(hab, habitatCell(x, z));
}

/** groundAt() for a habitat cell index (-1 off the grid). @param {import('./habitat.js').Habitat} hab @param {number} k */
export function groundAtCell(hab, k) {
  if (k < 0 || !hab.open[k]) return null;
  // Water can only move where there is water: ground with none standing on it counts as still, so a
  // plant refused there hears that it is too dry, not that the water moves too much.
  const still = !hab.sea[k] && hab.depthCm[k] === 0 ? 1 : hab.still[k];
  // The ground-type, slope and height axes (docs/future/10); undefined where the habitat has none.
  // Soil is earth, bare or turfed: the painted soil and grass shares together, since grass is
  // painted over soil (a pond floor is grass paint with a little soil).
  return { moisture: hab.moisture[k] / 255, salt: hab.salt[k] / 255, depth: hab.sea[k] ? 9 : hab.depthCm[k] / 100, still, k,
    sand: hab.sand ? hab.sand[k] / 255 : undefined, rock: hab.rock ? hab.rock[k] / 255 : undefined,
    soil: hab.soil ? Math.min(255, hab.soil[k] + hab.grass[k]) / 255 : undefined, slope: hab.slopeDeg ? hab.slopeDeg[k] : undefined,
    // Height above mean sea level, m.
    shore: hab.heightDm ? hab.heightDm[k] / 10 : undefined,
    // The keeper's camp pad (CP-16, habitat.js padClearMask): no plant takes there; grass stays.
    clear: hab.clear ? hab.clear[k] : 0 };
}

/** @typedef {'dry'|'wet'|'shallow'|'deep'|'fresh'|'salt'|'flow'|'outside'|'ground'|'steep'|'flat'|'low'|'high'|'camp'} Need */

/**
 * The habitat axes a recipe may use, in the order a tie names the need: [recipe key, ground key,
 * need when too low, need when too high]. A recipe leaves out the axes it does not care about, and
 * an axis the habitat does not have (an older test habitat) counts as met. The last five
 * (docs/future/10): the painted shares of sand, rock and soil (0..1; soil counts grass too), slope
 * (degrees) and height above mean sea level (m).
 * @type {[string, 'moisture'|'depth'|'salt'|'still'|'sand'|'rock'|'soil'|'slope'|'shore', Need, Need][]}
 */
const AXES = [
  ['waterDepthM', 'depth', 'shallow', 'deep'],
  ['still', 'still', 'flow', 'flow'],
  ['moisture', 'moisture', 'dry', 'wet'],
  ['salt', 'salt', 'fresh', 'salt'],
  ['sand', 'sand', 'ground', 'ground'],
  ['rock', 'rock', 'ground', 'ground'],
  ['soil', 'soil', 'ground', 'ground'],
  ['slopeDeg', 'slope', 'flat', 'steep'],
  ['shoreM', 'shore', 'low', 'high'],
];

/**
 * How well a species likes a point, 0..1, and which need is furthest from met.
 * @param {any} rec the species recipe @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 * @returns {{ suit: number, worst: Need }}
 */
export function suitability(rec, hab, x, z) {
  return suitabilityOf(rec, groundAt(hab, x, z));
}

/**
 * suitability() for ground already read. @param {any} rec @param {ReturnType<typeof groundAt>} g
 * @returns {{ suit: number, worst: Need }}
 */
export function suitabilityOf(rec, g) {
  if (!g) return { suit: 0, worst: 'outside' };
  // The camp ground stays clear (CP-16): nothing seeds, spreads, volunteers or is planted there.
  if (g.clear) return { suit: 0, worst: 'camp' };
  const H = rec.habitat;
  let suit = 1, low = 2;
  /** @type {Need} */ let worst = 'dry';
  for (const [key, at, tooLow, tooHigh] of AXES) {
    const r = H[key];
    if (!r) continue;
    const v = g[at];
    if (v === undefined) continue;
    const b = bell(v, r);
    suit *= b;
    if (b < low) { low = b; worst = v < r[0] ? tooLow : tooHigh; }
  }
  return { suit, worst };
}

/** Season position (0 spring .. 4) inside a [from, to) window, wrapping. @param {number} pos @param {number[]} w */
export const inWindow = (pos, w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]);
