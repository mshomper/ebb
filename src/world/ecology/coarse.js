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
//   minnows, dragonflies (each school or swarm species, by its key)
//            score 0..255 per square (needs.js) and the pools that suit it
//
// env.recipes.species is { frog, midge, minnow?, dragonfly? }: recipes/species/<id>.json (src/world/species.js).

import { stepMidges } from './midges.js';
import { frogNeeds } from './habitat.js';
import { needMaps } from './needs.js';
import { swarmSpecies, keyOf } from '../species.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';

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
  /** @type {any} */ const eco = {
    midges,
    frogs: { score: bytes(f.score), water: bytes(f.water), shelter: bytes(f.shelter), edge: f.edge },
    habitatHash: hab.hash,
  };
  // Schools and swarms (minnows, dragonflies): the habitat score per square from the same needs
  // reader, and the pools that suit them (water bodies big and deep enough), for their tick.
  const fields = { midges };
  for (const rec of swarmSpecies(sp)) {
    const m = needMaps(hab, state.growth, fields, rec);
    const key = keyOf(rec);
    eco[key] = { score: bytes(m.score), pools: pools(m, state.creatures?.[key]?.groups ?? [], state.growth?.plants ?? [], rec.ecology.arrival?.roomPlants ?? null) };
  }
  return eco;
}

/**
 * The pools of a species' water and how good each is: area, room (good square meters), deepest
 * spot, its best square and score (ties to the lower square), and the groups whose home lies in it
 * (src/world/creatures/swarms.js finds each group's pool by this), and the plants in it that make
 * room for more (weed: weight x size summed, pondweed for minnows).
 * @param {ReturnType<typeof needMaps>} m @param {{ id: number, k: number }[]} groups
 * @param {{ sp: string, x: number, z: number, size: number }[]} plants @param {Record<string, number> | null} roomPlants
 */
function pools(m, groups, plants, roomPlants) {
  const n = Math.round(Math.sqrt(m.score.length));
  /** @type {Map<number, number>} */ const weed = new Map();
  if (roomPlants && m.label) {
    for (const p of plants) {
      const w = roomPlants[p.sp];
      if (!w) continue;
      const i = Math.floor(p.x - HABITAT_ORIGIN), j = Math.floor(p.z - HABITAT_ORIGIN);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const id = m.label[j * n + i];
      if (id) weed.set(id, (weed.get(id) ?? 0) + w * Math.min(1, p.size));
    }
  }
  return m.bodies.map((b) => {
    let best = -1, bestScore = 0;
    if (m.label) {
      for (let k = 0; k < m.score.length; k++) {
        if (m.label[k] !== b.id) continue;
        const s = Math.floor(255 * m.score[k] + 0.5);
        if (s > bestScore || best < 0) { best = k; bestScore = s; }
      }
    }
    const here = groups.filter((g) => m.label?.[g.k] === b.id).map((g) => g.id);
    const wd = Math.round((weed.get(b.id) ?? 0) * 100) / 100;
    return { id: b.id, area: b.area, room: b.good, deepCm: b.deepCm, deepK: b.deepK, best, bestScore: bestScore / 255, groups: here, weed: wd };
  });
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
