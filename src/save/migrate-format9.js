// @ts-check
// Save format 8 to 9 (docs/future/13 section 12.1; October 22, 2026): the keeper's camp, the pack
// and gathering. One step adds every new section at once, so an older island loads with an empty
// pack, nothing gathered, nothing dug and no camp work. Pure and deterministic.
//
// This is the skeleton the Phase 1 pieces build on: each section starts as `{ version: 1 }` (gather
// also holds its event list). The camp ground (CP-07, CP-08) and the pack (`pack9`) fill in their own
// parts of the step here, and their own cleaners replace `clean9` for their section.

/** The sections format 9 brings in, in the order they are written. */
export const SECTIONS9 = /** @type {const} */ (['camp', 'pack', 'gather', 'dig', 'cook', 'dyes']);

/** @typedef {typeof SECTIONS9[number]} Section9 */

/**
 * A section as a new island starts it.
 * @param {Section9} id
 * @returns {Record<string, any>}
 */
export function empty9(id) {
  if (id === 'gather') return { version: 1, events: [] };
  return { version: 1 };
}

/**
 * A section as saved: a copy if it reads, else empty. Missing or unreadable comes back empty.
 * @param {Section9} id @param {any} v
 */
export function clean9(id, v) {
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
  return camp9(s);
}

/**
 * The camp part of the step (section 3.8): an older island skips the first evening, so its camp
 * waits unstamped with the tent in the pack, and its journal marks the evening done for an older
 * island. The pad itself is laid on the first load (src/world/camp/stamp.js), since this step is
 * pure and cannot see heights.
 * @param {Record<string, any>} s  sections, already copied
 */
function camp9(s) {
  if (s.camp.stamped === undefined) s.camp = { ...s.camp, stamped: false, kit: { tent: 'pack', lantern: 'pole' } };
  if (s.journal && typeof s.journal === 'object') {
    const flags = Array.isArray(s.journal.flags) ? s.journal.flags : [];
    s.journal.flags = [...flags, ...['intro:done', 'intro:older'].filter((f) => !flags.includes(f))];
  }
  return s;
}
