// @ts-check
// Save format 1 to 2 (docs/future/01, F01b): seasons grew from 7 game days to 14. An island saved
// under 7-day seasons keeps its year, its season and its time of day, and each day d of the season
// becomes day 2d, so "Summer, day 3" opens as "Summer, day 5". Time only moves forward, never back.
// Every saved game time (the clock, hour and day stamps in the world and the journal) is mapped the
// same way, so dates read right and nothing that was in the future is now past. Gaps between
// stamps stretch a little, as after a catch-up: a plant due to spread, or a visiting frog due to
// settle, may do it on the first hour. Pure and deterministic.

import { SECONDS_PER_HOUR, SECONDS_PER_DAY, DAYS_PER_SEASON, seasonOf } from '../core/clock.js';

/** The old calendar. */
const OLD_DAYS_PER_SEASON = 7;
const OLD_SEASON_S = OLD_DAYS_PER_SEASON * SECONDS_PER_DAY;
const NEW_SEASON_S = DAYS_PER_SEASON * SECONDS_PER_DAY;

/**
 * Old-calendar game seconds to new: same year, season and time of day; day d becomes 2d.
 * @param {number} t game seconds, at least 0
 */
export function mapSeconds(t) {
  if (!(t > 0)) return t;
  const s = Math.floor(t / OLD_SEASON_S);
  const inSeason = t - s * OLD_SEASON_S;
  const d = Math.floor(inSeason / SECONDS_PER_DAY);
  const tod = inSeason - d * SECONDS_PER_DAY;
  return s * NEW_SEASON_S + 2 * d * SECONDS_PER_DAY + tod;
}

/** An hour index; negative values (never) stay. @param {number} h */
export const mapHour = (h) => (typeof h === 'number' && h >= 0 ? Math.round(mapSeconds(h * SECONDS_PER_HOUR) / SECONDS_PER_HOUR) : h);
/** A day index; negative values stay. @param {number} d */
export const mapDay = (d) => (typeof d === 'number' && d >= 0 ? Math.round(mapSeconds(d * SECONDS_PER_DAY) / SECONDS_PER_DAY) : d);

/**
 * "Summer, day 3" written under the old calendar to the new day (2d + 1, 1-based).
 * @param {string} text
 */
export function mapDateText(text) {
  return typeof text === 'string' ? text.replace(/\bday (\d+)\b/, (_, n) => `day ${2 * Number(n) - 1}`) : text;
}

/** @param {any} o @param {string[]} keys */
function hours(o, keys) { if (o) for (const k of keys) if (k in o) o[k] = mapHour(o[k]); }

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function calendar14(sections) {
  const s = structuredClone(sections);
  const meta = s.meta;
  if (meta && typeof meta.worldT === 'number') meta.worldT = mapSeconds(meta.worldT);

  const w = s.world;
  if (w) {
    // Derived from the hour; written fresh so the first frame before the next tick reads right.
    if (w.seasons && meta) {
      const n = seasonOf(Math.floor(meta.worldT / SECONDS_PER_HOUR) * SECONDS_PER_HOUR);
      Object.assign(w.seasons, { index: n.index, phase: n.phase, year: n.year, day: n.day });
    }
    for (const k of ['today', 'yesterday']) if (w.weather?.[k]) w.weather[k].day = mapDay(w.weather[k].day);
    for (const p of w.growth?.plants ?? []) if (p.last > 0) p.last = mapHour(p.last);
    const F = w.creatures?.frogs;
    if (F) {
      hours(F, ['cooldownUntil', 'lastJoin', 'lastLeft']);
      for (const f of F.frogs ?? []) hours(f, ['since', 'fedAt', 'namedAt']);
      for (const p of F.pending ?? []) hours(p, ['hour']);
    }
  }

  const j = s.journal;
  if (j) {
    hours(j, ['born', 'last']);
    for (const k of Object.values(j.species ?? {})) {
      hours(k, ['first', 'plantedAt', 'peakAt']);
      if (k?.moments) for (const id of Object.keys(k.moments)) k.moments[id] = mapHour(k.moments[id]);
    }
    for (const n of j.notes ?? []) { n.hour = mapHour(n.hour); n.date = mapDateText(n.date); }
  }
  return s;
}
