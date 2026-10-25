// @ts-check
// The camp store (docs/future/13 P2j): a lidded rush hamper among the stores, facing the fire. Pure.
// It has 6 slots, 12 once a second hamper stacks on the first; each slot holds one kind, up to 12
// handfuls (a pile's worth). A kind fills its own slots first, then takes an empty one. Its card shows
// the slots as drawn icons with the pile words, never a number; Take up on a slot fills one pouch.
// The record rides in the camp section's slot list (src/world/camp/model.js):
// { slot: 'store', kind: 'hamper', seed, placedHour, stack: 1 | 2, holds: [[kind, handfuls], ...] }.
// Numbers: recipes/world/pack.json `store`.

/** @typedef {[string, number][]} Holds one [kind, handfuls] per slot in use, in the order they filled */

/** How many slots a hamper of this stack has (pack.json store.slots). @param {number} stack @param {any} R pack.json */
export const slotsOf = (stack, R) => (R?.store?.slots ?? [6, 12])[Math.max(1, Math.min(2, Math.floor(stack) || 1)) - 1];

/** Handfuls a slot holds. @param {any} R pack.json */
export const capOf = (R) => R?.store?.handfuls ?? 12;

/** Saved holds made safe: whole handfuls above none, string kinds. @param {any} v @returns {Holds} */
export function cleanHolds(v) {
  /** @type {Holds} */ const out = [];
  for (const h of Array.isArray(v) ? v : []) {
    if (Array.isArray(h) && typeof h[0] === 'string' && Number.isInteger(h[1]) && h[1] > 0) out.push([h[0], h[1]]);
  }
  return out;
}

/**
 * Put handfuls of a kind in: into its own slots with room first, then empty slots. What does not fit
 * stays out. @param {Holds} holds @param {string} kind @param {number} n @param {number} cap @param {number} slots
 * @returns {{ holds: Holds, moved: number }}
 */
export function put(holds, kind, n, cap, slots) {
  /** @type {Holds} */ const out = holds.map(([k, h]) => [k, h]);
  let left = Math.max(0, Math.floor(n));
  for (const s of out) if (left > 0 && s[0] === kind && s[1] < cap) { const m = Math.min(left, cap - s[1]); s[1] += m; left -= m; }
  while (left > 0 && out.length < slots) { const m = Math.min(left, cap); out.push([kind, m]); left -= m; }
  return { holds: out, moved: Math.max(0, Math.floor(n)) - left };
}

/** Room for one more handful of this kind? @param {Holds} holds @param {string} kind @param {number} cap @param {number} slots */
export const room = (holds, kind, cap, slots) => holds.length < slots || holds.some(([k, h]) => k === kind && h < cap);

/**
 * Take handfuls of a kind out (a make drawing from the store): from its last slot back. An emptied
 * slot is gone. @param {Holds} holds @param {string} kind @param {number} n @returns {{ holds: Holds, taken: number }}
 */
export function take(holds, kind, n) {
  /** @type {Holds} */ const out = holds.map(([k, h]) => [k, h]);
  let want = Math.max(0, Math.floor(n));
  for (let i = out.length - 1; i >= 0 && want > 0; i--) {
    if (out[i][0] !== kind) continue;
    const m = Math.min(want, out[i][1]);
    out[i][1] -= m; want -= m;
  }
  return { holds: out.filter(([, h]) => h > 0), taken: Math.max(0, Math.floor(n)) - want };
}

/**
 * Take up from one slot: up to max handfuls (one pouch). @param {Holds} holds @param {number} i @param {number} max
 * @returns {{ holds: Holds, kind: string | null, taken: number }}
 */
export function takeSlot(holds, i, max) {
  const s = holds[i];
  if (!s) return { holds, kind: null, taken: 0 };
  const taken = Math.max(0, Math.min(s[1], max));
  const out = holds.map(([k, h], j) => /** @type {[string, number]} */ ([k, j === i ? h - taken : h])).filter(([, h]) => h > 0);
  return { holds: out, kind: s[0], taken };
}

/** How many handfuls of each kind it holds. @param {Holds} holds @returns {Record<string, number>} */
export function holdsOf(holds) {
  /** @type {Record<string, number>} */ const n = {};
  for (const [k, h] of holds) n[k] = (n[k] ?? 0) + h;
  return n;
}
