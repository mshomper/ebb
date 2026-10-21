// @ts-check
// What the island says when a tap can't be walked to (doc 23, the walker; W1). If the way would
// open at low tide (the sandbar), it says so and when low tide comes; otherwise that you can't
// get there on foot. Pure: safe to import from tools pages and tests.

import { findPath } from './path.js';
import { state as tideState, tideParams } from '../tide.js';

/**
 * Game hours until the next low water.
 * @param {number} tHours game hours (display time) @param {any} [tide] recipes/world/water.json tide
 */
export function hoursToLow(tHours, tide) {
  const p = tideParams(tide);
  const s = tideState(tHours, p);
  return s.rising ? s.nextTurnH + p.periodH / 2 : s.nextTurnH;
}

/**
 * The water over a cell at the next low water: the sea's share drops by however far the tide will
 * fall; a pond above the sea keeps its water.
 * @param {(k: number) => number} depthNow @param {(k: number) => number} groundOf
 * @param {number} levelNow sea level now (m) @param {number} levelLow sea level at low water (m)
 * @returns {(k: number) => number}
 */
export function depthAtLow(depthNow, groundOf, levelNow, levelLow) {
  return (k) => {
    const d = depthNow(k);
    return groundOf(k) < levelNow ? Math.max(0, d - (levelNow - levelLow)) : d;
  };
}

/**
 * The line for a tap that found no way.
 * @param {import('./grid.js').WalkGrid} g @param {import('./path.js').WalkRules} rules
 * @param {[number, number]} from @param {[number, number]} to
 * @param {{ reason: 'nowhere' | 'cut-off', lowDepth: (k: number) => number, hoursToLow: number, words: any }} o
 */
export function crossingNote(g, rules, from, to, o) {
  const W = o.words;
  if (o.reason === 'nowhere') return W.noGround;
  const atLow = findPath(g, { ...rules, depth: o.lowDepth }, from, to);
  if (!atLow.ok) return W.cantReach;
  if (o.hoursToLow < 0.75) return `${W.barUnder} ${W.lowTideSoon}`;
  const h = Math.round(o.hoursToLow);
  return `${W.barUnder} ${h === 1 ? W.lowTideHour : W.lowTideIn.replace('{h}', String(h))}`;
}
