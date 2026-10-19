// @ts-check
// Animals coming back in the reveal on return (S7c): one small timing helper every live animal
// system shares (frogs, midges now; minnows, dragonflies later). While the plants grow in, the
// animals are hidden; then all of them come back within one shared window however many there are,
// each a moment apart (in an order set by its id's hash), and only the few the reveal picks make
// their effect (a frog's plop, later a dragonfly's wingbeat or a minnow's ripple). How a species
// comes back is in its recipe's `reveal` block: { return: 'plop'|'ripple'|'thicken'|..., growS }.

import { hash32 } from '../../core/rng.js';

/**
 * @typedef {Object} RevealHooks  what a live animal system offers the reveal (src/ui/reveal.js)
 * @property {string} species
 * @property {string} style            its recipe's reveal.return
 * @property {() => { id: number, x: number, z: number }[]} spots  where each one is now
 * @property {() => void} hide
 * @property {(o: { windowS: number, effects: Set<number> }) => void} back  come back now
 * @property {() => void} end          all present at once (the reveal was ended by input)
 */

/** @param {number} growS how long one animal takes to come in (s) */
export function createReturn(growS) {
  /** @type {'shown' | 'hidden' | 'back'} */ let mode = 'shown';
  let t0 = 0, windowS = 0;
  /** @type {Map<number, number>} */ let delay = new Map();
  /** @type {Set<number>} */ let effects = new Set();
  /** @type {Set<number>} */ const fired = new Set();
  return {
    hide() { mode = 'hidden'; },
    /**
     * Come back from animation time `now`: delays spread over the window by hash order.
     * @param {number} now @param {number[]} ids @param {number} win @param {Set<number>} fx
     */
    back(now, ids, win, fx) {
      const order = ids.slice().sort((a, b) => (hash32(a, 0x7e7) - hash32(b, 0x7e7)) || a - b);
      delay = new Map(order.map((id, i) => [id, order.length > 1 ? (win * i) / (order.length - 1) : 0]));
      mode = 'back'; t0 = now; windowS = win; effects = fx; fired.clear();
    },
    end() { mode = 'shown'; },
    /**
     * How present one animal is now, 0..1 (eased), and whether its effect is due this frame.
     * @param {number} id @param {number} now animation seconds
     */
    at(id, now) {
      if (mode === 'shown') return { k: 1, effect: false };
      if (mode === 'hidden') return { k: 0, effect: false };
      // One that came after the window was set (a new arrival) is simply there.
      const d = delay.get(id);
      if (d === undefined) return { k: 1, effect: false };
      const f = Math.min(1, Math.max(0, (now - t0 - d) / Math.max(1e-3, growS)));
      const due = f > 0 && effects.has(id) && !fired.has(id);
      if (due) fired.add(id);
      if (now - t0 > windowS + growS) mode = 'shown';
      return { k: 1 - (1 - f) * (1 - f), effect: due };
    },
  };
}
