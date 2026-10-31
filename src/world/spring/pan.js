// @ts-check
// Panning the spring's pool with the old keeper's pan (the spring-ore plan, O3): a calm action, no
// minigame. Each pan turns up one thing, iron ore (black sand) most often, copper ore more rarely,
// sometimes only gravel; a few pans a game day, then the pool is cloudy and wants time to settle.
// What a pan gives is seeded by the island, the game day and the pan's number that day, so time
// away, a reload and live play all agree. The save keeps only the count, { day, n, total, hour },
// in the dig section's spring record. Numbers: recipes/world/spring-cave.json pan. Pure.

import { hash32 } from '../../core/rng.js';

/**
 * @typedef {{ day: number, n: number, total: number, hour: number }} PanCount
 *   day: the game day of the last pan; n: pans that day; total: pans ever; hour: the game hour of the last pan
 */

/** A saved count made safe. @param {any} v @returns {PanCount} */
export function cleanPans(v) {
  const int = (/** @type {any} */ x) => (Number.isInteger(x) && x >= 0 ? x : 0);
  return { day: int(v?.day), n: int(v?.n), total: int(v?.total), hour: Number.isFinite(v?.hour) ? v.hour : -1e9 };
}

/**
 * Pans left today: perDay, less those already made today. The pool settles overnight (a new game
 * day) once settleH game hours have passed since the day's last pan.
 * @param {PanCount} c @param {number} day @param {number} hour game hours @param {any} P spring-cave.json pan
 */
export function pansLeft(c, day, hour, P) {
  if (c.day !== day) return hour - c.hour >= P.settleH ? P.perDay : 0;
  return Math.max(0, P.perDay - c.n);
}

/**
 * What one pan turns up: a pack kind (iron-ore, copper-ore) or 'gravel' (nothing to keep). The
 * first pan ever is always firstFind; copper comes only from the copperAfter-th pan on.
 * @param {number} seed the island's spring seed @param {number} day @param {number} i the pan's number that day (0..)
 * @param {number} total pans ever before this one @param {any} P @returns {string}
 */
export function panFind(seed, day, i, total, P) {
  if (total === 0) return P.firstFind;
  const entries = Object.entries(P.finds).filter(([k]) => k !== 'copper-ore' || total + 1 >= P.copperAfter);
  const sum = entries.reduce((a, [, w]) => a + /** @type {number} */ (w), 0);
  let t = ((hash32(seed, day, i, 0x9a7) >>> 8) / 16777216) * sum;
  for (const [k, w] of entries) { if ((t -= /** @type {number} */ (w)) < 0) return k; }
  return entries[entries.length - 1][0];
}

/** The count after one more pan on `day` at `hour`. @param {PanCount} c @param {number} day @param {number} hour @returns {PanCount} */
export const panned = (c, day, hour) => ({ day, n: c.day === day ? c.n + 1 : 1, total: c.total + 1, hour });
