// @ts-check
// The habitat day by day (docs 02, 07; A9). Since the water table, the water summary changes with
// the season (rain-fed ponds lower in summer, the table swings), and the game rebuilds it once a
// game day, so the habitat the hourly tick reads changes too. Catch-up runs the same hours without
// the live water, so it rebuilds the summary and the habitat here, for each day it crosses, from
// the same inputs. The game's tick at hour h reads the habitat of the day of hour h - 1 (the day
// changes at midnight and the new summary arrives within that first hour), so this does the same.
// Pure and worker-safe.

import { buildSummary } from '../water/summary.js';
import { buildHabitat } from './habitat.js';
import { HOURS_PER_DAY, DAYS_PER_SEASON, SEASONS_PER_YEAR } from '../../core/clock.js';

/**
 * @typedef {Object} HabitatInputs
 * @property {any} summary  buildSummary's args without yearDay (src/world/water/index.js summaryInputs)
 * @property {any} habitat  buildHabitat's args without eco: material, materialCells, params, heightQ, baseQ
 */

/** The day of the year (0..55) whose habitat hour h reads. @param {number} h */
export const habitatDayOf = (h) => Math.floor(Math.max(0, h - 1) / HOURS_PER_DAY) % (DAYS_PER_SEASON * SEASONS_PER_YEAR);

/**
 * A habitat for any hour, rebuilt once per day of the year and kept.
 * @param {HabitatInputs} inp
 * @returns {(h: number) => import('./habitat.js').Habitat}
 */
export function habitatByDay(inp) {
  /** @type {Map<number, import('./habitat.js').Habitat>} */ const kept = new Map();
  return (h) => {
    const day = habitatDayOf(h);
    let hab = kept.get(day);
    if (!hab) {
      const s = buildSummary({ ...inp.summary, yearDay: day });
      hab = buildHabitat({ ...inp.habitat, eco: s.eco });
      kept.set(day, hab);
    }
    return hab;
  };
}
