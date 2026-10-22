// @ts-check
// Where the camp is, for the pack (setting down at camp, the pile slots). A small adapter over the
// camp pad that E1 keeps (src/world/camp/layout.js; the store slice `campPad`), so the pack never
// reaches into the camp's internals. Until a pad is in the store (an island made before E1's pad
// lands), it falls back to the spec's starting pad (docs/future/13 section 3.1) and its pile slots
// (section 3.2), so setting down can still be tried.

import { get } from '../../core/store.js';

/** The pile slots in the pad's frame (u seaward, v to the left facing the sea), docs/future/13 3.2. */
const PILE_SLOTS = [
  { id: 'sticks', u: -1.9, v: -2.6 }, { id: 'stones', u: 1.3, v: -2.9 }, { id: 'clay', u: -0.3, v: -3.3 },
  { id: 'heap1', u: 2.9, v: -1.9 }, { id: 'heap2', u: 3.2, v: 1.4 }, { id: 'heap3', u: -3.35, v: -1.3 },
];
const PILE_IDS = new Set(PILE_SLOTS.map((s) => s.id));

/** The spec's starting pad, facing out from the island's middle (x, z of 12.5, -13; radius 4 m). */
const FALLBACK = (() => {
  const x = 12.5, z = -13, l = Math.hypot(x, z);
  return { x, z, r: 4, fx: x / l, fz: z / l, camp: null };
})();

/** The camp pad now: { x, z, r, fx, fz, camp } (camp: the land recipe's camp block, if known). */
export function campPadNow() {
  const p = get('campPad');
  return p && Number.isFinite(p.x) ? p : FALLBACK;
}

/**
 * The pile slots in world meters: { id, x, z, yaw }. From the camp block's slot list when it gives
 * them (slots with pile: true, or the six pile ids), else the spec's.
 */
export function pileSlots() {
  const pad = campPadNow();
  const listed = (pad.camp?.slots ?? []).filter((/** @type {any} */ s) => s.pile || PILE_IDS.has(s.id));
  const slots = listed.length ? listed : PILE_SLOTS;
  const seaward = Math.atan2(pad.fz, pad.fx);
  return slots.map((/** @type {{ id: string, u: number, v: number }} */ s) => ({
    id: s.id, x: pad.x + s.u * pad.fx + s.v * pad.fz, z: pad.z + s.u * pad.fz - s.v * pad.fx, yaw: seaward,
  }));
}

/**
 * On the camp ground, or within reach of its edge (Set down shows there, 4.1).
 * @param {number} x @param {number} z @param {number} [reachM]
 */
export function atCamp(x, z, reachM = 1.2) {
  const pad = campPadNow();
  return Math.hypot(x - pad.x, z - pad.z) <= pad.r + reachM;
}
