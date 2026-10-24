// @ts-check
// Rules for gather plants (docs/future/13 5.2, PR-06 and PR-07), read by the growth step
// (coarse.js) and the volunteers (volunteers.js). A gather plant is a flora recipe tagged `gather`.
// All gather plants together share one island budget (growth.json gather.budget): once it is
// reached their spread and volunteers fail quietly (hand plantings and undo may pass it). And a
// gather plant never spreads or volunteers onto held ground: a square under a placed piece
// (habitat.js heldMask), the camp pad (its clear mask, as for every plant), rushes standing at
// gather.rushBlock of full cover or more, or within gather.clearM of any other plant of any species.
// Species without the tag keep today's rules. Pure and worker-safe: + - * and comparisons only.

import { HABITAT_CELLS, HABITAT_ORIGIN, habitatCell } from './habitat.js';

/** Is this flora recipe a gather plant? @param {any} rec */
export const isGather = (rec) => Array.isArray(rec?.tags) && rec.tags.includes('gather');

/**
 * Gather plants on the island now. @param {{ sp: string }[]} plants @param {Record<string, any>} flora
 */
export function gatherCount(plants, flora) {
  let n = 0;
  for (const p of plants) if (isGather(flora[p.sp])) n++;
  return n;
}

/**
 * Is any plant (any species) closer than r (m) to (x, z)? index: plants per habitat cell, as
 * coarse.js cellIndex builds it; extra: plants not in the index yet (this hour's newborn).
 * @param {Map<number, number[]>} index @param {{ x: number, z: number }[]} plants
 * @param {number} x @param {number} z @param {number} r @param {{ x: number, z: number }[]} [extra]
 */
export function nearAny(index, plants, x, z, r, extra = []) {
  const ci = Math.floor(x - HABITAT_ORIGIN), cj = Math.floor(z - HABITAT_ORIGIN);
  const reach = Math.floor(r) + 1;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS) continue;
      const list = index.get(j * HABITAT_CELLS + i);
      if (!list) continue;
      for (const n of list) {
        const dx = plants[n].x - x, dz = plants[n].z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  for (const q of extra) {
    const dx = q.x - x, dz = q.z - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/**
 * May a gather plant take this point? Held ground, thick rushes and the clearance from every plant.
 * @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 * @param {Map<number, number[]>} index @param {{ x: number, z: number }[]} plants
 * @param {{ clearM?: number, rushBlock?: number } | undefined} GA growth.json gather
 * @param {Uint8Array | null} rush the rushes' cover (0..255 a square), or null
 * @param {{ x: number, z: number }[]} [extra] plants not in the index yet
 */
export function gatherClear(hab, x, z, index, plants, GA, rush, extra) {
  const k = habitatCell(x, z);
  if (k < 0) return false;
  if (hab.held?.[k] || hab.clear?.[k]) return false;
  if (rush && GA?.rushBlock !== undefined && rush[k] >= 255 * GA.rushBlock) return false;
  return !nearAny(index, plants, x, z, GA?.clearM ?? 0, extra);
}
