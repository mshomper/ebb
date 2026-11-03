// @ts-check
// A trip into the Hollow, pure (H3a; doc 16, The Hollow, The lantern, When the lantern goes out): the
// seeds a trip's floors are made from, the lantern burning down (a little faster on each floor down),
// what is left in it said in words, and the seeded share of a trip's finds dropped in the dark when
// the light gives out. And the save section `hollow` (format 9's list): how many trips have been made
// and the deepest floor a trip has reached. Being in the Hollow is never saved and nothing in it
// simulates while away. Numbers: recipes/world/hollow.json trip.

import { subSeed, hash32 } from '../../core/rng.js';

/**
 * @typedef {Object} HollowSave
 * @property {1} version
 * @property {number} trips    trips made through the arch (the next trip's number is trips + 1)
 * @property {number} deepest  the deepest floor any trip has reached (0: none yet)
 */

/** @returns {HollowSave} */
export const emptyHollow = () => ({ version: 1, trips: 0, deepest: 0 });

/** The section as saved, or empty when missing or unreadable (a save from before the Hollow). @param {any} v @returns {HollowSave} */
export function cleanHollow(v) {
  if (!v || typeof v !== 'object' || v.version !== 1) return emptyHollow();
  const count = (/** @type {any} */ n) => (Number.isInteger(n) && n > 0 ? n : 0);
  return { version: 1, trips: count(v.trips), deepest: count(v.deepest) };
}

/**
 * A floor's inputs for the floor maker (plan.js planFloor, which takes its own sub-seed): the island seed, the trip's
 * number and the floor's place in the trip (1 the first). The level is the floor's place for now;
 * the keeper's measure (H4) will set where a trip starts. @param {number} seed the island seed
 * @param {number} trip @param {number} floor
 */
export function floorInputs(seed, trip, floor) {
  return { seed, trip, floor, level: floor };
}

/** How fast the lantern burns on a floor (fuel a second): a share faster each floor down. @param {any} T recipe trip @param {number} floor */
export const burnRate = (T, floor) => T.burnPerS * (1 + T.perFloorShare) ** Math.max(0, floor - 1);

/**
 * How many floors one fill lasts, at so many seconds a floor (the tuning's check: about 5 at 2 to 4
 * minutes a floor, doc 16). Fractional: 4.5 is half way through the fifth. @param {any} T @param {number} floorS
 */
export function floorsPerFill(T, floorS) {
  let fuel = T.fuel, f = 1;
  for (; f < 100; f++) {
    const use = burnRate(T, f) * floorS;
    if (use >= fuel) return f - 1 + fuel / use;
    fuel -= use;
  }
  return f;
}

/**
 * A trip's lantern a step later. Returns the fuel left, whether it fell below the low share this step
 * (the walker says so once) and whether it went out this step. @param {number} fuel
 * @param {number} dt seconds @param {any} T @param {number} floor
 */
export function burn(fuel, dt, T, floor) {
  if (fuel <= 0) return { fuel: 0, low: false, out: false };
  const next = Math.max(0, fuel - burnRate(T, floor) * dt), lowAt = T.fuel * T.lowShare;
  return { fuel: next, low: fuel >= lowAt && next < lowAt, out: next <= 0 };
}

/** A hit (H3b calls it), or a move that spends fuel: n sips. @param {number} fuel @param {any} T @param {number} [n] */
export const sip = (fuel, T, n = 1) => Math.max(0, fuel - T.sipFuel * n);

/** What is left in the lantern, in words ("half a light"), never a number. @param {number} share 0..1 @param {any} T */
export function fuelWord(share, T) {
  for (const [at, word] of T.fuelWords) if (share >= at) return word;
  return T.fuelWords[T.fuelWords.length - 1][1];
}

/**
 * How strong the lantern's light is now (a share of its full candela): full above the low share,
 * shrinking toward lowCdShare as it runs out. @param {number} share 0..1 @param {any} T
 */
export const lightShare = (share, T) => share <= 0 ? 0 : T.lowCdShare + (1 - T.lowCdShare) * Math.min(1, share / T.lowShare);

/**
 * The light gave out: about a third of what this trip found is dropped in the dark, a seeded share
 * (the island seed and the trip's number pick which). Finds are kept in the order found.
 * @template T @param {T[]} finds @param {number} seed the island seed @param {number} trip @param {number} share
 * @returns {{ kept: T[], dropped: T[] }}
 */
export function dropInTheDark(finds, seed, trip, share) {
  const n = Math.round(finds.length * share), s = subSeed(seed, 'hollow-drop');
  const order = finds.map((_, i) => i).sort((a, b) => (hash32(s, trip, a) - hash32(s, trip, b)) || a - b);
  const gone = new Set(order.slice(0, n));
  return { kept: finds.filter((_, i) => !gone.has(i)), dropped: finds.filter((_, i) => gone.has(i)) };
}
