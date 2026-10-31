// @ts-check
// The island's fish (docs/future/17, "The roster"): a fixed set, so "every fish" is finite. Each
// island seeds its own ordinary species from the world seed, so a sister island means new fish:
// five on the reef, five on the sand flats, four each in the kelp, open and deep water
// (fishing.json roster.counts), the five net fish among them as fixed, named members of the shallow
// waters (fishing.json named). The twelve rare species are the same on every island. Each species
// has an id, its water, its reference for the generator (fish2.js), and its journal page. Pure.

import { hash32 } from '../../core/rng.js';
import { speciesOf } from '../nets/living/fish2.js';

/**
 * @typedef {{ id: string, water: string, ref: import('../nets/living/fish2.js').SpeciesRef, page: string, kind: 'ordinary' | 'named' | 'rare',
 *   name: string, rarity: string, bait: 'small' | 'big' | 'either', when: string[] }} RosterFish
 */

/**
 * The ordinary species of an island (22 with the recipe's counts), in water order. Pure.
 * @param {number} worldSeed @param {any} FR recipes/world/fishing.json @returns {RosterFish[]}
 */
export function rosterOf(worldSeed, FR) {
  /** @type {RosterFish[]} */ const out = [];
  const names = new Set([...FR.named.map((/** @type {any} */ n) => n.name), ...FR.rare.map((/** @type {any} */ r) => r.name)]);
  FR.waters.order.forEach((/** @type {string} */ water, /** @type {number} */ wi) => {
    const want = FR.roster.counts[water] ?? 0;
    let k = 0;
    for (const n of FR.named.filter((/** @type {any} */ x) => x.water === water)) {
      if (k >= want) break;
      out.push(entry(n.id, water, { water, named: n.id }, n.page, 'named', FR));
      k++;
    }
    // Draw species until the water has its count, each with a name no other fish here has.
    for (let i = 0; k < want && i < 200; i++) {
      const seed = hash32(worldSeed, 0xf15, wi, i);
      const ref = { water, seed };
      const sp = speciesOf(ref, FR);
      if (names.has(sp.name)) continue;
      names.add(sp.name);
      const id = `${water}-${k}`;
      out.push(entry(id, water, ref, `fish-${id}`, 'ordinary', FR));
      k++;
    }
  });
  return out;
}

/** The twelve rare species, in riddle order. Pure. @param {any} FR @returns {RosterFish[]} */
export function rareRoster(FR) {
  return FR.rare.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => a.order - b.order)
    .map((/** @type {any} */ r) => entry(r.id, r.water, { water: r.water, rare: r.id }, `fish-${r.id}`, 'rare', FR));
}

/**
 * @param {string} id @param {string} water @param {import('../nets/living/fish2.js').SpeciesRef} ref @param {string} page
 * @param {'ordinary' | 'named' | 'rare'} kind @param {any} FR @returns {RosterFish}
 */
function entry(id, water, ref, page, kind, FR) {
  const sp = speciesOf(ref, FR);
  return { id, water, ref, page, kind, name: sp.name, rarity: sp.rarity, bait: sp.bait, when: sp.when.slice() };
}

/** Every species an island has: its ordinary ones and the rare ones. @param {number} worldSeed @param {any} FR */
export const allFish = (worldSeed, FR) => [...rosterOf(worldSeed, FR), ...rareRoster(FR)];
