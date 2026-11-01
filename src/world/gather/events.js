// @ts-check
// Picked events (docs/future/13 4.5): the short list the save keeps of spots something was taken
// from, as flat triples [key, period, taken, key, period, taken, ...]. A spot's share for a period
// is worked out from the seed (spots.js); only what was taken is remembered, and only until the
// period is over. Pure: every function returns a new list and never edits the one it is given.
//
// Periods. A spot re-rolls each game day (foot, bin, log), each high tide (strand), each
// fire-night (ring) or each year (seeded). So that one list can say when any entry is over
// without knowing its spot, a period carries its kind in its low three bits:
//   period = index * 8 + tag      tag: PERIOD.day, tide, ring, year
// index is the game day, the high water's index (strand.js tideId), the day of the dawn after the
// fire-night, or the game year. A period is a plain integer (it may be negative for the high
// waters just before the world's first hour), so the save's number[] holds it as it is.

import { cleanAshes } from './ashes.js';
import { cleanRetting } from './retting.js';
import { cleanTreats } from '../creatures/treat-rules.js';

/** Period tags, in a period's low three bits. New tags go at the end. */
export const PERIOD = Object.freeze({ day: 0, tide: 1, ring: 2, year: 3 });

/** @param {number} tag PERIOD @param {number} index @returns {number} */
export const periodOf = (tag, index) => index * 8 + tag;
/** @param {number} p @returns {number} PERIOD tag */
export const periodTag = (p) => p - 8 * Math.floor(p / 8);
/** @param {number} p @returns {number} the day, tide, fire-night or year index */
export const periodIndex = (p) => Math.floor(p / 8);

/**
 * What is over now. A tide entry is over when its high water's line no longer lies: older than
 * the oldest line still lying, or swept up by a higher tide since (tides lists them all).
 * @typedef {{ day: number, year?: number, tides?: number[] }} Now
 *   day: game day now; year: game year now; tides: the tideIds of the lines lying now (strandLines)
 */

/**
 * Has an entry's period passed? A tag this build does not know is kept.
 * @param {number} period @param {Now} now
 */
export function isOver(period, now) {
  const tag = periodTag(period), i = periodIndex(period);
  if (tag === PERIOD.day || tag === PERIOD.ring) return i < now.day;
  if (tag === PERIOD.tide) return now.tides ? !now.tides.includes(i) : false;
  if (tag === PERIOD.year) return now.year !== undefined && i < now.year;
  return false;
}

/**
 * How much was taken from a spot this period (0 if nothing).
 * @param {number[]} events @param {number} key @param {number} period
 */
export function taken(events, key, period) {
  for (let i = 0; i + 2 < events.length; i += 3) if (events[i] === key && events[i + 1] === period) return events[i + 2];
  return 0;
}

/**
 * Note n more handfuls taken from a spot this period: a second handful raises the entry's count;
 * a new spot goes at the end (so the front is the oldest).
 * @param {number[]} events @param {number} key uint32 @param {number} period @param {number} n
 * @returns {number[]}
 */
export function record(events, key, period, n) {
  const out = events.slice();
  for (let i = 0; i + 2 < out.length; i += 3) {
    if (out[i] === key && out[i + 1] === period) { out[i + 2] += n; return out; }
  }
  out.push(key >>> 0, period, n);
  return out;
}

/**
 * Drop every entry whose period is over (run on each world:ticked and after world:caught-up).
 * @param {number[]} events @param {Now} now @returns {number[]}
 */
export function expire(events, now) {
  /** @type {number[]} */ const out = [];
  for (let i = 0; i + 2 < events.length; i += 3) {
    if (!isOver(events[i + 1], now)) out.push(events[i], events[i + 1], events[i + 2]);
  }
  return out;
}

/**
 * At most max entries: the oldest go first (their spots look fresh a little early).
 * @param {number[]} events @param {number} max @returns {number[]}
 */
export function cap(events, max) {
  const n = Math.floor(events.length / 3);
  return n <= max ? events.slice(0, n * 3) : events.slice((n - Math.max(0, max)) * 3, n * 3);
}

/** @param {any} v */
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/**
 * The save's gather section, cleaned: anything unreadable comes back empty; a malformed triple
 * (a key that is not a uint32, a period that is not an integer, a count under 1) is dropped, and a
 * trailing part-triple too. Triples written as nested [key, period, taken] arrays are flattened.
 * The ash patches spread on the ground (P2i, ashes.js) ride along as `ashes` once there are any.
 * Flax steeping in the shallows (F1, retting.js) as `retting`.
 * @param {any} v @returns {{ version: 1, events: number[], ashes?: import('./ashes.js').AshPatch[], retting?: import('./retting.js').Bundle[] }}
 */
export function cleanGather(v) {
  const ashes = cleanAshes(v?.ashes), treats = cleanTreats(v?.treats), retting = cleanRetting(v?.retting);
  // Treats set out and lying (P2h, creatures/treats.js); flax steeping in the shallows (F1, retting.js).
  return { ...cleanEvents(v), ...(ashes.length ? { ashes } : {}), ...(treats.length ? { treats } : {}), ...(retting.length ? { retting } : {}) };
}

/** @param {any} v @returns {{ version: 1, events: number[] }} */
function cleanEvents(v) {
  const src = v && typeof v === 'object' && Array.isArray(v.events) ? v.events : [];
  const flat = src.some(Array.isArray) ? src.flatMap((/** @type {any} */ e) => (Array.isArray(e) && e.length === 3 ? e : [])) : src;
  /** @type {number[]} */ const events = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const k = flat[i], p = flat[i + 1], n = flat[i + 2];
    if (!isInt(k) || k < 0 || k > 0xffffffff || !isInt(p) || !isInt(n) || n < 1) continue;
    events.push(k, p, n);
  }
  return { version: 1, events };
}
