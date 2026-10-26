// @ts-check
// The growth step of the hourly tick (docs 10, 11). Pure and worker-safe: no GPU, DOM, store or
// events; seeded randomness only (core/rng.js stream), and only + - * / and Math.floor/min/max/abs
// on numbers, so a watched hour and an hour simulated while away give the same island.
//
// Each hour every plant asks: is the ground right (moisture, water depth, still water, salt from
// the habitat grid, each axis only if its recipe names it), is it the season to grow, and is it
// drowning? It grows toward full size by the answer, changes stage, and a mature plant of a
// spreading species sends a rhizome along the best bearing or drops a seed nearby.
// The grass cover per square meter moves toward what the ground supports. A new island gets a few
// starter clumps the first time the habitat is known.
//
// The pieces live beside it: ground.js (what the ground offers, suitability), plant.js (the plant
// record, stages, rest after a pick, spacing), cover.js (grass and rushes) and starters.js (a new
// island's starters, settling, planting by hand). This file keeps the hour, and still exports
// everything the rest of the game reads from it.
//
// State contract: coarseStep never mutates its input; it returns a shallow copy of `state` with a
// fresh `state.growth`.
//
// env.habitat() returns the current Habitat (world/growth/habitat.js) or null; env.recipes.growth
// is recipes/world/growth.json and env.recipes.flora maps species id to its recipe.

import { stream, subSeed } from '../../core/rng.js';
import { HABITAT_ORIGIN } from './habitat.js';
import { arrivedOf, volunteerAt, ashSpreadAt } from './volunteers.js';
import { plantSeasonPos } from './phenology.js';
import { isGather, gatherCount, gatherClear } from './rules.js';
import { groundAt, groundAtCell, suitability, suitabilityOf, inWindow } from './ground.js';
import { STAGE, initialGrowth, stageOf, recoverFactor, gatherSpecies, cellIndex, crowded } from './plant.js';
import { firstCover, grassHour, coverHour } from './cover.js';
import { plantStarters } from './starters.js';

export { groundAt, suitability } from './ground.js';
export { STAGE, initialGrowth, recoverFactor } from './plant.js';
export { settleGrowth, plantSeed, plantCover } from './starters.js';

/** @typedef {import('./plant.js').Plant} Plant @typedef {import('./plant.js').GrowthState} GrowthState */

/** The eight bearings, as unit steps (diagonals pre-normalized). */
const BEARINGS = [[1, 0], [0.7071067811865476, 0.7071067811865476], [0, 1], [-0.7071067811865476, 0.7071067811865476],
  [-1, 0], [-0.7071067811865476, -0.7071067811865476], [0, -1], [0.7071067811865476, -0.7071067811865476]];

/**
 * One game hour of growth.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  const hab = env.habitat?.();
  const GR = env.recipes?.growth;
  if (!hab || !GR || !env.recipes.flora) return { state, events: [] };
  const prev = state.growth ?? initialGrowth();
  /** @type {GrowthState} */
  const g = { ...prev, plants: prev.plants.map((p) => ({ ...p })), habitatHash: hab.hash };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  if (!g.starterDone) {
    plantStarters(g, hab, env);
    g.starterDone = true;
  }
  g.since ??= hourIndex;
  g.arrived = { ...arrivedOf(g, env, hourIndex) };
  const pos =(state.seasons?.index ?? 0) + (state.seasons?.phase ?? 0);
  const season = Math.min(3, Math.max(0, state.seasons?.index ?? 0));
  const seed = subSeed(env.seed, 'growth');
  // Gathering (docs/future/13 4.2): only species that give a gather part, and only once the gather
  // recipe is in env.recipes.gather, rest after a pick and read maturity from best. Without it
  // every plant grows exactly as before.
  const picked = gatherSpecies(env.recipes.gather);
  const wx = state.weather?.now;

  // Grow, age, change stage; drop the dead (counted per species and reason for the journal).
  /** @type {Plant[]} */ const alive = [];
  /** @type {Map<string, number>} */ const lost = new Map();
  const lose = (/** @type {string} */ sp, /** @type {string} */ why) => lost.set(`${sp}|${why}`, (lost.get(`${sp}|${why}`) ?? 0) + 1);
  for (const p of g.plants) {
    const rec = env.recipes.flora[p.sp];
    if (!rec) continue;
    const G = rec.growth;
    const { suit } = suitability(rec, hab, p.x, p.z);
    const ground = groundAt(hab, p.x, p.z);
    p.age += 1;
    if (p.stage === STAGE.seed) {
      // A seed waits for good ground; in poor ground it gives up after a while.
      p.low = suit < 0.3 ? p.low + 1 : 0;
      if (p.low > G.seedDieHours) { lose(p.sp, 'seed'); continue; }
      if (p.age >= G.stages.sproutH && suit >= 0.3) p.size = Math.max(p.size, 0.05);
    } else {
      const ready = picked?.get(p.sp);
      const k = ready === undefined ? 1
        : recoverFactor(p.size, p.best, G.stages.matureSize, ready, env.recipes.gather.plants, wx?.rain ?? 0, wx?.mist ?? 0);
      // The last factor goes on last, so k = 1 leaves the sum bit for bit as before.
      p.size += G.ratePerH * G.seasonRate[season] * suit * (1 - p.size) * k;
      if (p.size > p.best) p.best = p.size;
      p.low = suit < G.lowSuit ? p.low + 1 : 0;
      if (p.low > G.lowHours) p.size = Math.max(G.floor * p.best, p.size - G.shrinkPerH);
    }
    p.drown = ground && ground.depth > G.drownDepthM ? p.drown + 1 : 0;
    if (p.drown > G.drownHours) { lose(p.sp, 'drown'); continue; }
    if (!ground) { lose(p.sp, 'outside'); continue; }
    p.stage = p.size <= 0 ? STAGE.seed : stageOf(rec, p, pos, picked?.has(p.sp) ?? false);
    alive.push(p);
  }
  g.plants = alive;
  for (const [key, count] of lost) {
    const [sp, why] = key.split('|');
    events.push({ name: 'growth:lost', payload: { species: sp, why, count } });
  }

  // Spread: a rhizome creeps along the best of eight bearings; a dropped seed lands on the one
  // bearing it rolled, and takes only if the ground there is good. A species may drop seed only in
  // its season (spread.window, e.g. willow's early summer) and stops at spread.maxCount plants.
  const index = cellIndex(g.plants);
  const born = [];
  /** @type {Map<string, number>} */ const held = new Map();
  for (const p of g.plants) held.set(p.sp, (held.get(p.sp) ?? 0) + 1);
  // Gather plants (rules.js): one shared budget, and never onto held ground or crowding any plant.
  const GA = GR.gather;
  const rush = firstCover(prev, env);
  let gathered = gatherCount(g.plants, env.recipes.flora);
  for (const p of g.plants) {
    const rec = env.recipes.flora[p.sp];
    const R = rec.spread;
    if (!R || (R.kind !== 'rhizome' && R.kind !== 'seed') || p.stage < STAGE.mature || p.stage === STAGE.dormant) continue;
    if (R.window && !inWindow(plantSeasonPos(rec, p.id, pos), R.window)) continue;
    if (R.maxCount && (held.get(p.sp) ?? 0) >= R.maxCount) continue;
    const gather = isGather(rec);
    if (gather && GA?.budget !== undefined && gathered >= GA.budget) continue;
    if (hourIndex - p.last < R.everyH) continue;
    if (g.plants.length + born.length >= GR.maxPlants) break;
    p.last = hourIndex;
    if (suitability(rec, hab, p.x, p.z).suit < R.minSuit) continue;
    const r = stream(seed, hourIndex, p.id);
    const dist = R.distanceM[0] + (R.distanceM[1] - R.distanceM[0]) * r.next();
    const turn = r.int(8);
    let best = -1, bx = 0, bz = 0;
    for (let b = 0; b < (R.kind === 'seed' ? 1 : 8); b++) {
      const dir = BEARINGS[(b + turn) % 8];
      const x = p.x + dir[0] * dist, z = p.z + dir[1] * dist;
      const s = suitability(rec, hab, x, z).suit;
      if (s > best) { best = s; bx = x; bz = z; }
    }
    if (best < R.minSuit) continue;
    if (crowded(index, g.plants, p.sp, bx, bz, R.minSpacingM)) continue;
    if (born.some((q) => q.sp === p.sp && (q.x - bx) * (q.x - bx) + (q.z - bz) * (q.z - bz) < R.minSpacingM * R.minSpacingM)) continue;
    if (gather && !gatherClear(hab, bx, bz, index, g.plants, GA, rush, born)) continue;
    born.push({ id: g.nextId++, sp: p.sp, x: bx, z: bz, age: 0, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex });
    held.set(p.sp, (held.get(p.sp) ?? 0) + 1);
    if (gather) gathered++;
  }
  if (born.length) {
    g.plants = [...g.plants, ...born];
    /** @type {Record<string, number>} */ const bySpecies = {};
    for (const q of born) bySpecies[q.sp] = (bySpecies[q.sp] ?? 0) + 1;
    events.push({ name: 'growth:spread', payload: { count: born.length, bySpecies } });
  }

  // Grass and the other cover plants (cover.js).
  g.grass = grassHour(prev, hab, env);
  const cov = coverHour(prev, hab, env, hourIndex);
  if (cov) {
    g.cover = cov.cover;
    const took = cov.took;
    if (Object.keys(took).length) events.push({ name: 'growth:spread', payload: { count: Object.values(took).reduce((a, b) => a + b, 0), bySpecies: took } });
  }

  // A volunteer (volunteers.js): a species not yet on the island lands on a square that suits it,
  // as a fresh sprout (a plant) or a new tussock (a cover plant).
  if (g.plants.length < GR.maxPlants) {
    const held = cellIndex(g.plants);
    // A gather plant lands only on clear ground and while the shared budget has room (rules.js).
    const full = GR.gather?.budget !== undefined && gatherCount(g.plants, env.recipes.flora) >= GR.gather.budget;
    const rushNow = firstCover(g, env);
    const allow = (/** @type {any} */ rec, /** @type {number} */ k) => !isGather(rec) || (!full
      && gatherClear(hab, HABITAT_ORIGIN + (k % hab.n) + 0.5, HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5, held, g.plants, GR.gather, rushNow));
    const v = volunteerAt(g, hab, env, hourIndex, (rec, k) => suitabilityOf(rec, groundAtCell(hab, k)).suit, (k) => held.has(k), allow);
    if (v) {
      const x = HABITAT_ORIGIN + (v.k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(v.k / hab.n) + 0.5;
      const cov = g.cover?.[v.sp];
      const rec = env.recipes.flora[v.sp];
      if (cov) cov[v.k] = Math.max(cov[v.k], env.recipes.covers[v.sp].spread?.plantStart ?? 60);
      else if (rec) {
        g.plants = [...g.plants, { id: g.nextId++, sp: v.sp, x, z, age: rec.growth.stages.sproutH, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex }];
      }
      g.arrived[v.sp] = hourIndex;
      events.push({ name: 'growth:arrived', payload: { species: v.sp, x, z } });
    }
    // Ash spread on the ground (P2i): a plant already on the island may come up on it.
    const a = hab.ash ? ashSpreadAt(g, hab, env, hourIndex, (rec, k) => suitabilityOf(rec, groundAtCell(hab, k)).suit, (k) => held.has(k), allow) : null;
    const arec = a ? env.recipes.flora[a.sp] : null;
    if (a && arec && !v) {
      const x = HABITAT_ORIGIN + (a.k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(a.k / hab.n) + 0.5;
      g.plants = [...g.plants, { id: g.nextId++, sp: a.sp, x, z, age: arec.growth.stages.sproutH, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex }];
      events.push({ name: 'growth:spread', payload: { count: 1, bySpecies: { [a.sp]: 1 }, ash: true } });
    }
  }

  return { state: { ...state, growth: g }, events };
}
