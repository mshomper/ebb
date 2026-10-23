// @ts-check
// The keeper's camp pad and its frame (docs/future/13 sections 3.1, 3.2, 3.4). Pure.
//
// The live pad is the store slice `campPad` (a Pad, or null on an older island until its pad is
// stamped). Everything that keeps the pad clear reads that one value: the brushes (CPU and GPU),
// erosion, boulders, the tap refusals, the dashed edge, the trodden look, grass and plants.

import { campOf } from '../terrain/landform.js';

/**
 * @typedef {Object} Pad
 * @property {number} x @property {number} z  center (world m)
 * @property {number} r       radius (m), the level, locked ground
 * @property {number} h       level at its center (m)
 * @property {number} fall    how far it falls toward the sea from its center to its seaward edge (m; landform.js padLevel)
 * @property {number} blend   the soft fall back to natural ground outside r (m)
 * @property {number} fx @property {number} fz  seaward unit vector (u); v, to the left facing the sea, is (fz, -fx)
 * @property {number} lockFadeM  brushes fade from nothing at r to full at r + lockFadeM
 * @property {any} dash       { dashM, gapM, widthM, opacity, showWithinM }
 * @property {number} wear @property {number} edgeWearM  the trodden look
 * @property {number} grassScale  grass height on the pad
 * @property {any} camp       the land recipe's whole camp block (slots, offPad, mooring)
 */

/**
 * The pad from a land recipe, at the recipe's spot or (an older island's) where it was stamped.
 * @param {any} land  the land recipe
 * @param {{ x: number, z: number, heightM?: number, facingDeg?: number } | null} [at]  camp.pad from the save, if any
 * @returns {Pad | null}
 */
export function padOf(land, at = null) {
  const p = campOf(land);
  if (!p) return null;
  const C = land.camp;
  let { x, z, h, fx, fz } = p;
  if (at) {
    x = at.x; z = at.z; h = at.heightM ?? h;
    if (typeof at.facingDeg === 'number') { fx = Math.cos(at.facingDeg * Math.PI / 180); fz = Math.sin(at.facingDeg * Math.PI / 180); }
  }
  return { x, z, r: p.r, h, blend: p.blend, fx, fz, fall: C.fallM ?? 0, lockFadeM: C.lockFadeM, dash: C.dash, wear: C.wear,
    edgeWearM: C.edgeWearM, grassScale: C.grassScale, camp: C };
}

/**
 * The lock mask: 0 on the pad, rising to 1 over lockFadeM outside it (smoothstep), 1 with no pad.
 * Multiplies every brush's falloff, as the open-land edge fade does.
 * @param {Pad | null} pad @param {number} x @param {number} z
 */
export function padMask(pad, x, z) {
  if (!pad) return 1;
  const d = Math.hypot(x - pad.x, z - pad.z);
  const t = Math.min(1, Math.max(0, (d - pad.r) / pad.lockFadeM));
  return t * t * (3 - 2 * t);
}

/** True when (x, z) is on the pad itself. @param {Pad | null} pad @param {number} x @param {number} z */
export function onPad(pad, x, z) {
  return !!pad && (x - pad.x) ** 2 + (z - pad.z) ** 2 <= pad.r * pad.r;
}

/**
 * A point in the pad's frame (u seaward, v to the left facing the sea) in world meters.
 * @param {Pad} pad @param {number} u @param {number} v @returns {[number, number]}
 */
export function padToWorld(pad, u, v) {
  return [pad.x + u * pad.fx + v * pad.fz, pad.z + u * pad.fz - v * pad.fx];
}

/**
 * A slot's center in world meters, and its yaw (radians about +y, 0 facing +x) when it has one.
 * @param {Pad} pad @param {{ u: number, v: number, yaw?: string }} slot
 */
export function slotWorld(pad, slot) {
  const [x, z] = padToWorld(pad, slot.u, slot.v);
  const seaward = Math.atan2(pad.fz, pad.fx);
  const yaw = slot.yaw === 'alongV' ? seaward + Math.PI / 2 : seaward;
  return { x, z, yaw };
}
