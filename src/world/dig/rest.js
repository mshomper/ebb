// @ts-check
// Pacing without stamina (docs/future/13 10.7): no energy and no counter anywhere. Each 1 m cell gives
// each layer once a game day (rest); each 8 m patch gives keepsakes less often as it is dug through a
// season (thinning), back at the season's turn; and the whole island gives at most its day's budget
// of dug keepsakes, drawn from the seed (0, 1 or 2). All of it is read from the saved dug events,
// { c: cell, d: game day, l: layer depth, k: 1 when a keepsake was offered }, kept for the current
// season only. Worms and clay are never thinned or budgeted. Pure.

import { hash32 } from '../../core/rng.js';
import { DAYS_PER_SEASON } from '../../core/clock.js';
import { HABITAT_CELLS } from '../growth/habitat.js';

/** @typedef {{ c: number, d: number, l: number, k: number }} DugEvent */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** The season a game day falls in, counted from the start (not wrapped into the year). @param {number} day */
export const seasonNo = (day) => Math.floor(day / DAYS_PER_SEASON);

/** Has this cell given this layer today? @param {DugEvent[]} ev @param {number} c @param {number} d @param {number} l */
export const rested = (ev, c, d, l) => ev.some((e) => e.c === c && e.d === d && e.l === l);

/**
 * The patch a 1 m cell lies in (patchM a side). @param {number} c @param {any} R recipes/world/dig.json
 */
export function patchOf(c, R) {
  const n = Math.max(1, Math.round(R.rest.patchM / R.rest.cellM));
  const per = Math.ceil(HABITAT_CELLS / n);
  return Math.floor(Math.floor(c / HABITAT_CELLS) / n) * per + Math.floor((c % HABITAT_CELLS) / n);
}

/**
 * How often keepsakes come in a patch on the next dig there this season: 1, then lower as it is dug
 * (rest.thin: [from the n-th dig, share]). Also whether this dig is the first to thin it.
 * @param {DugEvent[]} ev this season's events @param {number} c the cell @param {any} R
 * @returns {{ share: number, firstThin: boolean, n: number }} n: which dig of the season this is there
 */
export function thinning(ev, c, R) {
  const p = patchOf(c, R);
  let n = 1;
  for (const e of ev) if (patchOf(e.c, R) === p) n++;
  let share = 1;
  for (const [from, s] of R.rest.thin) if (n >= from) share = s;
  // The dig that first thins it this season (the walker says so once).
  const firstStep = R.rest.thin.find((/** @type {number[]} */ t) => t[1] < 1)?.[0] ?? Infinity;
  return { share, firstThin: n === firstStep, n };
}

/**
 * The island's dug keepsakes for a game day: 0, 1 or 2 (budget.perDay weights), from the seed.
 * @param {number} seed subSeed(worldSeed, 'dig') @param {number} day @param {any} R
 */
export function budgetOf(seed, day, R) {
  const w = R.budget.perDay;
  let t = u01(hash32(seed, day, 0xb0d6)) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { if (t < w[i]) return i; t -= w[i]; }
  return w.length - 1;
}

/** How many of today's budget are left. @param {DugEvent[]} ev @param {number} seed @param {number} day @param {any} R */
export function budgetLeft(ev, seed, day, R) {
  let used = 0;
  for (const e of ev) if (e.d === day && e.k) used++;
  return Math.max(0, budgetOf(seed, day, R) - used);
}

/**
 * The events with one more, keeping only this season's and at most cap (the oldest go first).
 * @param {DugEvent[]} ev @param {DugEvent} e @param {any} R
 */
export function addEvent(ev, e, R) {
  const s = seasonNo(e.d);
  const out = ev.filter((x) => seasonNo(x.d) === s);
  out.push({ c: e.c, d: e.d, l: e.l, k: e.k ? 1 : 0 });
  return out.slice(Math.max(0, out.length - R.events.cap));
}

/** The events of the season a day is in (dropped at the season's turn). @param {DugEvent[]} ev @param {number} day */
export const seasonEvents = (ev, day) => ev.filter((e) => seasonNo(e.d) === seasonNo(day));

/**
 * The `dig` save section made safe: { version: 1, events, firsts, cache, sleepers }. Events with a
 * bad field are left out; firsts are the layers and moments whose first line was said; cache is the
 * game hour the keeper's cache was found (and the blade fitted), or null; sleepers the sleeping
 * toads found, { c: cell, y: the island's year }, kept for that winter (B1 D1). An older save reads
 * with no cache and no sleepers. Unreadable comes back empty.
 * @param {any} v @returns {DigSection}
 */
export function cleanDig(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyDig();
  const int = (/** @type {any} */ n) => Number.isInteger(n);
  const events = (Array.isArray(v.events) ? v.events : [])
    .filter((/** @type {any} */ e) => e && int(e.c) && e.c >= 0 && int(e.d) && e.d >= 0 && int(e.l) && e.l >= 1)
    .map((/** @type {any} */ e) => ({ c: e.c, d: e.d, l: e.l, k: e.k ? 1 : 0 }));
  const firsts = Array.isArray(v.firsts) ? [...new Set(v.firsts.filter((/** @type {any} */ f) => typeof f === 'string'))] : [];
  const cache = Number.isFinite(v.cache) && v.cache >= 0 ? v.cache : null;
  const sleepers = (Array.isArray(v.sleepers) ? v.sleepers : [])
    .filter((/** @type {any} */ s) => s && int(s.c) && s.c >= 0 && int(s.y) && s.y >= 0).map((/** @type {any} */ s) => ({ c: s.c, y: s.y }));
  // Where the ground gave way above the spring (the spring-ore plan, O2), once per island.
  const sp = v.spring && Number.isFinite(v.spring.hour) && Number.isFinite(v.spring.x) && Number.isFinite(v.spring.z) ? { hour: v.spring.hour, x: v.spring.x, z: v.spring.z } : null;
  return { version: 1, events, firsts, cache, sleepers, ...(sp ? { spring: sp } : {}) };
}

/**
 * @typedef {{ version: 1, events: DugEvent[], firsts: string[], cache: number | null, sleepers: { c: number, y: number }[],
 *   spring?: { hour: number, x: number, z: number } }} DigSection
 *   spring: where and when the ground gave way above the spring (O2), once it has
 */

/** A new island's dig section. */
export const emptyDig = () => /** @type {DigSection} */ ({ version: 1, events: [], firsts: [], cache: null, sleepers: [] });
