// @ts-check
// The walker's pack, live (docs/future/13 section 4.1): keeps the store slice `pack` (the save's
// `pack` section) in normal form, and `packView` for the pouch row (src/ui/pack.js). Answers the
// pouch actions: pack.open (the pouch's card), pack.setDown (at camp, onto its pile), pack.empty
// (tipped out where you stand) and heap.take. Emits pack:changed { pouches, size } after every
// change, pack:full { kind }, pack:set-down { kind, handfuls, pile }, pack:emptied { kind, x, z } and
// pack:worn { id, size, was } (another carrier put on, P2f).
// Other modules use add, take, has and holds (the evening's beat 5 asks holds({ fuel: 1, stones: 2 })).
// Nothing in the pack spoils, and nothing is ever shown as a number.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { makeKinds } from './kinds.js';
import { add as addTo, take as takeFrom, has as hasIn, packHolds, normalize, sizeOf, removePouch, addHeap, takeFromHeap, expireHeaps, cleanPack, addCarrier, wear } from './model.js';
import { atCamp } from './camp.js';

/**
 * @param {{ recipe: any, you: () => number[] | null, day: () => number,
 *   setDown?: (kind: string, handfuls: number) => { moved: number, refuse?: string, pile?: string | null, at?: { x: number, z: number } | null, full?: string } }} o
 *   you: where you stand below ([x, y, z]) or null above; day: the game day index; setDown: the
 *   camp's places (route.js: the rack, the piles, the hamper), which take what fits and say why not
 *   otherwise (full: the words key for the place that filled)
 */
export function createPack(o) {
  const R = o.recipe;
  const kinds = makeKinds(R);
  const W = R.words;

  /** @returns {import('./model.js').Pack} */
  const pack = () => get('pack');
  /** Keep a new pack, publish the row, and say so. @param {import('./model.js').Pack} next */
  function keep(next) {
    update('pack', () => next);
    publish();
    emitDeferred('pack:changed', { pouches: next.pouches.map((p) => [p[0], p[1]]), size: sizeOf(next, R) });
  }
  /** The pouch row as drawn: size pouches, filled ones first in order, the rest flat. */
  function publish() {
    const p = pack();
    const size = sizeOf(p, R);
    const pouches = p.pouches.map(([k, h]) => ({ kind: k, handfuls: h, sketch: kinds.sketchOf(k), name: nameOf(k) }));
    update('packView', () => ({ size, pouches, holding: p.holding, words: W.stage }));
  }
  /** A kind's name for its card and aria-label. @param {string} k */
  const nameOf = (k) => kinds.byId.get(k)?.name ?? k.split('.').pop()?.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) ?? k;

  // A save from before format 9, or from a newer build, comes back in normal form.
  update('pack', (p) => normalize(cleanPack(p, kinds, R), kinds, R));
  publish();

  return {
    kinds,
    recipe: R,
    nameOf,

    /** Add handfuls of a kind (a Gather). @param {string} kind @param {number} [n] */
    add(kind, n = 1) {
      const r = addTo(pack(), kind, n, kinds, R);
      if (r.added) keep(r.pack);
      if (r.left) emitDeferred('pack:full', { kind });
      return { added: r.added, left: r.left };
    },
    /** Take handfuls of a kind out (laying the fire ring, a make). @param {string} kind @param {number} [n] */
    take(kind, n = 1) {
      const r = takeFrom(pack(), kind, n, kinds, R);
      if (r.taken) keep(r.pack);
      return r.taken;
    },
    /** @param {string} kind @param {number} [n] */
    has: (kind, n = 1) => hasIn(pack(), kind, n),
    /** Holds every handful asked for, by kind or group: holds({ fuel: 1, stones: 2 }). @param {Record<string, number>} need */
    holds: (need) => packHolds(pack(), need, kinds),
    /** Room for one more handful of this kind. @param {string} kind */
    room: (kind) => addTo(pack(), kind, 1, kinds, R).added > 0,

    /**
     * The pouch's card (K-05): its sketch, its line and the word for how full, with Set down at
     * camp and Empty. Shown in the island card (src/ui/island-notes.js) beside the pouch.
     * @param {number} i @param {number} x @param {number} y screen point
     */
    open(i, x, y) {
      const pc = pack().pouches[i];
      if (!pc) return;
      const [k, h] = pc;
      const you = o.you();
      const line = kinds.lineOf(k);
      update('identify', () => ({ sp: 'pouch', pouch: i, kindId: k, name: nameOf(k), icon: 'gather', pouchSketch: kinds.sketchOf(k), pouchStage: h,
        text: `${line ? `${line} ` : ''}${W.stage[h] ?? ''}`.trim(), noPage: true, stage: -1, r: 0,
        atCamp: !!you && atCamp(you[0], you[2]), x, y, at: performance.now() }));
    },

    /** Tip a pouch out where you stand; the island takes it back. @param {number} i */
    empty(i) {
      const you = o.you();
      const r = removePouch(pack(), i);
      if (!r.kind) return;
      keep(normalize(r.pack, kinds, R));
      update('identify', () => null);
      emitDeferred('pack:emptied', { kind: r.kind, x: you?.[0] ?? 0, z: you?.[2] ?? 0 });
      emitDeferred('island:notice', { text: r.kind === 'worms' ? W.worms : W.emptied, showS: 4 });
    },

    /**
     * Set one pouch of a kind down onto its pile (a pile card's Set down, F8): the fullest first.
     * The pile's card stays open, so another press sets down the next. @param {string} kind
     */
    setDownKind(kind) {
      const ps = pack().pouches;
      let i = -1;
      ps.forEach((p, k) => { if (p[0] === kind && (i < 0 || p[1] > ps[i][1])) i = k; });
      if (i >= 0) this.setDown(i, true);
    },

    /**
     * Set a pouch down at camp onto its kind's pile (what fits; the rest stays).
     * @param {number} i @param {boolean} [keepCard] leave the open card (a pile's) as it is
     */
    setDown(i, keepCard = false) {
      const you = o.you();
      const pc = pack().pouches[i];
      if (!pc || !you || !atCamp(you[0], you[2]) || !o.setDown) return;
      const [k, h] = pc;
      const r = o.setDown(k, h);
      // Worms dig themselves in (the take goes through); any other refusal keeps the pouch.
      if (r.refuse) emitDeferred('island:notice', { text: W[r.refuse] ?? W.noSlot, showS: 5 });
      if (r.refuse && r.refuse !== 'worms') return;
      if (r.moved > 0) {
        const t = takeFrom(pack(), k, r.moved, kinds, R);
        keep(t.pack);
        emitDeferred('pack:set-down', { kind: k, handfuls: r.moved, pile: r.pile ?? null, at: r.at ?? null });
      }
      // What did not fit: the line for the place that filled (a pile, the rack, the hamper).
      if (!r.refuse && r.moved < h) emitDeferred('island:notice', { text: W[r.full ?? 'pileFull'] ?? W.pileFull, showS: 4 });
      if (!keepCard) update('identify', () => null);
    },

    /** The carriers made, and the one worn (null: the starting pack; P2f). */
    carriers: () => ({ made: pack().carriers, worn: pack().worn ?? null }),
    /**
     * A carrier made at the workbench (P2f): put on at once, the old one off to hang at camp. Its new
     * pouches unfold on the bar. @param {string} id
     */
    addCarrier(id) {
      const was = sizeOf(pack(), R);
      keep(addCarrier(pack(), id));
      emitDeferred('pack:worn', { id, size: sizeOf(pack(), R), was });
    },
    /**
     * Put on another made carrier (null: the starting pack), from its card at camp. Refused with a
     * line when the pack holds more than it has pouches. @param {string | null} id @returns {boolean}
     */
    wear(id) {
      const was = sizeOf(pack(), R), r = wear(pack(), id, R);
      if (!r.ok) { emitDeferred('island:notice', { text: W.wearFull, showS: 5 }); return false; }
      keep(r.pack);
      emitDeferred('pack:worn', { id, size: sizeOf(r.pack, R), was });
      return true;
    },

    /** What is held in both arms: the hearth's pot, or nothing (K-26). */
    holding: () => pack().holding,
    /** Take the hearth's pot in both arms, or set it back (K-26): the pouch row dims while held. @param {null | 'pot'} what */
    hold(what) {
      if (pack().holding === what) return;
      keep({ ...pack(), holding: what });
    },

    /** The heaps left when the pack was full (K-21), for drawing and tapping. */
    heaps: () => pack().heaps,
    /**
     * Lay a handful as a small heap at your feet (Set down here on the full card).
     * @param {string} kind @param {number} handfuls
     */
    heapHere(kind, handfuls) {
      const you = o.you();
      if (!you) return;
      keep(addHeap(pack(), kind, you[0], you[2], o.day(), handfuls, R.heaps?.cap ?? 6));
    },
    /** Gather from a heap back into the pack: what there is room for. @param {number} i */
    takeHeap(i) {
      const hp = pack().heaps[i];
      if (!hp) return 0;
      const r = addTo(pack(), hp[0], 1, kinds, R);
      if (!r.added) { emitDeferred('pack:full', { kind: hp[0] }); return 0; }
      keep(takeFromHeap(r.pack, i, 1).pack);
      return 1;
    },
    /** Each new game day: heaps from an earlier day go back to the island. */
    dawn() {
      const p = pack();
      const next = expireHeaps(p, o.day());
      if (next.heaps.length !== p.heaps.length) keep(next);
    },
    publish,
  };
}
