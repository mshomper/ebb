// @ts-check
// The shared hourly tick (docs 02, 03): every world system's coarseStep in a fixed order.
// live-sim.hourlyTick() and the future catchup.js run exactly this list, so a watched hour
// and an hour simulated while away produce the same world. Pure and worker-safe.

import { subSeed, det } from '../core/rng.js';
import * as tide from '../world/tide.js';
import * as weather from '../world/weather.js';
import * as seasons from '../world/seasons.js';
import * as growth from '../world/growth/coarse.js';
import * as ecology from '../world/ecology/coarse.js';
import * as creatures from '../world/creatures/coarse.js';
import * as swarms from '../world/creatures/swarms.js';
import * as spring from '../world/creatures/spring.js';

/** @typedef {{name: string, payload: any, hour?: number}} CoarseEvent */
/** @typedef {(state: any, hourIndex: number, env: Env) => {state: any, events: CoarseEvent[]}} CoarseStep */

/**
 * @typedef {Object} Env
 * @property {number} seed         world seed (uint32)
 * @property {number} weatherSeed  subSeed(seed, 'weather')
 * @property {any} recipes         loaded recipes by short name: {seasons, sky?, water?, growth?, flora?: {<species>: recipe},
 *                                 species?: {frog, midge}}
 * @property {() => any} [habitat] the current habitat grid (world/growth/habitat.js), or null until the water summary exists
 * @property {typeof det} det
 */

/**
 * Fixed order of the hourly tick. Doc 03 order with the S2 systems in place:
 *   tide            (M1 S4: src/world/tide.js, before weather)
 *   weather
 *   seasons
 *   water summary   (after seasons)
 *   growth
 *   ecology
 *   creatures
 *   expansion
 * @type {ReadonlyArray<{id: string, coarseStep: CoarseStep}>}
 */
export const COARSE_ORDER = Object.freeze([
  { id: 'tide', coarseStep: tide.coarseStep },
  { id: 'weather', coarseStep: weather.coarseStep },
  { id: 'seasons', coarseStep: seasons.coarseStep },
  // Growth (S5b): reads env.habitat(), built from the water summary; skips until it exists.
  { id: 'growth', coarseStep: growth.coarseStep },
  // Ecology and creatures (S6a): the midge field and frog habitat, then frogs arriving, settling
  // and leaving. Both skip until the habitat and env.recipes.species exist.
  { id: 'ecology', coarseStep: ecology.coarseStep },
  { id: 'creatures', coarseStep: creatures.coarseStep },
  // Schools and swarms (M2): minnows, dragonflies, one model (src/world/creatures/swarms.js).
  { id: 'swarms', coarseStep: swarms.coarseStep },
  // Spring at the pond (doc 13): frogspawn to froglets on happy frogs, the toad's night walk
  // (src/world/creatures/spring.js). After the swarms, so tadpoles see this hour's minnows.
  { id: 'spring', coarseStep: spring.coarseStep },
]);

/**
 * World state for a brand-new world (hour 0).
 * @param {number} worldSeed
 */
export function initialWorldState(worldSeed) {
  void worldSeed; // later systems seed their starting state from it
  return { tide: tide.initialTide(), weather: weather.initialWeather(), seasons: seasons.initialSeasons(), growth: growth.initialGrowth() };
}

/**
 * The environment every coarseStep receives.
 * @param {number} worldSeed
 * @param {any} recipes loaded recipes by short name, e.g. {seasons: <recipes/world/seasons.json>, sky: <recipes/world/sky.json>, water: <recipes/world/water.json>}
 * @returns {Env}
 */
export function makeEnv(worldSeed, recipes) {
  const seed = worldSeed >>> 0;
  return { seed, weatherSeed: subSeed(seed, 'weather'), recipes, det };
}

/**
 * Run one game hour through every system in COARSE_ORDER. Each event gets `hour: hourIndex`.
 * @param {any} state
 * @param {number} hourIndex
 * @param {Env} env
 * @returns {{state: any, events: CoarseEvent[]}}
 */
export function runHour(state, hourIndex, env) {
  /** @type {CoarseEvent[]} */
  const events = [];
  for (const sys of COARSE_ORDER) {
    const r = sys.coarseStep(state, hourIndex, env);
    state = r.state;
    for (const e of r.events) events.push({ ...e, hour: hourIndex });
  }
  return { state, events };
}

/**
 * Stable text form: object keys sorted, typed arrays as plain arrays, undefined dropped.
 * @param {any} v
 * @returns {string}
 */
function stableText(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : `"${String(v)}"`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = /** @type {ArrayLike<any>} */ (v);
    const parts = [];
    for (let i = 0; i < a.length; i++) parts.push(stableText(a[i]));
    return `[${parts.join(',')}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function').sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableText(v[k])}`).join(',')}}`;
  }
  return 'null';
}

/**
 * uint32 fingerprint of a world state (FNV-1a over the stable text form).
 * @param {any} state
 * @returns {number}
 */
export function hashWorldState(state) {
  const s = stableText(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
