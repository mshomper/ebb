// @ts-check
// The only source of time (docs 02, 03). worldT is game seconds (float64):
// 1 real second = 60 game seconds at 1x, so 1 real minute = 1 game hour.
// animT is real seconds and always runs. displayT = worldT unless a preview overrides it.
// The pure *Of(t) functions at the top are safe for coarse code and workers.

import { defaultBus } from './events.js';

export const GAME_SECONDS_PER_REAL_SECOND = 60;
export const SECONDS_PER_HOUR = 3600;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
export const DAYS_PER_SEASON = 7;
export const SEASONS_PER_YEAR = 4;
export const SECONDS_PER_SEASON = SECONDS_PER_DAY * DAYS_PER_SEASON;
export const SECONDS_PER_YEAR = SECONDS_PER_SEASON * SEASONS_PER_YEAR;
/** Largest real step per frame, so a tab switch never jumps the world. */
export const MAX_REAL_DT = 0.25;
/** Allowed time-flow values: pause, 1x, 2x, 4x. */
export const FLOWS = Object.freeze([0, 1, 2, 4]);

/** @typedef {0|1|2|4} Flow */
/** @typedef {{worldT:number, flow:Flow, animT:number}} ClockState */
/** @typedef {{index:number, phase:number, year:number, day:number}} Season
 *  index 0 spring, 1 summer, 2 autumn, 3 winter; phase 0..1 through the season;
 *  day 0..6 within the season; year counts from 0. */
/** @typedef {{dt:number, worldT:number, animT:number, displayT:number, hoursCrossed:number[]}} Tick */

// ---- pure time math (t in game seconds) ----

/** Integer game-hour index. @param {number} t */
export function hourIndexOf(t) { return Math.floor(t / SECONDS_PER_HOUR); }

/** Integer game-day index. @param {number} t */
export function dayIndexOf(t) { return Math.floor(t / SECONDS_PER_DAY); }

/** Fraction of the current day, 0..1 (0 = midnight). @param {number} t */
export function dayFractionOf(t) {
  return (t - Math.floor(t / SECONDS_PER_DAY) * SECONDS_PER_DAY) / SECONDS_PER_DAY;
}

/** Fraction of the year, 0..1 (0 = start of spring). @param {number} t */
export function yearFractionOf(t) {
  return (t - Math.floor(t / SECONDS_PER_YEAR) * SECONDS_PER_YEAR) / SECONDS_PER_YEAR;
}

/** Season state for a time (7 game days per season, 4 per year). @param {number} t @returns {Season} */
export function seasonOf(t) {
  const s = Math.floor(t / SECONDS_PER_SEASON);
  const year = Math.floor(s / SEASONS_PER_YEAR);
  const index = s - year * SEASONS_PER_YEAR;
  const phase = (t - s * SECONDS_PER_SEASON) / SECONDS_PER_SEASON;
  const day = dayIndexOf(t) - s * DAYS_PER_SEASON;
  return { index, phase, year, day };
}

// ---- stateful clock ----

/**
 * @typedef {Object} Clock
 * @property {(realDt: number) => Tick} advance  move time by one frame
 * @property {(f: Flow) => void} setFlow
 * @property {() => Flow} flow
 * @property {() => number} worldT
 * @property {() => number} animT
 * @property {() => number} display  display time (game seconds)
 * @property {(t: number|null) => void} setDisplayOverride  null returns to world time
 * @property {() => number} hourIndex
 * @property {() => number} dayFraction
 * @property {() => Season} season
 * @property {(worldT?: number) => void} reset  set world time (tests, save load); clears animT and override
 * @property {() => ClockState} state  snapshot for saving
 */

/**
 * Make an independent clock. With a bus it emits deferred `clock:hour {hour}`
 * and `clock:day {day}` on each boundary crossed (doc 02).
 * @param {{worldT?: number, flow?: Flow, bus?: import('./events.js').Bus|null}} [opts]
 * @returns {Clock}
 */
export function createClock(opts = {}) {
  let worldT = opts.worldT ?? 0;
  /** @type {Flow} */
  let flow = opts.flow ?? 1;
  let animT = 0;
  /** @type {number|null} */
  let override = null;
  const bus = opts.bus ?? null;

  /** @param {number} realDt */
  function advance(realDt) {
    const dt = realDt > 0 ? Math.min(realDt, MAX_REAL_DT) : 0;
    const before = worldT;
    animT += dt;
    worldT += dt * flow * GAME_SECONDS_PER_REAL_SECOND;
    /** @type {number[]} */
    const hoursCrossed = [];
    for (let h = hourIndexOf(before) + 1; h <= hourIndexOf(worldT); h++) {
      hoursCrossed.push(h);
      if (bus) {
        bus.emitDeferred('clock:hour', { hour: h });
        if (h % HOURS_PER_DAY === 0) bus.emitDeferred('clock:day', { day: h / HOURS_PER_DAY });
      }
    }
    return { dt, worldT, animT, displayT: override ?? worldT, hoursCrossed };
  }

  /** @param {Flow} f */
  function setFlow(f) {
    if (!FLOWS.includes(f)) throw new Error(`clock: flow must be one of ${FLOWS.join(', ')}`);
    flow = f;
  }

  return {
    advance,
    setFlow,
    flow: () => flow,
    worldT: () => worldT,
    animT: () => animT,
    display: () => override ?? worldT,
    setDisplayOverride: (t) => { override = t; },
    hourIndex: () => hourIndexOf(worldT),
    dayFraction: () => dayFractionOf(worldT),
    season: () => seasonOf(worldT),
    reset: (t = 0) => { worldT = t; animT = 0; override = null; },
    state: () => ({ worldT, flow, animT }),
  };
}

const clock = createClock({ bus: defaultBus });

/** The app clock. */
export const defaultClock = clock;
export const advance = clock.advance;
export const setFlow = clock.setFlow;
export const flow = clock.flow;
export const worldT = clock.worldT;
export const animT = clock.animT;
export const display = clock.display;
export const setDisplayOverride = clock.setDisplayOverride;
export const hourIndex = clock.hourIndex;
export const dayFraction = clock.dayFraction;
export const season = clock.season;
export const reset = clock.reset;
export const state = clock.state;
