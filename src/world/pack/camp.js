// @ts-check
// Where the camp is, for the pack (setting down at camp, the pile slots). A small adapter over the
// camp pad that E1 keeps (the store slice `campPad`; src/world/camp/layout.js), so the pack never
// reaches into the camp's internals. An older island has no pad until it is stamped on its first
// load (camp:stamped); until then there is no camp to set down at.

import { get } from '../../core/store.js';
import { onPad, slotWorld } from '../camp/layout.js';

/** The camp pad now, or null. @returns {import('../camp/layout.js').Pad | null} */
export const campPadNow = () => get('campPad') ?? null;

/**
 * The pile slots in world meters: { id, x, z, yaw }, from the camp block's slot list (the slots
 * that take a pile, docs/future/13 section 3.2). None without a pad.
 */
export function pileSlots() {
  const pad = campPadNow();
  if (!pad) return [];
  return (pad.camp?.slots ?? [])
    .filter((/** @type {any} */ s) => s.pile || (s.kinds ?? []).includes('pile'))
    .map((/** @type {any} */ s) => ({ id: s.id, ...slotWorld(pad, s) }));
}

/**
 * On the camp ground (layout.js onPad), or within arm's reach of its edge: Set down shows there
 * (docs/future/13 4.1, "on the camp ground or within reach of its edge").
 * @param {number} x @param {number} z @param {number} [reachM]
 */
export function atCamp(x, z, reachM = 0.9) {
  const pad = campPadNow();
  if (!pad) return false;
  return onPad(pad, x, z) || onPad({ ...pad, r: pad.r + reachM }, x, z);
}
