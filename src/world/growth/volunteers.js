// @ts-check
// Plants that come by themselves (docs/future/10). A new island starts with only the starters
// (recipes/world/growth.json `starters`, with grass); every other plant arrives later as a
// volunteer: a seed blown in, dropped by a bird or washed up, that lands on a square that suits it.
// The journal notes the first one, and from then on the Plant tool offers it.
//
// Pace (growth.json `volunteers`): none before firstAfterH hours of the island, then at least gapH
// hours between two arrivals, and in any hour after that a chance of chancePerH. The species come
// in `order`, skipping any the island has no ground for yet (each waits until it has). Seeded by
// the hour (core/rng.js), so a watched hour and an hour run while away bring the same plant to the
// same square. Pure and worker-safe.

import { stream, subSeed, hash32 } from '../../core/rng.js';

/**
 * The species on the island by now, by the hour each came. A growth state from before volunteers
 * (an older save) has none recorded: every species with a plant or a cover then counts as come at
 * this hour, so a save keeps its plants and only the missing ones arrive later.
 * @param {any} g the growth state @param {any} env @param {number} hourIndex
 * @returns {Record<string, number>}
 */
export function arrivedOf(g, env, hourIndex) {
  if (g.arrived) return g.arrived;
  /** @type {Record<string, number>} */ const out = {};
  for (const sp of env.recipes.growth.starters ?? []) out[sp] = hourIndex;
  for (const p of g.plants ?? []) out[p.sp] ??= hourIndex;
  for (const [sp, c] of Object.entries(g.cover ?? {})) if (/** @type {Uint8Array} */ (c).some((v) => v > 0)) out[sp] ??= hourIndex;
  return out;
}

/**
 * This hour's volunteer, if one lands: the species and the habitat cell, or null.
 * @param {any} g the growth state (arrived and since already set)
 * @param {import('./habitat.js').Habitat} hab @param {any} env @param {number} hourIndex
 * @param {(rec: any, k: number) => number} suitCell how well a recipe likes a cell, 0..1
 * @param {(k: number) => boolean} taken whether a cell already holds a plant
 * @returns {{ sp: string, k: number } | null}
 */
export function volunteerAt(g, hab, env, hourIndex, suitCell, taken) {
  const V = env.recipes.growth.volunteers;
  if (!V?.order?.length) return null;
  const waiting = V.order.filter((/** @type {string} */ sp) => !(sp in g.arrived));
  if (!waiting.length || hourIndex - g.since < V.firstAfterH) return null;
  const last = Math.max(g.since, ...Object.values(/** @type {Record<string, number>} */ (g.arrived)));
  if (hourIndex - last < V.gapH) return null;
  const seed = subSeed(env.seed, 'growth-volunteer');
  if (stream(seed, hourIndex).next() >= V.chancePerH) return null;
  for (const sp of waiting) {
    const rec = env.recipes.flora?.[sp] ?? env.recipes.covers?.[sp];
    if (!rec) continue;
    // The square it lands on: the suitable one first in this hour's hash order.
    let best = -1, bestH = 0;
    for (let k = 0; k < hab.n * hab.n; k++) {
      if (!hab.open[k] || taken(k) || suitCell(rec, k) < V.minSuit) continue;
      const h = hash32(seed, hourIndex, k);
      if (best < 0 || h < bestH) { best = k; bestH = h; }
    }
    if (best >= 0) return { sp, k: best };
  }
  return null;
}
