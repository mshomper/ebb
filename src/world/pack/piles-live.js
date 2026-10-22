// @ts-check
// Piles at camp, live (docs/future/13 sections 4.1 and 4.5). Set down at camp hands a pouch here:
// it goes onto its kind's pile, one pile per kind in a fixed slot at the pad's edge (camp.js
// pileSlots, piles.js slotFor), up to twelve handfuls; what does not fit stays in the pouch. A pile
// is a piece record of kind 'pile' in the store slice `pieces` (src/world/pieces/model.js), so it is
// saved with the other pieces and a tap finds it (pieces.pieceAt); it is drawn by draw.js. Herbs,
// food, seeds and clumps are refused with the reason; worms dig themselves in. Take up fills one
// pouch from a pile and lowers it; an empty pile is gone. Emits pile:changed { id } after every
// change (the pack itself emits pack:set-down).

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { hourIndex } from '../../core/clock.js';
import { addPiece, removePiece, patchPiece } from '../pieces/model.js';
import { slotFor, setDown as setDownOnto, takeUp as takeUpFrom, pileShape, pileWord } from './piles.js';
import { pileSlots } from './camp.js';

/**
 * @param {{ recipe: any, kinds: import('./kinds.js').Kinds, seed: number }} o
 *   recipe: recipes/world/pack.json; kinds: the pack's kinds registry (pack.kinds); seed: the world seed
 */
export function createPiles(o) {
  const R = o.recipe, kinds = o.kinds;
  const cap = R.piles?.handfuls ?? 12;
  const perPouch = R.handfulsPerPouch ?? 3;
  const pileSeed = subSeed(o.seed, 'piles');
  const yawJitter = ((R.piles?.look?.yawJitterDeg ?? 0) * Math.PI) / 180;

  /** @returns {import('../pieces/model.js').PiecesState} */
  const state = () => get('pieces');
  /** The camp's piles. @returns {import('./piles.js').Pile[]} */
  const piles = () => /** @type {any[]} */ ((state()?.list ?? []).filter((p) => p.kind === 'pile'));
  /** A kind's name for its pile's card. @param {string} k */
  const nameOf = (k) => (Array.isArray(R.kinds) ? R.kinds.find((/** @type {any} */ q) => q.id === k)?.name : null)
    ?? k.split('.').pop()?.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) ?? k;

  return {
    /**
     * Set handfuls of a kind down at camp onto its pile (Set down on a pouch card at camp). What
     * fits moves; refuse says why nothing can (worms: all of them dig in, and there is no pile).
     * @param {string} kind @param {number} handfuls
     * @returns {{ moved: number, refuse?: 'noSlot' | 'noRack' | 'noBowl' | 'worms' | 'pouch', pile: string | null }}
     */
    setDown(kind, handfuls) {
      const n = Math.max(0, Math.floor(handfuls));
      const pick = slotFor(kind, piles(), pileSlots(), kinds);
      if ('refuse' in pick) return pick.refuse === 'worms' ? { moved: n, refuse: 'worms', pile: null } : { moved: 0, refuse: pick.refuse, pile: null };
      const own = piles().find((p) => p.holds === kind && p.slot === pick.slot && p.handfuls > 0);
      if (own) {
        const r = setDownOnto(own, n, cap);
        if (r.moved > 0) {
          update('pieces', () => patchPiece(state(), own.id, { handfuls: r.handfuls, size: pileShape(kind, r.handfuls, R).size }));
          emitDeferred('pile:changed', { id: own.id });
        }
        return { moved: r.moved, pile: own.id };
      }
      const slot = pileSlots().find((s) => s.id === pick.slot);
      if (!slot || n <= 0) return { moved: 0, refuse: 'noSlot', pile: null };
      const s = state();
      const moved = Math.min(n, cap);
      const seed = hash32(pileSeed, s.nextId) >>> 0;
      const yaw = slot.yaw + ((seed >>> 8) / 16777216 - 0.5) * 2 * yawJitter;
      // In the order cleanPieces writes a pile back, so a record comes back exactly.
      const pile = { id: `p${s.nextId}`, kind: /** @type {'pile'} */ ('pile'), x: slot.x, z: slot.z, yaw, seed, size: pileShape(kind, moved, R).size,
        placedHour: hourIndex(), holds: kind, handfuls: moved, slot: slot.id };
      const next = addPiece(s, pile, Infinity);
      if (!next) return { moved: 0, refuse: 'noSlot', pile: null };
      update('pieces', () => next);
      emitDeferred('pile:changed', { id: pile.id });
      return { moved, pile: pile.id };
    },

    /**
     * Take up (the pile card's action `{ type: 'pile.takeUp', id }`): one pouch's worth (to full, or
     * what is left) goes into the pack through add; the pile lowers, and goes at none.
     * @param {string} pileId @param {((kind: string, n: number) => { added: number }) | { add: (kind: string, n: number) => { added: number } }} pack
     * @returns {{ taken: number, kind: string | null, full: boolean }} full: the pack had no room
     */
    takeUp(pileId, pack) {
      const pile = piles().find((p) => p.id === pileId);
      if (!pile) return { taken: 0, kind: null, full: false };
      const want = takeUpFrom(pile, perPouch).taken;
      const add = typeof pack === 'function' ? pack : (/** @type {string} */ k, /** @type {number} */ n) => pack.add(k, n);
      const added = want > 0 ? Math.max(0, Math.min(want, add(pile.holds, want).added)) : 0;
      if (!added) return { taken: 0, kind: pile.holds, full: want > 0 };
      const left = pile.handfuls - added;
      update('pieces', () => (left > 0 ? patchPiece(state(), pile.id, { handfuls: left, size: pileShape(pile.holds, left, R).size }) : removePiece(state(), pile.id).state));
      emitDeferred('pile:changed', { id: pile.id });
      return { taken: added, kind: pile.holds, full: false };
    },

    /** The pile card's name and line (the journal's cardAt): its kind's name and how big it is. @param {{ holds?: string, handfuls?: number }} pc */
    describe: (pc) => ({ name: nameOf(pc.holds ?? ''), text: pileWord(pc.handfuls ?? 0, R) }),

    /** The camp's piles now (draw.js, tools and tests). */
    piles,
  };
}

/** @typedef {ReturnType<typeof createPiles>} Piles */
