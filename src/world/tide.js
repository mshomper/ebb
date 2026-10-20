// @ts-check
// Analytic tide (doc 07, "Tide and the flats"). Pure and worker-safe: no GPU, DOM, store or
// events; only + - * /, Math.floor/min/max and det math, so the tide is bit-identical in every
// browser and worker.
//
//   level(t) = A(t) cos(2 pi (t - phaseH) / periodH)          t in game hours, meters about Y = 0
//   A(t)     = amplitudeM (1 + springNeap cos(4 pi moonPhase(t)))
//
// moonPhase is the 7-day synodic month (clock.moonPhaseOf, shared with sky/sun-moon.js: new at
// each season's start and on day 7), so spring tides land at new and full moon, four a season,
// and neaps at the quarters.
// With phaseH 0, high water falls on hours 0, 12, 24, ... and low water on 6, 18, ...
//
// Rendering calls level(displayT / 3600); the hourly coarseStep reads the tide at world time.
//
// State contract: coarseStep never mutates its input. It returns a shallow copy of `state`
// with `state.tide` replaced by a fresh object.

import { det } from '../core/rng.js';
import { moonPhaseOf, SECONDS_PER_HOUR } from '../core/clock.js';

export const TIDE_PERIOD_H = 12;
/** The full spring tide band is [-BAND_FACTOR A0, +BAND_FACTOR A0] (doc 07, water summary). */
export const BAND_FACTOR = 1.15;

const TWO_PI = 2 * det.PI;

/**
 * @typedef {Object} TideParams
 * @property {number} amplitudeM  base amplitude A0, meters
 * @property {number} springNeap  spring and neap swing, fraction of A0
 * @property {number} periodH     game hours from high water to high water
 * @property {number} phaseH      shifts high water later by this many game hours
 */

/** Same numbers as the "tide" block of recipes/world/water.json. @type {Readonly<TideParams>} */
export const DEFAULT_TIDE = Object.freeze({ amplitudeM: 0.6, springNeap: 0.15, periodH: TIDE_PERIOD_H, phaseH: 0 });

/**
 * Full tide params from a recipe tide block (missing fields fall back to DEFAULT_TIDE).
 * @param {Partial<TideParams>|null|undefined} tide recipes/world/water.json "tide"
 * @returns {TideParams}
 */
export function tideParams(tide) {
  return tide ? { ...DEFAULT_TIDE, ...tide } : DEFAULT_TIDE;
}

/**
 * Moon phase at a game time: 0 new, 0.5 full, toward 1 (the same moon as sun-moon.js).
 * @param {number} tHours game hours
 */
export function moonPhase(tHours) {
  return moonPhaseOf(tHours * SECONDS_PER_HOUR);
}

/**
 * Tide amplitude at a game time: largest at new and full moon, smallest at the quarters.
 * @param {number} tHours game hours
 * @param {TideParams} [p]
 */
export function amplitude(tHours, p = DEFAULT_TIDE) {
  return p.amplitudeM * (1 + p.springNeap * det.cos(2 * TWO_PI * moonPhase(tHours)));
}

/** Fraction 0..1 through the tidal cycle (0 = high water, 0.5 = low). @param {number} tHours @param {TideParams} p */
function cycle01(tHours, p) {
  const x = (tHours - p.phaseH) / p.periodH;
  return x - Math.floor(x);
}

/**
 * Sea level in meters at a game time (world or display time).
 * @param {number} tHours game hours (display time: displayT / 3600)
 * @param {TideParams} [p]
 * @returns {number}
 */
export function level(tHours, p = DEFAULT_TIDE) {
  return amplitude(tHours, p) * det.cos(TWO_PI * cycle01(tHours, p));
}

/**
 * @typedef {Object} TideNow
 * @property {number} level      meters
 * @property {number} amp        amplitude at this time, meters
 * @property {boolean} rising    true from low water to high water
 * @property {number} nextTurnH  game hours until the next high or low water
 * @property {number} phase01    0..1 through the tidal cycle (0 high water, 0.5 low water)
 */

/**
 * Full tide state at a game time. Turns are taken at the cycle's high and low points; the slow
 * amplitude drift moves the true extremes by well under a minute, which is ignored.
 * @param {number} tHours game hours
 * @param {TideParams} [p]
 * @returns {TideNow}
 */
export function state(tHours, p = DEFAULT_TIDE) {
  const phase01 = cycle01(tHours, p);
  const amp = amplitude(tHours, p);
  const rising = phase01 >= 0.5;
  const nextTurnH = (rising ? 1 - phase01 : 0.5 - phase01) * p.periodH;
  return { level: amp * det.cos(TWO_PI * phase01), amp, rising, nextTurnH, phase01 };
}

/**
 * Fraction of the full spring band [-BAND_FACTOR A0, +BAND_FACTOR A0] above a level, 0..1.
 * @param {number} lvl meters
 * @param {TideParams} [p]
 */
export function exposedBandFrac(lvl, p = DEFAULT_TIDE) {
  const top = BAND_FACTOR * p.amplitudeM;
  const f = (top - lvl) / (2 * top);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** @typedef {{level: number, rising: boolean, exposedBandFrac: number}} TideState */
/** @typedef {{name: string, payload: any, hour?: number}} CoarseEvent */

/**
 * The coarse tide for an hour, sampled at its midpoint (hourIndex + 0.5). Pure.
 * @param {number} hourIndex
 * @param {TideParams} [p]
 * @returns {TideState}
 */
export function tideAtHour(hourIndex, p = DEFAULT_TIDE) {
  const s = state(hourIndex + 0.5, p);
  return { level: s.level, rising: s.rising, exposedBandFrac: exposedBandFrac(s.level, p) };
}

/** Tide state for a new world: hour 0 with the default params. @returns {TideState} */
export function initialTide() {
  return tideAtHour(0, DEFAULT_TIDE);
}

/**
 * One hour of the tide step. The hour is sampled at its midpoint, so `tide:turned` fires on the
 * first hour whose midpoint lies past a high or low water (with the default phase: hours 0, 6,
 * 12, ... the hour that starts at the turn). kind 'low' when the sea starts rising, 'high' when
 * it starts falling. A state without `tide` emits nothing on its first step.
 * @param {any} state world state
 * @param {number} hourIndex
 * @param {{recipes: any}} env
 * @returns {{state: any, events: CoarseEvent[]}}
 */
export function coarseStep(state, hourIndex, env) {
  const p = tideParams(env.recipes?.water?.tide);
  const prev = /** @type {TideState|undefined} */ (state.tide);
  const next = tideAtHour(hourIndex, p);
  /** @type {CoarseEvent[]} */
  const events = [];
  if (prev && prev.rising !== next.rising) {
    events.push({ name: 'tide:turned', payload: { kind: next.rising ? 'low' : 'high' } });
  }
  return { state: { ...state, tide: next }, events };
}
