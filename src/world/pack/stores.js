// @ts-check
// The stores (docs/future/13 section 3.12, Matt, October 23, 2026): the wood store, the stone pile
// and the clay slab are places at the camp's sticks, stones and clay slots from the first frame,
// drawn empty and waiting (draw.js), so the player can see where piles go. Each has a card even
// when empty ("Wood store. Empty."), with Set down while the pack holds its kind; with a pile
// there, the card is the pile's too (Take up, Set down; src/ui/pack.js). While the pack holds a
// store's kind and you are near camp, after the fire ring is laid, the store glows softly.
// Reads the pack, the piles and the camp pad; never changes them. Numbers: recipes/world/pack.json
// `stores`.

import { get } from '../../core/store.js';
import { pileSlots, campPadNow } from './camp.js';

/** The slots that are stores, in the order they are drawn. */
export const STORE_IDS = ['sticks', 'stones', 'clay'];

/** The camp's stores now, in world meters: { id, x, z, yaw }. None without a pad. */
export const storeSlots = () => pileSlots().filter((s) => STORE_IDS.includes(s.id));

/**
 * The pack's kinds that are kept in a store (pack.json kinds[].camp). Pure.
 * @param {string} id @param {any} R pack.json @returns {string[]}
 */
export const kindsFor = (id, R) => (R.kinds ?? []).filter((/** @type {any} */ k) => k.camp === id).map((/** @type {any} */ k) => k.id);

/**
 * The first of a store's kinds the pack holds (the fullest pouch's), or null. Pure.
 * @param {string[]} kinds @param {any[][]} pouches the pack's [kind, handfuls] pouches
 */
export function heldKind(kinds, pouches) {
  let best = null, most = 0;
  for (const [k, h] of pouches) if (kinds.includes(k) && h > most) { best = k; most = h; }
  return best;
}

/**
 * @param {{ recipe: any, piles: { piles: () => any[], describe: (p: any) => { name: string, text: string } },
 *   walk: { below: boolean, you: () => number[] | null }, glow: { nearM: number, opacity: number, breathS: number },
 *   ringLaid: () => boolean }} o
 *   recipe: pack.json; piles: piles-live.js; glow: camp.json glow (the slots' own breathing glow)
 */
export function createStores(o) {
  const R = o.recipe, S = R.stores;
  const pouches = () => /** @type {any[][]} */ (get('pack')?.pouches ?? []);

  /** The store under a ground point, or null. @param {number} x @param {number} z */
  function storeAt(x, z) {
    let best = null, bd = Infinity;
    for (const s of storeSlots()) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= (S[s.id]?.r ?? 0.5) && d < bd) { best = s; bd = d; }
    }
    return best;
  }

  return {
    storeAt,

    /**
     * The store's card at a ground point (the journal's cardAt asks this before the pieces): its
     * name, then what it holds and how much, or "Empty."; with a pile there, the pile's card too.
     * camp: 'store' ties it to the keeper's first page. @param {number} x @param {number} z
     */
    cardAt(x, z) {
      const s = storeAt(x, z);
      if (!s) return null;
      const W = S[s.id];
      const pile = o.piles.piles().find((p) => p.slot === s.id && p.handfuls > 0) ?? null;
      const pd = pile ? o.piles.describe(pile) : null;
      return { sp: `store:${s.id}`, store: s.id, storeKinds: kindsFor(s.id, R), camp: 'store', name: W.name, sub: pd?.name ?? null,
        icon: 'setdown', text: pd?.text ?? S.words.empty, wx: s.x, wz: s.z, r: W.r, stage: -1, noPage: true, canCarry: false,
        ...(pile ? { piece: pile.id, kind: 'pile', pile: { holds: pile.holds, handfuls: pile.handfuls } } : {}) };
    },

    /**
     * The stores that glow now, as the terrain marks' filled rings [x, z, radius, opacity]: each
     * whose kind the pack holds, while you are below near camp, once the fire ring is laid.
     * @param {number} now seconds
     */
    rings(now) {
      const pad = campPadNow(), you = o.walk.below ? o.walk.you() : null;
      if (!pad || !you || !o.ringLaid() || Math.hypot(you[0] - pad.x, you[2] - pad.z) > pad.r + o.glow.nearM) return [];
      const k = o.glow.opacity * (0.75 + 0.25 * Math.sin((now * 2 * Math.PI) / o.glow.breathS));
      const held = pouches();
      return storeSlots().filter((s) => heldKind(kindsFor(s.id, R), held)).map((s) => [s.x, s.z, S[s.id].glowM, k]);
    },
  };
}

/** @typedef {ReturnType<typeof createStores>} Stores */
