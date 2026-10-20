// @ts-check
// Save format upgrades (doc 18). FORMAT is the data schema of this build; an older save is brought
// forward one step at a time. Steps are pure and deterministic, and only ever go forward.

import { SaveError } from './world-file.js';
import { calendar14 } from './migrate-calendar.js';

/** The data schema this build writes. */
export const FORMAT = 2;

/**
 * Ordered steps, each from one format to the next.
 * @type {{ from: number, to: number, note: string, up: (s: Record<string, any>) => Record<string, any> }[]}
 */
export const MIGRATIONS = [
  { from: 1, to: 2, note: '14-day seasons: same year, season and time of day; day d becomes 2d (src/save/migrate-calendar.js)', up: calendar14 },
];

/**
 * Bring sections from an older format to FORMAT.
 * @param {Record<string, any>} sections @param {number} fromFormat
 * @returns {Record<string, any>}
 */
export function migrate(sections, fromFormat) {
  if (!(fromFormat >= 1)) throw new SaveError(`unknown save format ${fromFormat}`);
  if (fromFormat > FORMAT) throw new SaveError(`this island was saved by a newer build (format ${fromFormat})`);
  let s = sections;
  for (let f = fromFormat; f < FORMAT; f++) {
    const step = MIGRATIONS.find((m) => m.from === f);
    if (!step) throw new SaveError(`no upgrade from save format ${f}`);
    s = step.up(s);
  }
  return s;
}
