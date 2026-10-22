// @ts-check
// The camp's saved state (docs/future/13 section 3.4, save format 9 section `camp`): where the pad is
// (E1: pad, stamped), the carried kit (the tent in the pack or pitched; the lantern on its pole),
// what fills the slots (the tent and the fire ring, E3), the fire (fire.js) and the last rest. Only
// what the player did is kept; everything drawn is worked out from it. Pure.

import { cleanFire, noFire, layFire } from './fire.js';

/**
 * @typedef {{ slot: string, kind: string, seed: number, placedHour: number }} SlotRecord
 * @typedef {{ version: number, stamped?: boolean, pad?: any, kit: { tent: 'pack' | 'pitched' | 'boat', lantern: 'pole' | 'carried' },
 *   slots: SlotRecord[], fire: import('./fire.js').Fire, rested: { hour: number, at: number } | null, firstPitchedHour: number | null }} Camp
 *   Other fields a save carries (E1's, later phases') are kept as they are.
 */

const TENT = ['pack', 'pitched', 'boat'];

/**
 * A saved (or new) camp section made safe and complete: the tent in the pack, nothing in the slots
 * and no fire unless it says otherwise. Fields this build does not know are kept.
 * @param {any} v @returns {Camp}
 */
export function cleanCamp(v) {
  const c = v && typeof v === 'object' && !Array.isArray(v) ? structuredClone(v) : {};
  const kitIn = c.kit && typeof c.kit === 'object' ? c.kit : {};
  /** @type {SlotRecord[]} */ const slots = [];
  for (const s of Array.isArray(c.slots) ? c.slots : []) {
    if (!s || typeof s.slot !== 'string' || typeof s.kind !== 'string' || slots.some((q) => q.slot === s.slot)) continue;
    slots.push({ slot: s.slot, kind: s.kind, seed: (Number(s.seed) >>> 0), placedHour: Number.isFinite(s.placedHour) ? s.placedHour : 0 });
  }
  const tent = TENT.includes(kitIn.tent) ? kitIn.tent : slots.some((s) => s.kind === 'tent') ? 'pitched' : 'pack';
  const rested = c.rested && Number.isFinite(c.rested.hour) && Number.isFinite(c.rested.at) ? { hour: c.rested.hour, at: c.rested.at } : null;
  return { ...c, version: 1, kit: { ...kitIn, tent, lantern: 'pole' }, slots, fire: cleanFire(c.fire), rested,
    firstPitchedHour: Number.isFinite(c.firstPitchedHour) ? c.firstPitchedHour : null };
}

/** What fills a slot, or null. @param {Camp} c @param {string} slot */
export const inSlot = (c, slot) => c.slots.find((s) => s.slot === slot) ?? null;

/** Is the tent up? @param {Camp} c */
export const pitched = (c) => c.kit.tent === 'pitched' && !!inSlot(c, 'tent');

/** Is the ring laid (whatever its fire is doing)? @param {Camp} c */
export const ringLaid = (c) => !!inSlot(c, 'ring');

/**
 * The tent pitched in its slot (camp:pitched). The same camp when it is already up.
 * @param {Camp} c @param {number} hour @param {number} seed @returns {Camp}
 */
export function pitchTent(c, hour, seed) {
  if (pitched(c)) return c;
  return { ...c, kit: { ...c.kit, tent: 'pitched' }, slots: [...c.slots.filter((s) => s.slot !== 'tent'), { slot: 'tent', kind: 'tent', seed: seed >>> 0, placedHour: hour }],
    firstPitchedHour: c.firstPitchedHour ?? hour };
}

/**
 * The fire ring laid, cold, in its slot (camp:ring-laid). The same camp when it is already laid.
 * @param {Camp} c @param {number} hour @param {number} seed @returns {Camp}
 */
export function layRing(c, hour, seed) {
  if (ringLaid(c)) return c;
  return { ...c, slots: [...c.slots, { slot: 'ring', kind: 'ring', seed: seed >>> 0, placedHour: hour }], fire: layFire(c.fire.state === 'none' ? noFire() : c.fire, hour) };
}
