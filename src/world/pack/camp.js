// @ts-check
// Where the camp is, for the pack (setting down at camp, the pile slots). A small adapter over the
// camp pad that E1 keeps (the store slice `campPad`; src/world/camp/layout.js), so the pack never
// reaches into the camp's internals. The pad is { x, z, r, h, blend, fx, fz, ..., camp }, camp being
// the land recipe's camp block (its slots); an older island has none until it is stamped on its
// first load (camp:stamped). Until a pad is in the store, it falls back to the new island's pad
// (world 0.6, -33.3, facing 0.69, -0.72) and the spec's pile slots (docs/future/13 section 3.2).

import { get } from '../../core/store.js';

/** The pile slots in the pad's frame (u seaward, v to the left facing the sea), docs/future/13 3.2. */
const PILE_SLOTS = [
  { id: 'sticks', u: -1.9, v: -2.6 }, { id: 'stones', u: 1.3, v: -2.9 }, { id: 'clay', u: -0.3, v: -3.3 },
  { id: 'heap1', u: 2.9, v: -1.9 }, { id: 'heap2', u: 3.2, v: 1.4 }, { id: 'heap3', u: -3.35, v: -1.3 },
];
const PILE_IDS = new Set(PILE_SLOTS.map((s) => s.id));

/** The new island's pad, until the store has one. */
const FALLBACK = (() => {
  const l = Math.hypot(0.69, -0.72);
  return { x: 0.6, z: -33.3, r: 4, fx: 0.69 / l, fz: -0.72 / l, camp: null };
})();

/** The camp pad now (E1's `campPad`, else the fallback). */
export function campPadNow() {
  const p = get('campPad');
  return p && Number.isFinite(p.x) ? p : FALLBACK;
}

/** A point in the pad's frame in world meters (as layout.js padToWorld). @param {any} pad @param {number} u @param {number} v */
const toWorld = (pad, u, v) => [pad.x + u * pad.fx + v * pad.fz, pad.z + u * pad.fz - v * pad.fx];

/**
 * The pile slots in world meters: { id, x, z, yaw }. From the camp block's slot list when it gives
 * them (slots with pile: true, or the six pile ids), else the spec's.
 */
export function pileSlots() {
  const pad = campPadNow();
  const listed = (pad.camp?.slots ?? []).filter((/** @type {any} */ s) => s.pile || PILE_IDS.has(s.id));
  const slots = listed.length ? listed : PILE_SLOTS;
  const seaward = Math.atan2(pad.fz, pad.fx);
  return slots.map((/** @type {{ id: string, u: number, v: number }} */ s) => {
    const [x, z] = toWorld(pad, s.u, s.v);
    return { id: s.id, x, z, yaw: seaward };
  });
}

/**
 * On the camp ground (layout.js onPad), or within arm's reach of its edge: Set down shows there
 * (docs/future/13 4.1, "on the camp ground or within reach of its edge").
 * @param {number} x @param {number} z @param {number} [reachM]
 */
export function atCamp(x, z, reachM = 0.9) {
  const pad = campPadNow();
  return (x - pad.x) ** 2 + (z - pad.z) ** 2 <= (pad.r + reachM) ** 2;
}
