// @ts-check
// Where the camp's things stand in the world, live (docs/future/13 sections 3.2 and 3.4): a slot's
// ground point and the yaw that turns a model seaward, the tent's flap, a point in the tent model's
// frame, and whether a ground point is on the tent's footprint. Reads the store slice `campPad`
// (layout.js) and the terrain's height; changes nothing.

import { get } from '../../core/store.js';
import { padToWorld } from './layout.js';

/** @param {{ terrain: { sampleHeight: (x: number, z: number) => number } }} o */
export function createWhere(o) {
  /** @returns {import('./layout.js').Pad | null} */
  const padNow = () => get('campPad') ?? null;
  /** A slot's ground point and the yaw that turns a model's +z seaward. @param {string} id */
  function slotAt(id) {
    const pad = padNow();
    const s = pad?.camp?.slots?.find((/** @type {any} */ q) => q.id === id);
    if (!pad || !s) return null;
    const [x, z] = padToWorld(pad, s.u, s.v);
    return { x, z, y: o.terrain.sampleHeight(x, z), yaw: Math.atan2(pad.fx, pad.fz), slot: s };
  }
  /** Where you kneel at the tent's flap, facing the sea (the evening's flapSpot). */
  function flapAt() {
    const pad = padNow(), t = slotAt('tent');
    if (!pad || !t) return null;
    const [x, z] = padToWorld(pad, t.slot.u + (t.slot.w ?? 2.2) / 2 + 0.6, t.slot.v);
    return { x, z, yaw: Math.atan2(pad.fx, pad.fz) };
  }
  /** A point in the tent model's frame, in the world. @param {number[]} p */
  function tentPoint(p) {
    const t = /** @type {any} */ (slotAt('tent'));
    const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    return [t.x + c * p[0] + s * p[2], t.y + p[1], t.z - s * p[0] + c * p[2]];
  }
  /**
   * Is a ground point on the tent's footprint (its slot, w along u and d along v), grown by margin?
   * @param {number} x @param {number} z @param {number} [margin]
   */
  function inTent(x, z, margin = 0) {
    const pad = padNow(), t = slotAt('tent');
    if (!pad || !t) return false;
    const dx = x - t.x, dz = z - t.z;
    const u = dx * pad.fx + dz * pad.fz, v = dx * pad.fz - dz * pad.fx;
    return Math.abs(u) <= (t.slot.w ?? 2.2) / 2 + margin && Math.abs(v) <= (t.slot.d ?? 1.6) / 2 + margin;
  }
  return { padNow, slotAt, flapAt, tentPoint, inTent };
}

/** @typedef {ReturnType<typeof createWhere>} Where */
