// @ts-check
// Sleepers in the winter ground (docs/future/13 10.6.8, D-35, DR-19): in winter each 8 m patch of
// soil within 20 m of a pond holds a sleeping toad with a chance of 0.35, at one seeded 1 m cell,
// chosen afresh each year from the seed and the year. A layer 1 dig in that cell finds it: shown, put
// back and covered, the hole closed at once; the walker then digs nowhere within 1.5 m of it until
// spring ("Something sleeps here."). Found sleepers are saved for that winter only ({ c, y } in the
// dig section). Pure.

import { hash32 } from '../../core/rng.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';
import { DAYS_PER_SEASON } from '../../core/clock.js';
import { nearestPond } from '../creatures/spring.js';
import { cellCenter } from './layers.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** The island's year a game day falls in (four seasons a year, from the start). @param {number} day */
export const yearOf = (day) => Math.floor(day / (DAYS_PER_SEASON * 4));

/**
 * The sleeping toad's cell in a cell's patch this year, or -1 when the patch holds none (its draw).
 * Water is not asked here (sleeperAt does). @param {number} seed subSeed(worldSeed, 'dig')
 * @param {number} year @param {number} cell any cell in the patch @param {any} R recipes/world/dig.json sleeper
 */
export function sleeperCellOf(seed, year, cell, R) {
  const n = R.patchM, i = cell % HABITAT_CELLS, j = Math.floor(cell / HABITAT_CELLS);
  const pi = Math.floor(i / n), pj = Math.floor(j / n);
  const h = hash32(seed, year, pi, pj, 0x51ee);
  if (u01(h) >= R.chance) return -1;
  const si = Math.min(HABITAT_CELLS - 1, pi * n + (hash32(h, 1) % n)), sj = Math.min(HABITAT_CELLS - 1, pj * n + (hash32(h, 2) % n));
  return sj * HABITAT_CELLS + si;
}

/**
 * Does a winter layer 1 dig in this cell find a sleeping toad? Its patch's draw, its own cell, soil
 * ground (the caller's class), within pondM of a pond, not found already this year.
 * @param {number} seed @param {number} day @param {number} cell @param {any} hab the habitat
 * @param {{ c: number, y: number }[]} found @param {any} R dig.json sleeper
 */
export function sleeperAt(seed, day, cell, hab, found, R) {
  const year = yearOf(day);
  if (sleeperCellOf(seed, year, cell, R) !== cell) return false;
  if (found.some((s) => s.c === cell && s.y === year)) return false;
  const [x, z] = cellCenter(cell);
  return !!nearestPond(hab, x, z, R.pondM, R.pondCm);
}

/**
 * A sleeper found this winter within keepM of a point (no hole is dug there until spring), or null.
 * @param {{ c: number, y: number }[]} found @param {number} x @param {number} z @param {number} day
 * @param {boolean} winter @param {any} R dig.json sleeper
 */
export function sleeperNear(found, x, z, day, winter, R) {
  if (!winter) return null;
  const year = yearOf(day);
  for (const s of found) {
    if (s.y !== year) continue;
    const [cx, cz] = cellCenter(s.c);
    if ((cx - x) ** 2 + (cz - z) ** 2 < R.keepM * R.keepM) return s;
  }
  return null;
}

/**
 * The nearest sleeper's cell to a point this winter within reach (for the test link and the lab),
 * or -1. @param {number} seed @param {number} day @param {number} x @param {number} z @param {number} reachM
 * @param {any} hab @param {(cell: number) => boolean} soil the cell's ground can be dug @param {any} R
 */
export function nearestSleeper(seed, day, x, z, reachM, hab, soil, R) {
  const year = yearOf(day), seen = new Set();
  let best = -1, bestD = Infinity;
  const i0 = Math.floor(x - HABITAT_ORIGIN), j0 = Math.floor(z - HABITAT_ORIGIN);
  for (let j = Math.max(0, j0 - reachM); j <= Math.min(HABITAT_CELLS - 1, j0 + reachM); j += 1) {
    for (let i = Math.max(0, i0 - reachM); i <= Math.min(HABITAT_CELLS - 1, i0 + reachM); i += 1) {
      const c = sleeperCellOf(seed, year, j * HABITAT_CELLS + i, R);
      if (c < 0 || seen.has(c)) continue;
      seen.add(c);
      if (!soil(c) || !sleeperAt(seed, day, c, hab, [], R)) continue;
      const [cx, cz] = cellCenter(c), d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best;
}
