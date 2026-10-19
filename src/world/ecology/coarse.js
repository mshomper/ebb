// @ts-check
// The ecology step of the hourly tick (docs 11, 12): the fields creatures read, after growth and
// before creatures. In the slice: the midge field, and the frog habitat score and the pond's edge
// on the 1 m grid. Pure and worker-safe; skips until the habitat and the species recipes exist.
//
// State contract: coarseStep never mutates its input; it returns a shallow copy of `state` with a
// fresh `state.ecology`:
//   midges   0..255 per square (midges.js)
//   frogs    score, water and shelter 0..255 per square (habitat.js), and the bank squares (edge
//            cells and how many sides face the water)
//
// env.recipes.species is { frog: recipes/species/frog.json, midge: recipes/species/midge.json }.

import { stepMidges } from './midges.js';
import { frogNeeds } from './habitat.js';

/** @returns {{ midges: Uint8Array | null, frogs: any, habitatHash: number }} */
export function initialEcology() {
  return { midges: null, frogs: null, habitatHash: 0 };
}

/** A 0..1 field as bytes. @param {Float32Array} a */
function bytes(a) {
  const out = new Uint8Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = Math.floor(255 * a[k] + 0.5);
  return out;
}

/**
 * The fields for the world as it stands, with the midges moved on by one hour (or kept, with
 * `advance` false: after an edit between hours, so the frogs' map follows the new pond at once).
 * @param {any} state @param {any} env @param {boolean} advance
 */
export function ecologyNow(state, env, advance) {
  const hab = env.habitat?.();
  const sp = env.recipes?.species;
  if (!hab || !sp?.midge || !sp?.frog) return null;
  const prev = state.ecology ?? initialEcology();
  const season = Math.min(3, Math.max(0, state.seasons?.index ?? 0));
  const midges = advance || !prev.midges ? stepMidges(hab, state.growth, prev.midges, sp.midge.field, season) : prev.midges;
  const f = frogNeeds(hab, state.growth, midges, sp.frog);
  return {
    midges,
    frogs: { score: bytes(f.score), water: bytes(f.water), shelter: bytes(f.shelter), edge: f.edge },
    habitatHash: hab.hash,
  };
}

/**
 * One game hour of ecology.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  void hourIndex;
  const eco = ecologyNow(state, env, true);
  if (!eco) return { state, events: [] };
  return { state: { ...state, ecology: eco }, events: [] };
}
