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
//   under    shelterUnder and dampUnder 0..255 per square (shelter.js), while there are logs or stones
//
// env.recipes.species is { frog, midge, minnow?, dragonfly? }: recipes/species/<id>.json (src/world/species.js).

import { stepMidges } from './midges.js';
import { frogNeeds } from './habitat.js';
import { needMaps } from './needs.js';
import { openBox } from './fields.js';
import { swarmSpecies, keyOf } from '../species.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { tadpoleField } from '../creatures/spring.js';
import { shelterFields } from './shelter.js';

/**
 * The basking spots (stones, logs, the raft) as a field: 255 on each spot's square, or null when
 * there are none. Pure. @param {{ x: number, z: number }[] | undefined} basks state.basks @param {number} n
 */
export function baskField(basks, n) {
  if (!basks?.length) return null;
  const f = new Uint8Array(n * n);
  for (const b of basks) {
    const i = Math.floor(b.x - HABITAT_ORIGIN), j = Math.floor(b.z - HABITAT_ORIGIN);
    if (i >= 0 && j >= 0 && i < n && j < n) f[j * n + i] = 255;
  }
  return f;
}

/** @returns {{ midges: Uint8Array | null, frogs: any, habitatHash: number }} */
export function initialEcology() {
  return { midges: null, frogs: null, habitatHash: 0 };
}

/**
 * A 0..1 field as bytes. The need maps are written only inside the island's box (needs.js), so only
 * the box is read; past it they are 0, and so are the bytes.
 * @param {Float32Array} a @param {import('./fields.js').Box} box @param {number} n
 */
function bytes(a, box, n) {
  const out = new Uint8Array(a.length);
  for (let j = box.j0; j <= box.j1; j++) for (let k = j * n + box.i0; k <= j * n + box.i1; k++) out[k] = Math.floor(255 * a[k] + 0.5);
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
  const box = openBox(hab, 1), n = hab.n;
  /** @type {any} */ const eco = {
    midges,
    frogs: { score: bytes(f.score, box, n), water: bytes(f.water, box, n), shelter: bytes(f.shelter, box, n), edge: f.edge },
    habitatHash: hab.hash,
  };
  // Schools and swarms (minnows, dragonflies): the habitat score per square from the same needs
  // reader, and the pools that suit them (water bodies big and deep enough), for their tick.
  // Spring's tadpoles (minnows eat them; src/world/creatures/spring.js) and the basking spots you set
  // (turtles; state.basks), each present only while there are some.
  /** @type {Record<string, Uint8Array | null>} */ const fields = { midges };
  const tadpoles = tadpoleField(state, hab.n, sp.frogspawn);
  if (tadpoles) fields.tadpoles = tadpoles;
  const basks = baskField(state.basks, hab.n);
  if (basks) fields.basks = basks;
  // Shelter under the kept logs and loose stones, and the damp under them (shelter.js).
  const under = shelterFields(state.basks, hab);
  if (under) { fields.shelterUnder = under.shelterUnder; fields.dampUnder = under.dampUnder; eco.under = under; }
  for (const rec of swarmSpecies(sp)) {
    const m = needMaps(hab, state.growth, fields, rec);
    const key = keyOf(rec);
    const list = pools(m, state.creatures?.[key]?.groups ?? [], state.growth?.plants ?? [], rec.ecology.arrival?.roomPlants ?? null);
    // A species that wants a pond of its own the player made, with no fish (dragonflies): each pool
    // says whether it is one (fit), and why not.
    if (rec.ecology.pond) for (const p of list) Object.assign(p, pondFit(hab, m, p.id, rec.ecology.pond, state.creatures?.[rec.ecology.pond.fishFree]?.groups ?? []));
    eco[key] = { score: bytes(m.score, m.box, n), pools: list };
  }
  return eco;
}

/**
 * Is a pool one the dragonflies would take (recipe ecology.pond): mostly shallow (shallowShare of
 * its squares shallowM deep), with at least marginM2 square meters of margin marginM deep that the
 * player shaped (the ground moved shapedCm or more from the island as generated) and that has cover
 * grown in (shelter marginCover or more), and no fish (no group of fishFree living in it).
 * @param {any} hab @param {ReturnType<typeof needMaps>} m @param {number} id the pool
 * @param {any} R the recipe's ecology.pond @param {{ k: number }[]} fish the fish groups
 * @returns {{ fit: boolean, shallow: number, margin: number, fish: boolean }}
 *   shallow: share of the pool that is shallow; margin: square meters of shaped, covered margin
 */
export function pondFit(hab, m, id, R, fish) {
  let area = 0, shallow = 0, margin = 0;
  const [s0, s1] = R.shallowM, [m0, m1] = R.marginM;
  const n = hab.n, b = m.box;
  // A pool's squares all lie inside the island's box (needs.js waterBodies).
  for (let j = b.j0; j <= b.j1; j++) for (let k = j * n + b.i0; k <= j * n + b.i1; k++) {
    if (m.label?.[k] !== id) continue;
    area++;
    const d = hab.depthCm[k] / 100;
    if (d >= s0 && d <= s1) shallow++;
    if (d >= m0 && d <= m1 && (hab.shapedCm?.[k] ?? 0) >= R.shapedCm && m.shelter[k] >= R.marginCover) margin++;
  }
  const withFish = fish.some((g) => m.label?.[g.k] === id);
  const share = area ? Math.round((shallow / area) * 1000) / 1000 : 0;
  return { fit: share >= R.shallowShare && margin >= R.marginM2 && !withFish, shallow: share, margin, fish: withFish };
}

/**
 * The pools of a species' water and how good each is: area, room (good square meters), deepest
 * spot, its best square and score (ties to the lower square), and the groups whose home lies in it
 * (src/world/creatures/swarms.js finds each group's pool by this), and the plants in it that make
 * room for more (weed: weight x size summed, pondweed for minnows), and the weakest of its needs
 * at the best square (low: water, food or shelter).
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
      // The pool lies inside the island's box; read in grid order there, the same best wins.
      const x = m.box;
      for (let j = x.j0; j <= x.j1; j++) for (let k = j * n + x.i0; k <= j * n + x.i1; k++) {
        if (m.label[k] !== b.id) continue;
        const s = Math.floor(255 * m.score[k] + 0.5);
        if (s > bestScore || best < 0) { best = k; bestScore = s; }
      }
    }
    const here = groups.filter((g) => m.label?.[g.k] === b.id).map((g) => g.id);
    const wd = Math.round((weed.get(b.id) ?? 0) * 100) / 100;
    // The weakest need at the best square (A9: why a group grows uneasy), ties in this order.
    let low = 'water';
    if (best >= 0) {
      let v = m.water[best];
      if (m.food[best] < v) { v = m.food[best]; low = 'food'; }
      if (m.shelter[best] < v) low = 'shelter';
    }
    return { id: b.id, area: b.area, room: b.good, deepCm: b.deepCm, deepK: b.deepK, best, bestScore: bestScore / 255, groups: here, weed: wd, low };
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
