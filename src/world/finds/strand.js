// @ts-check
// What the season and the weather add to the strandline (doc 13, "The year, season by season"):
// moon jellyfish stranded by summer high tides, and the winter storm tides that leave the rarer
// shells. Both come from the tide's hour alone, through seeded hashes and the day's weather
// record (world/weather.js dayRecord), so every device agrees and nothing is saved.

import { hash32 } from '../../core/rng.js';
import { seasonOf, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { dayRecord } from '../weather.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The salt for jellyfish hashes: their own, far past any finds/index.js KINDS salt (its index + 1,
 * which grows as kinds are appended), so no later kind or keepsake shares their cells' rolls.
 */
const JELLY_SALT = 1009;

/**
 * The season (0 spring .. 3 winter) of the high water that left a line.
 * @param {number} tideH the high water's game hour
 */
export const seasonOfTide = (tideH) => seasonOf(tideH * SECONDS_PER_HOUR).index;

/**
 * The weather on the day of a high water: the live record when it is today's or yesterday's,
 * otherwise the same roll worked out again (the same seed and day give the same record).
 * @param {number} tideH @param {{ weatherSeed: number, weather: any, state?: any }} w
 *   weather: recipes/world/seasons.json `weather`; state: the world's weather state (for its lean and records)
 */
export function weatherOfTide(tideH, w) {
  const day = Math.floor(tideH / HOURS_PER_DAY);
  const st = w.state;
  if (st?.today?.day === day) return st.today;
  if (st?.yesterday?.day === day) return st.yesterday;
  return dayRecord(w.weatherSeed, day, st?.lean ?? 0, w.weather);
}

/**
 * Was this high water a winter storm tide: winter, a gale blowing (a rain day with wind at least
 * galeWind), and a tide at least springMin toward spring? Pure.
 * @param {number} tideH @param {number} spring -1 neap .. 1 the highest spring
 * @param {{ season: number, mood: string, windStrength: number }} day the tide's season and its day's weather
 * @param {{ galeWind: number, springMin: number }} St finds.json kinds.shells.storm
 */
export function isStormTide(tideH, spring, day, St) {
  return day.season === 3 && day.mood === 'rain' && day.windStrength >= St.galeWind && spring >= St.springMin;
}

/**
 * The moon jellyfish (if any) one summer high tide stranded in one cell. Pure: the same seed, cell
 * and tide give the same jellyfish. Only on lines left in summer, only by tides at least springMin
 * toward spring, and only while the line is younger than maxAgeH (after that it has dried to a film).
 * @param {number} seed @param {number} k cell @param {number} tideId which high water left the line
 * @param {{ season: number, spring: number, ageH: number }} line
 * @param {any} J finds.json kinds.moonjelly
 * @returns {{ ox: number, oz: number, yaw: number, r: number, size: number } | null} offsets in cells (-0.5..0.5); size: bell width in meters
 */
export function jellyAt(seed, k, tideId, line, J) {
  if (line.season !== 1 || line.spring < (J.springMin ?? -Infinity) || line.ageH > J.maxAgeH) return null;
  const h0 = hash32(seed, k, JELLY_SALT * 7919 + tideId * 131);
  if (u01(h0) >= J.density) return null;
  const r = u01(hash32(h0, 6));
  return { ox: u01(hash32(h0, 2)) - 0.5, oz: u01(hash32(h0, 3)) - 0.5, yaw: u01(hash32(h0, 4)) * Math.PI * 2, r,
    size: J.widthM[0] + (J.widthM[1] - J.widthM[0]) * r };
}
