// @ts-check
// Seasons step of the hourly tick (docs 02, 10). Pure and worker-safe: no GPU, DOM, store or
// events; only + - * /, Math.floor/min/max and det math (via sun-moon.js).
// Turns the hour's world time into {index, phase, year, day}, the day length and which
// dormancy windows are open. Per-species phenology joins here in later steps.
//
// State contract: coarseStep never mutates its input. It returns a shallow copy of `state`
// with `state.seasons` replaced by a fresh object.

import { seasonOf, SECONDS_PER_HOUR } from '../core/clock.js';
import { sunMoon, DEFAULT_LATITUDE_DEG, DEFAULT_TILT_DEG } from './sky/sun-moon.js';

/**
 * @typedef {Object} SeasonsState
 * @property {number} index   0 spring, 1 summer, 2 autumn, 3 winter
 * @property {number} phase   0..1 through the season (at the start of the hour)
 * @property {number} year
 * @property {number} day     0..6 within the season
 * @property {number} dayLengthH
 * @property {{reeds: boolean, frogs: boolean}} dormant
 */

/** @typedef {{name: string, payload: any, hour?: number}} CoarseEvent */

/**
 * Sun options for coarse code: latitude and tilt from the sky recipe when it has them.
 * @param {any} env
 * @returns {{latitudeDeg: number, tiltDeg: number}}
 */
export function sunOptsOf(env) {
  const sky = env?.recipes?.sky;
  return {
    latitudeDeg: sky?.latitudeDeg ?? DEFAULT_LATITUDE_DEG,
    tiltDeg: sky?.tiltDeg ?? DEFAULT_TILT_DEG,
  };
}

/**
 * Is a season position (0..4) inside a [from, to] window? Wraps when to <= from.
 * @param {number} pos @param {number[]} win
 */
export function inWindow(pos, win) {
  if (!win || win.length < 2) return false;
  const from = win[0], to = win[1];
  if (to > from) return pos >= from && pos < to;
  return pos >= from || pos < to;
}

/**
 * Seasons state at a world time. Pure.
 * @param {number} t game seconds
 * @param {any} recipe parsed recipes/world/seasons.json
 * @param {{latitudeDeg?: number, tiltDeg?: number}} [sunOpts]
 * @returns {SeasonsState}
 */
export function seasonsAt(t, recipe, sunOpts) {
  const s = seasonOf(t);
  const pos = s.index + s.phase;
  const dorm = recipe?.dormancy ?? {};
  return {
    index: s.index,
    phase: s.phase,
    year: s.year,
    day: s.day,
    dayLengthH: sunMoon(t, sunOpts).dayLengthH,
    dormant: { reeds: inWindow(pos, dorm.reeds), frogs: inWindow(pos, dorm.frogs) },
  };
}

/** Seasons state for a new world (hour 0: spring of year 0). @returns {SeasonsState} */
export function initialSeasons() {
  return { index: 0, phase: 0, year: 0, day: 0, dayLengthH: 12, dormant: { reeds: false, frogs: false } };
}

/**
 * One hour of the seasons step. Emits `season:changed {index, year}` when the season differs
 * from the previous step's. The first step on a state without `seasons` emits nothing.
 * @param {any} state world state
 * @param {number} hourIndex
 * @param {{recipes: any}} env
 * @returns {{state: any, events: CoarseEvent[]}}
 */
export function coarseStep(state, hourIndex, env) {
  const recipe = env.recipes?.seasons;
  if (!recipe) throw new Error('seasons: env.recipes.seasons is missing (recipes/world/seasons.json)');
  const prev = /** @type {SeasonsState|undefined} */ (state.seasons);
  const next = seasonsAt(hourIndex * SECONDS_PER_HOUR, recipe, sunOptsOf(env));
  /** @type {CoarseEvent[]} */
  const events = [];
  if (prev && prev.year * 4 + prev.index !== next.year * 4 + next.index) {
    events.push({ name: 'season:changed', payload: { index: next.index, year: next.year } });
  }
  return { state: { ...state, seasons: next }, events };
}
