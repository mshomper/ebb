// @ts-check
// The camp's keeps, live (docs/future/13 3.12, S2 and P2j): the drying rack in its slot beside the
// apothecary bench, where herbs hang in bunches and dry by the clock over rack.dryDays (worked out
// from the hour each was hung, so live play and catch-up agree), and the rush hamper among the stores,
// 6 slots, 12 once a second hamper stacks on it. Both are camp slot records (model.js; the rack's
// `bunches`, the hamper's `stack` and `holds`), changed only through the camp's change. Once a hamper
// stands, the three loose heaps retire into it (Matt, October 24, 2026). Draws the rack and its
// bunches (Matt's own, lifted off his model) and the mortar and pestle on the bench; the hamper is
// drawn with the stores (src/world/pack/draw.js).
// Pure rules: src/world/pack/store.js (the hamper), src/world/pack/piles.js (the bunches).

import { emitDeferred } from '../../core/events.js';
import { inSlot } from './model.js';
import { put, take, takeSlot, room, holdsOf, slotsOf, capOf } from '../pack/store.js';
import { hang, takeBunch, dryShare } from '../pack/piles.js';
import { hash32 } from '../../core/rng.js';

/**
 * @param {{ R: any, P: any, camp: () => import('./model.js').Camp, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   where: import('./where.js').Where, hourNow: () => number, benchAt: (id: string) => any, piles?: any }} k
 *   R: recipes/world/camp.json; P: recipes/world/pack.json; benchAt: the stations' bench pose
 */
export function createKeeps(k) {
  const R = k.R, P = k.P;
  const perPouch = P.handfulsPerPouch ?? 3;
  const rec = (/** @type {string} */ slot) => inSlot(k.camp(), slot);
  /** Change one slot record's fields. @param {string} slot @param {Record<string, any>} fields */
  const patch = (slot, fields) => k.change((c) => ({ ...c, slots: c.slots.map((s) => (s.slot === slot ? { ...s, ...fields } : s)) }));
  const spot = (/** @type {string} */ id) => { const s = k.where.slotAt(id); return s ? { x: s.x, z: s.z } : null; };
  /** The rack's places for bunches: its hang points, no more than the pack recipe allows. */
  const places = () => Math.min(R.rack.hangs.length, P.piles?.rackBunches ?? R.rack.hangs.length);

  const hamper = {
    here: () => !!rec('store'),
    /** How many slots it has now (6, or 12 stacked). */
    slots: () => slotsOf(rec('store')?.stack ?? 1, P),
    holds: () => holdsOf(rec('store')?.holds ?? []),
    /** Put handfuls in; how many went. @param {string} kind @param {number} n */
    put(kind, n) {
      const r = rec('store');
      if (!r) return 0;
      const p = put(r.holds ?? [], kind, n, capOf(P), slotsOf(r.stack ?? 1, P));
      if (p.moved > 0) { patch('store', { holds: p.holds }); emitDeferred('store:changed', { kind }); }
      return p.moved;
    },
    /** Room for a handful of this kind? @param {string} kind */
    room: (kind) => { const r = rec('store'); return !!r && room(r.holds ?? [], kind, capOf(P), slotsOf(r.stack ?? 1, P)); },
    /** Take handfuls out (a make drawing from the store); how many came. @param {string} kind @param {number} n */
    take(kind, n) {
      const r = rec('store');
      if (!r) return 0;
      const t = take(r.holds ?? [], kind, n);
      if (t.taken > 0) { patch('store', { holds: t.holds }); emitDeferred('store:changed', { kind }); }
      return t.taken;
    },
    /**
     * Take up on a slot: one pouch's worth into the pack. @param {number} i
     * @param {(kind: string, n: number) => { added: number }} add the pack's add
     * @returns {{ taken: number, kind: string | null, full: boolean }} full: the pack had no room
     */
    takeUp(i, add) {
      const r = rec('store'), s = r?.holds?.[i];
      if (!r || !s) return { taken: 0, kind: null, full: false };
      const added = Math.max(0, Math.min(Math.min(s[1], perPouch), add(s[0], Math.min(s[1], perPouch)).added));
      if (!added) return { taken: 0, kind: s[0], full: true };
      patch('store', { holds: takeSlot(r.holds ?? [], i, added).holds });
      emitDeferred('store:changed', { kind: s[0] });
      return { taken: added, kind: s[0], full: false };
    },
    at: () => spot('store'),
  };

  const rack = {
    here: () => !!rec('rack'),
    /** The bunches now: kind, handfuls, how dry (0..1). */
    bunches: () => (rec('rack')?.bunches ?? []).map(([kind, h, at]) => ({ kind, handfuls: h, dry: dryShare(at, k.hourNow(), R.rack.dryDays) })),
    /** Hang handfuls of a herb; how many went. @param {string} kind @param {number} n */
    hang(kind, n) {
      const r = rec('rack');
      if (!r) return 0;
      const h = hang(r.bunches ?? [], kind, n, k.hourNow(), P.piles?.rackHandfuls ?? 6, places());
      if (h.moved > 0) { patch('rack', { bunches: h.bunches }); emitDeferred('rack:hung', { kind, handfuls: h.moved }); }
      return h.moved;
    },
    /** Room for a handful of this herb? @param {string} kind */
    room(kind) {
      const r = rec('rack');
      return !!r && hang(r.bunches ?? [], kind, 1, k.hourNow(), P.piles?.rackHandfuls ?? 6, places()).moved > 0;
    },
    /** Take a bunch down into the pack (Take up on the rack). @param {number} i @param {(kind: string, n: number) => { added: number }} add */
    takeUp(i, add) {
      const r = rec('rack'), b = r?.bunches?.[i];
      if (!r || !b) return { taken: 0, kind: null, full: false };
      const want = Math.min(b[1], perPouch), added = Math.max(0, Math.min(want, add(b[0], want).added));
      if (!added) return { taken: 0, kind: b[0], full: true };
      patch('rack', { bunches: takeBunch(r.bunches ?? [], i, added).bunches });
      return { taken: added, kind: b[0], full: false };
    },
    at: () => spot('rack'),
  };

  /**
   * Once a hamper stands, what the loose heaps hold moves into it, as far as it fits (heaps retire).
   * Returns how many handfuls moved.
   */
  function retireHeaps() {
    if (!hamper.here() || !k.piles) return 0;
    let moved = 0;
    for (const p of k.piles.piles()) {
      if (!/^heap\d+$/.test(p.slot)) continue;
      for (let guard = 0; guard < 8; guard++) {
        const r = k.piles.takeUp(p.id, (/** @type {string} */ kind, /** @type {number} */ n) => ({ added: hamper.put(kind, n) }));
        if (!r.taken) break;
        moved += r.taken;
      }
    }
    return moved;
  }

  /** The keeps drawn now: the rack and its bunches, the mortar and pestle on the bench, the hamper. */
  function props() {
    const out = [];
    const M = R.props.models;
    const rk = k.where.slotAt('rack'), rr = rec('rack');
    if (rk && rr) {
      // The rack faces along its slot (alongU); its bunches hang from Matt's own hang points.
      const yaw = rk.yaw + (R.rack.yawDeg * Math.PI) / 180, c = Math.cos(yaw), s = Math.sin(yaw);
      out.push({ key: 'drying-rack', x: rk.x, y: rk.y, z: rk.z, yaw, shade: M['drying-rack']?.shade });
      (rr.bunches ?? []).forEach(([, , at], i) => {
        const h = R.rack.hangs[i];
        if (!h) return;
        const seed = hash32(rr.seed, i + 1) >>> 0, variant = 1 + (seed % R.rack.variants);
        out.push({ key: `rack-bunch-${variant}`, x: rk.x + c * h[0] + s * h[2], y: rk.y + h[1], z: rk.z - s * h[0] + c * h[2],
          yaw: yaw + (((seed >>> 8) % 1000) / 1000 - 0.5) * 2 * ((R.rack.bunchYawDeg * Math.PI) / 180), dry: dryShare(at, k.hourNow(), R.rack.dryDays) });
      });
    }
    // The mortar and pestle on the apothecary bench's worktop, in the bench's own frame.
    const b = k.benchAt('apothecary');
    if (b && rec('apothecary') && rec('mortar')) {
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), A = R.apothecary;
      for (const [key, at] of [['mortar', A.mortarAt], ['pestle', A.pestleAt]]) {
        out.push({ key, x: b.x + c * at[0] + s * at[2], y: b.y + at[1], z: b.z - s * at[0] + c * at[2], yaw: b.yaw + ((at[3] ?? 0) * Math.PI) / 180 });
      }
    }
    // The hamper, painted in vertex colours, is drawn with the stores (src/world/pack/draw.js).
    return out;
  }

  return { hamper, rack, retireHeaps, props };
}

/** @typedef {ReturnType<typeof createKeeps>} Keeps */
