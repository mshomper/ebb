// @ts-check
// The journal's look at the island after a game hour (or an edit), as one pure step (docs 13, 18):
// observe what changed, write and number its notes, then ink any link of the web now seen. Live
// play (index.js) and catch-up (src/sim/hour.js) both run exactly this, so an hour you were away
// writes the same notes as an hour you watched.

import { observe } from './observe.js';
import { inkWeb } from './web.js';
import { groundSurvey } from './ground.js';
import { stampNotes } from './read.js';

/**
 * @typedef {Object} LookContext
 * @property {any} state      the world state after the hour
 * @property {any[]} events   that hour's tick events ([] after an edit)
 * @property {number} hour
 * @property {any} habitat    the habitat grid, or null before the first water summary
 * @property {Uint8Array | null} material  the terrain's painted materials (rgba8 per 0.25 m texel)
 * @property {any} words      recipes/world/journal.json
 * @property {any} island     recipes/world/journal-island.json
 * @property {any} web        recipes/world/journal-web.json
 * @property {number} [paintVersion]  bumps when paint changes (a cache key only)
 * @property {Record<string, number> | null} [shore]  the shore zones and rock pools now (shore-presence.js);
 *   catch-up has none, so links that need them ink on the next live look
 */

/**
 * @param {any} journal @param {LookContext} ctx
 * @returns {{ journal: any, notes: any[] }} the new journal and its new notes, numbered, oldest first
 */
export function journalLook(journal, ctx) {
  const { state, events, hour, habitat, words } = ctx;
  const seen = observe(journal, { state, events, hour, habitat, words });
  let j = stampNotes(seen.journal, seen.notes);
  const notes = seen.notes.slice();
  if (habitat) {
    const ground = groundSurvey(habitat, ctx.material, state, ctx.island, ctx.paintVersion ?? 0);
    const survey = ctx.shore ? { ...ground, shore: ctx.shore } : ground;
    const inked = inkWeb(j, survey, { web: ctx.web, words, state, hour });
    j = stampNotes(inked.journal, inked.notes);
    notes.push(...inked.notes);
  }
  return { journal: j, notes };
}
