// @ts-check
// The stack's days (docs/future/19): which evenings the light shows at its foot, and the low water
// the causeway rises at. Fixed to the calendar and the seed, not to the set-piece runner's spacing,
// so they never wait behind the boat and a catch-up, a reload and an hour watched all agree. Pure.
//
// An island counts its days from `startDay`: 0 for an island that had the stack from its first
// week, else the game day it first loaded with the stack (an older island past the lights' days:
// the lights follow over the next evenings and the causeway rises roadDay days after that load).

import { hash32 } from '../../core/rng.js';
import { nextLowH } from '../islet/layout.js';

/**
 * The day an island counts the stack's days from. @param {number} firstDay the game day it first
 * loaded with the stack @param {any} R recipes/setpieces/stack.json
 */
export const startDayOf = (firstDay, R) => (firstDay <= R.lights.lastDay ? 0 : firstDay);

/**
 * The evenings the light shows: count (a [min, max] range, seeded) distinct days among the days
 * after startDay in R.lights.days. @param {number} seed subSeed(world, 'stack') @param {number} startDay @param {any} R
 * @returns {number[]} game days, in order
 */
export function lightDays(seed, startDay, R) {
  const [lo, hi] = R.lights.count, pool = [...R.lights.days];
  const n = lo + (hash32(seed, 11, startDay) % (hi - lo + 1));
  /** @type {number[]} */ const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(startDay + pool.splice(hash32(seed, 12, startDay, i) % pool.length, 1)[0]);
  return out.sort((a, b) => a - b);
}

/**
 * Is the light at the stack's foot showing at a game hour? It shows for R.lights.forH hours from
 * dusk on its evenings. @param {number} tH game hours @param {number[]} days lightDays @param {number} duskH dusk's hour of day
 * @param {any} R @returns {number} 0 off, else 0..1 how bright (it fades in and out)
 */
export function lightAt(tH, days, duskH, R) {
  const day = Math.floor(tH / 24), h = tH - day * 24;
  if (!days.includes(day)) return 0;
  const t = (h - duskH - R.lights.afterDuskH) / R.lights.forH;
  if (t < 0 || t > 1) return 0;
  const f = R.lights.fade;
  return Math.min(1, t / f, (1 - t) / f);
}

/**
 * The game hour the causeway rises: the first low water on day startDay + roadDay.
 * @param {number} startDay @param {{ periodH: number, phaseH: number }} tide @param {any} R
 */
export const roadH = (startDay, tide, R) => nextLowH((startDay + R.road.day) * 24 + R.road.fromHour, tide);

/** Dusk's hour of day from the season's day length (as the set-piece runner reads it, unrounded). @param {number} dayLengthH */
export const duskOf = (dayLengthH) => 12 + dayLengthH / 2;
