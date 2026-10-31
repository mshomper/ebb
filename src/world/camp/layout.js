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
  const yaw = slot.yaw === 'alongV' ? seaward + Math.PI / 2 : slot.yaw === 'inward' ? Math.atan2(pad.z - z, pad.x - x) : seaward;
  return { x, z, yaw };
}

/**
 * A slot as it stands: the land recipe's slot, at its saved record's own u, v when it has one (a rim
 * slot, placed when made: the nest box). @param {any} slot @param {any} [record] the camp section's slot record
 */
export function slotPlaced(slot, record) {
  return record && Number.isFinite(record.u) && Number.isFinite(record.v) ? { ...slot, u: record.u, v: record.v } : slot;
}

/**
 * A slot's footprint in the pad's frame, for keeping the slots apart (the tests, the nest box's rim
 * place): a circle { u, v, r }, or a box { u, v, hu, hv, a } with half sizes along its own two axes,
 * a the angle of its first axis from +u toward +v (radians). A bench turns to the slot it faces (d
 * toward it, w across); the tent and the rack lie with w along u; the seat runs maxLengthM along v; a
 * slot turned inward (the keepsake shelf) has d toward the pad's middle and w across. Null for a slot
 * that stands on another's thing (the mortar on the apothecary bench).
 * @param {any} s the slot @param {any[]} slots the camp block's slots
 * @returns {{ u: number, v: number, r?: number, hu?: number, hv?: number, a?: number } | null}
 */
export function slotFootprint(s, slots) {
  if (s.on) return null;
  if (s.r !== undefined) return { u: s.u, v: s.v, r: s.r };
  if (s.yaw === 'alongV') return { u: s.u, v: s.v, hu: 0.15, hv: (s.maxLengthM ?? 1.6) / 2, a: 0 };
  if (s.yaw === 'inward') return { u: s.u, v: s.v, hu: (s.d ?? 0.5) / 2, hv: (s.w ?? 1) / 2, a: Math.atan2(s.v, s.u) };
  const f = s.faces ? slots.find((q) => q.id === s.faces) : null;
  if (f) return { u: s.u, v: s.v, hu: (s.d ?? 0.6) / 2, hv: (s.w ?? 1) / 2, a: Math.atan2(s.v - f.v, s.u - f.u) };
  return { u: s.u, v: s.v, hu: (s.w ?? 1) / 2, hv: (s.d ?? 1) / 2, a: 0 };
}

/**
 * The room a slot keeps clear in front of it (the keepsake shelf's frontM, so its keepsakes can be
 * seen and reached), as a box in the pad's frame, or null. @param {any} s
 */
export function slotRoom(s) {
  if (!s.frontM || s.yaw !== 'inward') return null;
  const a = Math.atan2(s.v, s.u), back = (s.d ?? 0.5) / 2 + s.frontM / 2;
  return { u: s.u - Math.cos(a) * back, v: s.v - Math.sin(a) * back, hu: s.frontM / 2, hv: (s.w ?? 1) / 2, a };
}

/**
 * How far a circle (u, v, r) stands clear of a footprint (negative: they overlap). Pure.
 * @param {{ u: number, v: number, r?: number, hu?: number, hv?: number, a?: number }} f @param {number} u @param {number} v @param {number} r
 */
export function clearOf(f, u, v, r) {
  if (f.r !== undefined) return Math.hypot(u - f.u, v - f.v) - f.r - r;
  const c = Math.cos(f.a ?? 0), s = Math.sin(f.a ?? 0), du = u - f.u, dv = v - f.v;
  const p = du * c + dv * s, q = -du * s + dv * c;
  const ex = Math.max(Math.abs(p) - (f.hu ?? 0), 0), ey = Math.max(Math.abs(q) - (f.hv ?? 0), 0);
  const inside = Math.abs(p) <= (f.hu ?? 0) && Math.abs(q) <= (f.hv ?? 0);
  return inside ? -r - Math.min((f.hu ?? 0) - Math.abs(p), (f.hv ?? 0) - Math.abs(q)) : Math.hypot(ex, ey) - r;
}

/**
 * A slot with a `rim` (the nest box) placed on the pad's rim, on the side toward a world point (the
 * hen's home bushes): rim.rM from the middle, starting at that bearing and stepping rim.stepDeg either
 * way (nearer first, toward +v first) up to rim.maxDeg, the first place gapM clear of every other
 * slot's footprint and room. Null with no point, or no room (the slot keeps its own u, v: the home
 * corner). Pure, so the same bushes always give the same place.
 * @param {Pad} pad @param {any} slot @param {{ x: number, z: number } | null} toward
 * @returns {{ u: number, v: number } | null}
 */
export function rimSpot(pad, slot, toward) {
  const R = slot?.rim;
  if (!R || !toward) return null;
  const dx = toward.x - pad.x, dz = toward.z - pad.z;
  const du = dx * pad.fx + dz * pad.fz, dv = dx * pad.fz - dz * pad.fx;
  if (Math.hypot(du, dv) < 1e-6) return null;
  const slots = pad.camp?.slots ?? [];
  const feet = [];
  for (const q of slots) {
    if (q.id === slot.id) continue;
    const f = slotFootprint(q, slots), room = slotRoom(q);
    if (f) feet.push(f);
    if (room) feet.push(room);
  }
  const a0 = Math.atan2(dv, du), step = ((R.stepDeg ?? 5) * Math.PI) / 180, n = Math.floor((R.maxDeg ?? 120) / (R.stepDeg ?? 5));
  const r = slot.r ?? 0.25, gap = R.gapM ?? 0.15;
  for (let i = 0; i <= 2 * n; i++) {
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const a = a0 + k * step, u = Math.round(Math.cos(a) * R.rM * 100) / 100, v = Math.round(Math.sin(a) * R.rM * 100) / 100;
    if (feet.every((f) => clearOf(f, u, v, r) >= gap)) return { u, v };
  }
  return null;
}
