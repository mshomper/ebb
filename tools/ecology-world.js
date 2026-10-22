// @ts-check
// A new world on a real island, with no GPU, for the ecology lab and the ecology unit tests: the
// island from its recipes (src/world/island-model.js), the tick's env with every recipe the game
// gives it, and the state of a new world at its first hour, plants settled as the game settles them.

import { buildIslandModel } from '../src/world/island-model.js';
import { initialWorldState, makeEnv, runHour } from '../src/sim/tick.js';
import { settleGrowth } from '../src/world/growth/coarse.js';
import { SPECIES } from '../src/world/species.js';
import { HABITAT_ORIGIN as HAB_ORIGIN } from '../src/world/growth/habitat.js';

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
    const [terrain, water, growth, seasons, sky, ...listed] = await Promise.all(
      ['world/terrain', 'world/water', 'world/growth', 'world/seasons', 'world/sky', ...SPECIES.map((id) => `species/${id}`)].map(get));
    /** @type {Record<string, any>} */ const species = Object.fromEntries(SPECIES.map((id, i) => [id, listed[i]]));
    const flora = Object.fromEntries(await Promise.all(growth.species.map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    const covers = Object.fromEntries(await Promise.all((growth.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    /** @type {Record<string, any>} */ const lands = {};
    for (const isl of terrain.islands.list) lands[isl.id] = await get(`land/${isl.id}`);
    return { terrain, water, growth, seasons, sky, flora, covers, lands, species };
  })();
  return shared;
}

/**
 * Dig a small second pond on a new world's island, as a player would (M2 dragonflies want one):
 * a w x h meter pond on dry ground well away from other water, its edge 20 cm deep and its middle
 * 40 cm, every square of it marked as shaped (the ground moved), with reeds grown in along its edge.
 * Changes the world in place (its env's habitat, its model and its plants). Returns where it is, or
 * null if the island has no room.
 * @param {{ env: any, state: any, model: any }} w islandWorld() @param {{ w?: number, h?: number, reeds?: boolean }} [o]
 */
export function digPond(w, o = {}) {
  const hab = w.env.habitat?.() ?? w.model.habitat;
  const n = hab.n, W = o.w ?? 6, H = o.h ?? 5, ring = 3;
  const dry = (/** @type {number} */ k) => hab.open[k] && !hab.sea[k] && !hab.still[k] && hab.depthCm[k] === 0 && !hab.band?.[k] && hab.salt[k] < 60;
  for (let j = ring; j < n - H - ring; j++) {
    for (let i = ring; i < n - W - ring; i++) {
      let ok = true;
      for (let b = -ring; b < H + ring && ok; b++) for (let a = -ring; a < W + ring && ok; a++) if (!dry((j + b) * n + i + a)) ok = false;
      if (!ok) continue;
      const depthCm = hab.depthCm.slice(), still = hab.still.slice(), moisture = hab.moisture.slice();
      const shapedCm = (hab.shapedCm ?? new Uint8Array(n * n)).slice();
      /** @type {any[]} */ const reeds = [];
      let id = w.state.growth.nextId ?? 1000;
      for (let b = 0; b < H; b++) {
        for (let a = 0; a < W; a++) {
          const k = (j + b) * n + i + a;
          const edge = a === 0 || b === 0 || a === W - 1 || b === H - 1;
          depthCm[k] = edge ? 20 : 40; still[k] = 1; moisture[k] = 255; shapedCm[k] = 40;
          if (edge && o.reeds !== false && (a + b) % 2 === 0) {
            reeds.push({ id: id++, sp: 'reeds', x: HAB_ORIGIN + i + a + 0.5, z: HAB_ORIGIN + j + b + 0.5, age: 48, size: 0.8, best: 0.8, stage: 3, low: 0, drown: 0, last: 0 });
          }
        }
      }
      const dug = { ...hab, depthCm, still, moisture, shapedCm };
      w.env.habitat = () => dug;
      w.model = { ...w.model, habitat: dug };
      w.state = { ...w.state, growth: { ...w.state.growth, plants: [...w.state.growth.plants, ...reeds], nextId: id } };
      return { x: HAB_ORIGIN + i + W / 2, z: HAB_ORIGIN + j + H / 2, i, j, w: W, h: H };
    }
  }
  return null;
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
