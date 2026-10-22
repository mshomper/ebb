// @ts-check
// Save format 8 to 9 (docs/future/13 section 12.1; October 22, 2026): the keeper's camp, the pack
// and gathering. One step adds every new section at once, so an older island loads with an empty
// pack, nothing gathered, nothing dug and no camp work. Pure and deterministic.
//
// This is the skeleton the Phase 1 pieces build on: each section starts as `{ version: 1 }` (gather
// also holds its event list). The camp ground (CP-07, CP-08) and the pack (`pack9`) fill in their own
// parts of the step here, and their own cleaners replace `clean9` for their section.

import { emptyPack, cleanPack } from '../world/pack/model.js';
import { cleanGather } from '../world/gather/events.js';

/** The sections format 9 brings in, in the order they are written. */
export const SECTIONS9 = /** @type {const} */ (['camp', 'pack', 'gather', 'dig', 'cook', 'dyes']);

/** @typedef {typeof SECTIONS9[number]} Section9 */

/**
 * A section as a new island starts it.
 * @param {Section9} id
 * @returns {Record<string, any>}
 */
export function empty9(id) {
  if (id === 'pack') return emptyPack();
  if (id === 'gather') return cleanGather(null);
  return { version: 1 };
}

/**
 * A section as saved: a copy if it reads, else empty. Missing or unreadable comes back empty.
 * @param {Section9} id @param {any} v
 */
export function clean9(id, v) {
  // The pack and gathering clean their own sections (src/world/pack/model.js, src/world/gather/events.js).
  if (id === 'pack') return cleanPack(v);
  if (id === 'gather') return cleanGather(v);
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.version !== 1) return empty9(id);
  const out = structuredClone(v);
  if (id === 'gather' && !Array.isArray(out.events)) out.events = [];
  return out;
}

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function format9(sections) {
  const s = structuredClone(sections);
  for (const id of SECTIONS9) s[id] = clean9(id, s[id]);
  return s;
}
