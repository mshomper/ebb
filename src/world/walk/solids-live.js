// @ts-check
// The game's solid things for the walker (solids.js; Matt, October 26, 2026: no walking through the
// workbench). Gathers them from the camp, the pieces and the boat, and hands the list to the walk
// whenever it changes:
//   camp slots marked "blocks" in the land recipe (docs/future/13 3.2), once something stands there:
//     the tent once pitched (a rectangle, w along the seaward axis), the ring once laid, the
//     workbench and apothecary bench, the rack and the hamper once built (benches turned to face the
//     ring, the rack turned by camp.json rack.yawDeg), the wood store always (its stakes), the stone
//     store and the heaps only while a pile is in them;
//   pieces: loose stones (circles), kept logs and strand driftwood (rectangles along their length),
//     the reed raft, a lantern's post; the piece being carried is left out;
//   the boat at its mooring.
// Stepping stones, Steps' slabs and holes stay open (footing, or small and filling in), and so do
// small things you walk over (twigs, pebbles, shells, finds, low plants).

import { get, subscribe } from '../../core/store.js';
import { cleanCamp, inSlot, pitched, ringLaid } from '../camp/model.js';

/** @typedef {import('./solids.js').Solid} Solid */

/**
 * The solids from the camp's slots. Pure.
 * @param {any} camp the store slice `camp` @param {any[]} slots campPad.camp.slots (the land recipe's)
 * @param {(id: string) => { x: number, z: number, yaw: number } | null} slotAt a slot in the world, its +z seaward
 * @param {(id: string) => { x: number, z: number, yaw: number } | null} benchAt a bench, turned to its work
 * @param {Set<string>} piled the pile slots holding a pile now
 * @param {number} rackYawDeg
 * @returns {Solid[]}
 */
export function campSolids(camp, slots, slotAt, benchAt, piled, rackYawDeg) {
  const c = cleanCamp(camp);
  /** @type {Solid[]} */ const out = [];
  for (const s of slots) {
    if (!s.blocks) continue;
    const id = s.id;
    const up = id === 'tent' ? pitched(c) : id === 'ring' ? ringLaid(c) : id === 'sticks' ? true
      : s.kinds?.includes('pile') ? piled.has(id) : !!inSlot(c, id);
    if (!up) continue;
    const at = s.faces ? benchAt(id) : slotAt(id);
    if (!at) continue;
    if (s.r !== undefined) { out.push({ x: at.x, z: at.z, r: s.r, id }); continue; }
    const w = s.w ?? 1, d = s.d ?? 1;
    // The tent: w along the seaward axis (its +z). A bench: w across, d toward its work. The rack: turned.
    if (id === 'tent') out.push({ x: at.x, z: at.z, yaw: at.yaw, hw: d / 2, hd: w / 2, id });
    else if (id === 'rack') out.push({ x: at.x, z: at.z, yaw: at.yaw + (rackYawDeg * Math.PI) / 180, hw: w / 2, hd: d / 2, id });
    else out.push({ x: at.x, z: at.z, yaw: at.yaw, hw: w / 2, hd: d / 2, id });
  }
  return out;
}

/**
 * The solids among the placed pieces. Pure.
 * @param {any[]} list the store slice `pieces` list @param {string | null} carried the piece being carried
 * @param {{ x: number, z: number, yaw: number, size: number, length: number }[]} strand driftwood on the strand now
 * @returns {Solid[]}
 */
export function pieceSolids(list, carried, strand) {
  /** @type {Solid[]} */ const out = [];
  const log = (/** @type {any} */ p, /** @type {string} */ id) => out.push({ x: p.x, z: p.z, yaw: p.yaw ?? 0, hw: (p.size ?? 0.15) / 2, hd: (p.length ?? 1) / 2, id });
  for (const p of list ?? []) {
    if (!p || p.id === carried) continue;
    if (p.kind === 'stone') out.push({ x: p.x, z: p.z, r: (p.size ?? 0.3) / 2, id: p.id });
    else if (p.kind === 'log') log(p, p.id);
    else if (p.kind === 'raft') out.push({ x: p.x, z: p.z, r: 0.6 * (p.size ?? 1.2), id: p.id });
    // A lantern's post (B2 L1): you step round it, as round a stone.
    else if (p.kind === 'lantern') out.push({ x: p.x, z: p.z, r: (p.size ?? 0.24) / 2, id: p.id });
  }
  for (const s of strand ?? []) log(s, `strand:${Math.round(s.x * 10)}:${Math.round(s.z * 10)}`);
  return out;
}

/**
 * Keep the walk's solids in step with the island.
 * @param {{ walk: { setSolids: (list: Solid[]) => void }, where: { slotAt: (id: string) => any }, benchAt: (id: string) => any,
 *   rackYawDeg: number, strand: () => any[], boat: () => { x: number, z: number, yaw: number } | null, boatSize: { beamM: number, lengthM: number } }} o
 */
export function createSolidsLive(o) {
  let key = '', strandKey = '', acc = 0, dirty = true;
  const refresh = () => {
    const pad = get('campPad');
    const pieces = get('pieces')?.list ?? [];
    const piled = new Set(pieces.filter((/** @type {any} */ p) => p.kind === 'pile' && p.slot).map((/** @type {any} */ p) => p.slot));
    const b = o.boat();
    const list = [
      ...(pad?.camp?.slots ? campSolids(get('camp'), pad.camp.slots, o.where.slotAt, o.benchAt, piled, o.rackYawDeg) : []),
      ...pieceSolids(pieces, get('carry')?.id ?? null, o.strand()),
      ...(b ? [{ x: b.x, z: b.z, yaw: b.yaw, hw: o.boatSize.beamM / 2, hd: o.boatSize.lengthM / 2, id: 'boat' }] : []),
    ];
    const next = JSON.stringify(list.map((s) => [s.id, +s.x.toFixed(2), +s.z.toFixed(2), +(s.yaw ?? 0).toFixed(2), s.r, s.hw, s.hd]));
    if (next !== key) { key = next; o.walk.setSolids(list); }
  };
  const mark = () => { dirty = true; };
  const offs = ['camp', 'campPad', 'pieces', 'carry'].map((slice) => subscribe(slice, mark));
  return {
    /** Each frame: refresh after a change; the strand's driftwood and the boat are looked at twice a second. @param {number} dt */
    update(dt) {
      acc += dt;
      if (acc >= 0.5) {
        acc = 0;
        const b = o.boat();
        const s = JSON.stringify(o.strand().map((l) => [Math.round(l.x * 10), Math.round(l.z * 10)])) + (b ? `${b.x.toFixed(1)},${b.z.toFixed(1)}` : '');
        if (s !== strandKey) { strandKey = s; dirty = true; }
      }
      if (dirty) { dirty = false; refresh(); }
    },
    dispose() { for (const off of offs) off(); },
  };
}
