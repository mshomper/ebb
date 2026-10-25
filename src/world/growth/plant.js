// @ts-check
// The plant record and the small rules every growth piece shares (docs 10, docs/future/13 4.2):
// stages, a plant's stage from its age and the season, a picked plant's rest, and spacing checks.
// Pure and worker-safe. Split out of coarse.js, unchanged.

import { HABITAT_CELLS, HABITAT_ORIGIN, habitatCell } from './habitat.js';
import { plantSeasonPos } from './phenology.js';
import { inWindow } from './ground.js';

/** Stages, in order. */
export const STAGE = Object.freeze({ seed: 0, sprout: 1, young: 2, mature: 3, flowering: 4, dormant: 5 });

/**
 * @typedef {Object} Plant
 * @property {number} id @property {string} sp  species id (recipes/flora/<sp>.json)
 * @property {number} x  @property {number} z   world meters
 * @property {number} age   game hours since planted
 * @property {number} size  0..1 of the species' full size
 * @property {number} best  largest size reached
 * @property {number} stage STAGE
 * @property {number} low   hours in a row of poor ground
 * @property {number} drown hours in a row under too much water
 * @property {number} last  hour index of its last rhizome
 */

/**
 * cover: the cover plants other than grass (recipes/world/growth.json `cover`), each a share per
 * habitat cell 0..255, like `grass`. arrived: the species on the island, by the hour each came
 * (the starters at the first hour, the rest as volunteers, volunteers.js); since: the island's first
 * growth hour. Both are set at the first hour, and are missing from a save made before them.
 * @typedef {{ nextId: number, starterDone: boolean, plants: Plant[], grass: Uint8Array | null,
 *   cover: Record<string, Uint8Array> | null, habitatHash: number,
 *   arrived?: Record<string, number>, since?: number }} GrowthState
 */

/** @returns {GrowthState} */
export function initialGrowth() {
  return { nextId: 1, starterDone: false, plants: [], grass: null, cover: null, habitatHash: 0 };
}

/**
 * A plant's stage from its age, size and the season. The season windows are read on the plant's own
 * calendar (phenology.js: a few days ahead of or behind its species), so the stored stage, which the
 * shaders, the journal, the almanac and the trails all read, is the jittered one.
 * @param {any} rec @param {Plant} p @param {number} worldPos the world's season position
 */
export function stageOf(rec, p, worldPos, byBest = false) {
  const S = rec.growth.stages;
  if (p.age < S.sproutH) return STAGE.seed;
  // A plant that gives a gather part reads maturity from its best size (docs/future/13 4.2), so a
  // pick never turns a flowering plant back into a young one.
  if ((byBest ? p.best : p.size) >= S.matureSize) {
    const pos = plantSeasonPos(rec, p.id, worldPos);
    if (rec.dormant && inWindow(pos, rec.dormant)) return STAGE.dormant;
    if (rec.flowering && inWindow(pos, rec.flowering)) return STAGE.flowering;
    return STAGE.mature;
  }
  return p.size >= S.youngSize ? STAGE.young : STAGE.sprout;
}

/**
 * How a picked plant's hourly growth is scaled while it rests (docs/future/13 4.2, model B): once
 * it has been mature (best at least matureSize) and its size is under readyShare x best, growth is
 * multiplied by recoverRate x (1 + rainBoost x rain + mistBoost x mist); otherwise 1. A plant
 * still growing toward its best always has size equal to best, so it is never slowed; only a plant
 * that lost size is. Pure.
 * @param {number} size @param {number} best @param {number} matureSize @param {number} readyShare
 * @param {{ recoverRate: number, rainBoost: number, mistBoost: number }} P gather.json plants
 * @param {number} rain this hour's rain 0..1 (weather now) @param {number} mist this hour's mist 0..1
 */
export function recoverFactor(size, best, matureSize, readyShare, P, rain, mist) {
  if (best < matureSize || size >= readyShare * best) return 1;
  return P.recoverRate * (1 + P.rainBoost * rain + P.mistBoost * mist);
}

/**
 * The readyShare of each species that gives a gather part (gather.json plants.parts, keyed
 * '<species>.<part>'; the highest of its parts), or null when no gather recipe is loaded.
 * @param {any} gather gather.json, or undefined @returns {Map<string, number> | null}
 */
export function gatherSpecies(gather) {
  const parts = gather?.plants?.parts;
  if (!parts) return null;
  /** @type {Map<string, number>} */ const m = new Map();
  for (const [key, P] of Object.entries(parts)) {
    const sp = key.slice(0, key.indexOf('.'));
    const ready = /** @type {any} */ (P).readyShare ?? gather.plants.defaults?.[/** @type {any} */ (P).type]?.readyShare ?? 1;
    m.set(sp, Math.max(m.get(sp) ?? 0, ready));
  }
  return m;
}

/** Plants per 1 m cell, for spacing checks. @param {Plant[]} plants */
export function cellIndex(plants) {
  /** @type {Map<number, number[]>} */ const m = new Map();
  plants.forEach((p, i) => {
    const k = habitatCell(p.x, p.z);
    if (k < 0) return;
    const a = m.get(k);
    if (a) a.push(i); else m.set(k, [i]);
  });
  return m;
}

/**
 * Is any plant of `sp` closer than `r` (m) to (x, z)? r is at most a couple of meters.
 * @param {Map<number, number[]>} index @param {Plant[]} plants @param {string} sp @param {number} x @param {number} z @param {number} r
 */
export function crowded(index, plants, sp, x, z, r) {
  const ci = Math.floor(x - HABITAT_ORIGIN), cj = Math.floor(z - HABITAT_ORIGIN);
  const reach = Math.floor(r) + 1;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS) continue;
      const list = index.get(j * HABITAT_CELLS + i);
      if (!list) continue;
      for (const n of list) {
        const p = plants[n];
        if (p.sp !== sp) continue;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  return false;
}
