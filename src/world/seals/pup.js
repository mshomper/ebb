// @ts-check
// The seal pup in the hourly tick (B3 wave 3; recipes/species/seal.json ecology.pup): once a year, on
// a seeded day within pup.days (29 to 35, early autumn), with the seals' home bar met, a mother
// hauls out there with a white pup. It stays pup.stayDays (white until moultFrom days, then moulting)
// and then goes to sea with her. If the home is not met on the seeded day, she comes at the first
// hour it is, while the window lasts. Pure and worker-safe, seeded by the world seed and the year,
// so time away brings the same pup on the same day. Nothing happens until the seals have a home.
//
// State (state.creatures.seals):
//   pup      { bornH, year, x, z }   the pup here now (absent: none)
//   pupYear  number                  the last year a pup came (absent: never)

import { hash32, subSeed } from '../../core/rng.js';
import { DAYS_PER_SEASON, SEASONS_PER_YEAR, HOURS_PER_DAY } from '../../core/clock.js';

const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR;

/** The day of the year (0-based) the pup comes in a given year. @param {number} seed @param {number} year @param {number[]} days [first, last] */
export function pupDay(seed, year, days) {
  return days[0] + (hash32(seed, 0x5ea1, year) % (days[1] - days[0] + 1));
}

/**
 * How white the pup is (1 white .. 0 grey) at an age in game hours: white until moultFrom days,
 * then greying to the end of its stay. @param {number} ageH @param {{ stayDays: number, moultFrom: number }} P
 */
export function pupWhite(ageH, P) {
  const d = ageH / HOURS_PER_DAY;
  if (d <= P.moultFrom) return 1;
  return Math.max(0, 1 - (d - P.moultFrom) / Math.max(1e-6, P.stayDays - P.moultFrom));
}

/**
 * The pup's hour. @param {any} state @param {number} hourIndex @param {any} env @param {any} rec @param {string} key
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function pupStep(state, hourIndex, env, rec, key) {
  const P = rec.ecology?.pup, S = state.creatures?.[key];
  if (!P || !S?.home) return { state, events: [] };
  const day = Math.floor(hourIndex / HOURS_PER_DAY), year = Math.floor(day / DAYS_PER_YEAR), dayOfYear = day - year * DAYS_PER_YEAR;
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  let next = S;
  if (S.pup) {
    if (hourIndex - S.pup.bornH >= P.stayDays * HOURS_PER_DAY) {
      events.push({ name: 'creature:pup-left', payload: { species: key, x: S.pup.x, z: S.pup.z } });
      next = { ...S };
      delete next.pup;
    }
  } else if (S.pupYear !== year && S.home.met && dayOfYear >= pupDay(subSeed(env.seed ?? 0, key), year, P.days) && dayOfYear <= P.days[1]) {
    const pup = { bornH: hourIndex, year, x: S.home.x, z: S.home.z };
    next = { ...S, pup, pupYear: year };
    events.push({ name: 'creature:pup', payload: { species: key, x: pup.x, z: pup.z } });
  }
  if (next === S) return { state, events };
  return { state: { ...state, creatures: { ...state.creatures, [key]: next } }, events };
}

/**
 * A test shortcut (`?seals&pup`), never used by the game itself: a pup born now at (x, z).
 * @param {any} state @param {number} hourIndex @param {string} key @param {number} x @param {number} z @param {number} [ageDays]
 */
export function bringPup(state, hourIndex, key, x, z, ageDays = 0) {
  const S = state.creatures?.[key];
  if (!S) return state;
  const year = Math.floor(hourIndex / HOURS_PER_DAY / DAYS_PER_YEAR);
  return { ...state, creatures: { ...state.creatures, [key]: { ...S, pup: { bornH: hourIndex - Math.round(ageDays * HOURS_PER_DAY), year, x, z }, pupYear: year } } };
}
