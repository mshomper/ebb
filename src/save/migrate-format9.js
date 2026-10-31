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
import { cleanDig, emptyDig } from '../world/dig/rest.js';
import { cleanCook } from '../world/camp/making.js';
import { cleanBook, emptyBook } from '../world/sketchbook/model.js';
import { cleanKit, emptyKit } from '../world/kit/model.js';
import { cleanThreads, emptyThreads } from '../world/threads/model.js';
import { cleanFishing, emptyFishing } from '../world/fishing/model.js';

/** The sections format 9 brings in, in the order they are written. */
export const SECTIONS9 = /** @type {const} */ (['camp', 'pack', 'gather', 'dig', 'cook', 'dyes', 'sketchbook', 'kit', 'threads', 'fishing']);

/** @typedef {typeof SECTIONS9[number]} Section9 */

/**
 * A section as a new island starts it.
 * @param {Section9} id
 * @returns {Record<string, any>}
 */
export function empty9(id) {
  if (id === 'pack') return emptyPack();
  if (id === 'gather') return cleanGather(null);
  if (id === 'dig') return emptyDig();
  if (id === 'cook') return cleanCook(null);
  if (id === 'sketchbook') return emptyBook();
  if (id === 'kit') return emptyKit();
  if (id === 'threads') return emptyThreads();
  if (id === 'fishing') return emptyFishing();
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
  // Digging's dug events and firsts (src/world/dig/rest.js).
  if (id === 'dig') return cleanDig(v);
  // What was made at camp: firsts, counts and tools (S1, src/world/camp/making.js).
  if (id === 'cook') return cleanCook(v);
  // The walker's sketchbook (P2i): it joined the list later, and a save without it reads as an
  // empty book, so it needs no step of its own (src/world/sketchbook/model.js).
  if (id === 'sketchbook') return cleanBook(v);
  // The walker's kit (the Walker page, K1): likewise, a save without it reads as the walker's own
  // things (src/world/kit/model.js).
  if (id === 'kit') return cleanKit(v);
  // The Keeper book's threads (src/world/threads/model.js): likewise, a save without them reads as
  // nothing written yet.
  if (id === 'threads') return cleanThreads(v);
  // Fishing (docs/future/17, src/world/fishing/model.js): likewise, a save without it reads as
  // nothing sketched yet.
  if (id === 'fishing') return cleanFishing(v);
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
