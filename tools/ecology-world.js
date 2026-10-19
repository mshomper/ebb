// @ts-check
// A new world on a real island, with no GPU, for the ecology lab and the ecology unit tests: the
// island from its recipes (src/world/island-model.js), the tick's env with every recipe the game
// gives it, and the state of a new world at its first hour, plants settled as the game settles them.

import { buildIslandModel } from '../src/world/island-model.js';
import { initialWorldState, makeEnv, runHour } from '../src/sim/tick.js';
import { settleGrowth } from '../src/world/growth/coarse.js';

/** @param {string} path */
async function get(path) {
  const r = await fetch(new URL(`../recipes/${path}.json`, import.meta.url));
  if (!r.ok) throw new Error(`recipes/${path}.json: HTTP ${r.status}`);
  return r.json();
}

/** @type {Promise<any> | null} */ let shared = null;
/** Every recipe the tick reads, loaded once. */
export function loadEcologyRecipes() {
  shared ??= (async () => {
    const [terrain, water, growth, seasons, sky, frog, midge] = await Promise.all(
      ['world/terrain', 'world/water', 'world/growth', 'world/seasons', 'world/sky', 'species/frog', 'species/midge'].map(get));
    const flora = Object.fromEntries(await Promise.all(growth.species.map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    const covers = Object.fromEntries(await Promise.all((growth.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    /** @type {Record<string, any>} */ const lands = {};
    for (const isl of terrain.islands.list) lands[isl.id] = await get(`land/${isl.id}`);
    return { terrain, water, growth, seasons, sky, flora, covers, lands, species: { frog, midge } };
  })();
  return shared;
}

/** Islands built so far, by id and seed. @type {Map<string, any>} */
const models = new Map();

/**
 * A new world on an island: its env and its state at the first hour (10:00 on `startDay`).
 * @param {any} R loadEcologyRecipes() @param {string} island @param {number} seed @param {number} [startDay]
 * @param {any} [species] species recipes to use instead of the loaded ones (the lab's tweaks)
 */
export function islandWorld(R, island, seed, startDay = 0, species = R.species) {
  const key = `${island}|${seed}`;
  let model = models.get(key);
  if (!model) {
    model = buildIslandModel({ seed, terrain: R.terrain, land: R.lands[island], water: R.water, growth: R.growth });
    models.set(key, model);
  }
  const env = makeEnv(seed, { seasons: R.seasons, sky: R.sky.orbit, water: R.water, growth: R.growth, flora: R.flora,
    covers: R.covers, land: R.lands[island], species });
  // As in the game: the first hour runs before the water summary exists, then the habitat arrives
  // and the starter plants settle at once (src/app.js, src/world/growth/index.js).
  const h0 = 10 + 24 * startDay;
  env.habitat = () => null;
  const first = runHour(initialWorldState(seed), h0, env).state;
  env.habitat = () => model.habitat;
  const state = settleGrowth(first, env);
  return { env, state, h0, model };
}
