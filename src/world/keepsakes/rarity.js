// @ts-check
// Keepsake rarity (docs/future/12): picked before the object, from conditions, never from effort.
// A tier can come only when the tide reaches its gate (springMin, -1 neap to 1 top spring), and the
// season leans the weights (winter's spring tides stand in for storm tides until F08). Pure.

/** @typedef {'common'|'uncommon'|'rare'|'veryRare'} Rarity */
/** @typedef {{ spring: number, season?: string }} Conditions */

/**
 * The weight of each tier under these conditions, in R.order; a gated tier weighs 0.
 * @param {any} R keepsakes.json rarity @param {Conditions} cond @returns {number[]}
 */
export function rarityWeights(R, cond) {
  const lean = (cond.season && R.seasonLean?.[cond.season]) || {};
  return R.order.map((/** @type {string} */ id, /** @type {number} */ i) => {
    const gate = R.gates?.[id];
    if (gate && cond.spring < (gate.springMin ?? -Infinity)) return 0;
    return R.weights[i] * (lean[id] ?? 1);
  });
}

/**
 * Pick a tier by u in [0, 1). @param {number} u @param {any} R keepsakes.json rarity
 * @param {Conditions} cond @returns {Rarity}
 */
export function pickRarity(u, R, cond) {
  return R.order[pickIndex(u, rarityWeights(R, cond))];
}

/**
 * The index a weighted pick lands on, by u in [0, 1). @param {number} u @param {number[]} w
 * @returns {number}
 */
export function pickIndex(u, w) {
  let total = 0;
  for (const x of w) total += x;
  let t = u * total;
  for (let i = 0; i < w.length; i++) {
    if (t < w[i]) return i;
    t -= w[i];
  }
  // Rounding at the very top lands on the last tier with any weight.
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
  return 0;
}
