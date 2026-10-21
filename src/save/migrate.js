// @ts-check
// Save format upgrades (doc 18). FORMAT is the data schema of this build; an older save is brought
// forward one step at a time. Steps are pure and deterministic, and only ever go forward.

import { SaveError } from './world-file.js';
import { calendar14 } from './migrate-calendar.js';
import { naturalist3 } from './migrate-naturalist.js';
import { cliffs4 } from './migrate-cliffs.js';
import { pieces5 } from './migrate-pieces.js';
import { keepsakes6 } from './migrate-keepsakes.js';
import { nets7 } from './migrate-nets.js';

/** The data schema this build writes. */
export const FORMAT = 7;

/**
 * Ordered steps, each from one format to the next.
 * @type {{ from: number, to: number, note: string, up: (s: Record<string, any>) => Record<string, any> }[]}
 */
export const MIGRATIONS = [
  { from: 1, to: 2, note: '14-day seasons: same year, season and time of day; day d becomes 2d (src/save/migrate-calendar.js)', up: calendar14 },
  { from: 2, to: 3, note: "the naturalist's notes: shells become the first reward; an island that found them, or three kinds of finds, keeps them (src/save/migrate-naturalist.js)", up: naturalist3 },
  { from: 3, to: 4, note: "the frogs' gift is the Cliff tool: an island whose frogs gave their gift (lilies, then) keeps Terrace and Cut (src/save/migrate-cliffs.js)", up: cliffs4 },
  { from: 4, to: 5, note: 'placed pieces: a `pieces` section for loose stones, empty on an older island (src/save/migrate-pieces.js)', up: pieces5 },
  { from: 5, to: 6, note: 'the shelf: a `keepsakes` section for the keepsakes you keep, empty on an older island (src/save/migrate-keepsakes.js)', up: keepsakes6 },
  { from: 6, to: 7, note: 'the nets: a `nets` section, empty on an older island, and the keepsake families it has kept, from its shelf (src/save/migrate-nets.js)', up: nets7 },
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
