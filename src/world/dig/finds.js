// @ts-check
// What one dig gives (docs/future/13 10.5 to 10.7): worms, clay, a keepsake, a seep, all worked out
// from the dig seed, the 1 m cell, the game day and the layer, with the season and yesterday's
// weather, never stored. Whether a keepsake is offered also reads the patch's thinning and today's
// budget left (rest.js, from the dug events); the outcome is written into the dug event, so a later
// change of conditions never rewrites the past. Worms and clay are never budgeted. Pure.

import { hash32 } from '../../core/rng.js';
import { pickIndex } from '../keepsakes/rarity.js';
import { FAMILIES } from '../keepsakes/families/index.js';
import { belemniteNumbers } from '../keepsakes/families/fossil.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** The keepsakes' five tiers, in order (keepsakes.json rarity.order). */
const TIERS = ['common', 'uncommon', 'rare', 'veryRare', 'lifetime'];

/**
 * One dig's conditions.
 * @typedef {Object} DigAt
 * @property {number} seed      subSeed(worldSeed, 'dig')
 * @property {number} cell      the 1 m habitat cell
 * @property {number} day       game day
 * @property {string} layer     the layer reached: topsoil, subsoil, clay, sand
 * @property {number} depth     1 or 2 (layers dug, this one included)
 * @property {number} season    0 spring .. 3 winter
 * @property {number} moisture  the cell's moisture 0..1 (for the seep)
 * @property {boolean} rainBefore  yesterday's weather was rain
 * @property {boolean} frost    a frost day: winter, and today dawned clear or misty
 * @property {number} thin      the patch's keepsake share now (rest.js thinning)
 * @property {number} budgetLeft today's dug keepsakes still to come (rest.js budgetLeft)
 * @property {boolean} [hearth]     on an old hearth disc (story.js): rarity leans, very rare at depth 2
 * @property {boolean} [nearHearth] within nearHearthM of one: sherds lean into the subsoil
 * @property {boolean} [potFired]   the walker has fired a pot of their own: the ground offers sherds (D-21)
 */

/**
 * The rarity weights for a dig, gated and leaned (dig.json rarity). @param {DigAt} at @param {any} R
 * @returns {number[]}
 */
export function digRarityWeights(at, R) {
  const W = R.rarity.weights[String(Math.min(at.depth, 3))] ?? R.rarity.weights['1'];
  const G = R.rarity.gates, L = R.rarity.lean;
  return TIERS.map((id, i) => {
    let w = W[i] ?? 0;
    const g = G[id];
    if (g && at.depth < g.minDepth && !(g.sandOk && at.layer === 'sand') && !(at.hearth && g.hearthDepth && at.depth >= g.hearthDepth)) w = 0;
    if (at.hearth) w *= L.hearth?.[id] ?? 1;
    if (at.rainBefore) w *= L.rainBefore?.[id] ?? 1;
    if (at.frost) w *= L.frost?.[id] ?? 1;
    return w;
  });
}

/**
 * A dug keepsake's numbers for a family: a stone (its holed mark at holedLean of the shore's), a
 * belemnite, or a drift seed. @param {string} family @param {number} h0 @param {string} rarity
 * @param {any} K keepsakes.json @param {any} R dig.json
 */
export function dugKeepsake(family, h0, rarity, K, R) {
  if (family === 'sherd') return FAMILIES.sherd.numbers(h0, rarity, K);
  if (family === 'belemnite') return belemniteNumbers(h0, /** @type {any} */ (rarity), K);
  if (family === 'stone') {
    const H = K.stones.marks.holed;
    const K2 = { ...K, stones: { ...K.stones, marks: { ...K.stones.marks, holed: { ...H, chance: H.chance * (R.keepsake.holedLean ?? 1) } } } };
    return FAMILIES.stone.numbers(h0, rarity, K2);
  }
  return FAMILIES[family].numbers(h0, rarity, K);
}

/**
 * The family a dig's keepsake comes from: the layer's families (one, or shares), near a hearth its
 * nearHearth shares instead; sherds only once the walker has fired a pot (their shares dropped and
 * the rest kept in proportion). Null when the layer holds none. @param {DigAt} at @param {number} u 0..1 @param {any} R
 */
export function digFamily(at, u, R) {
  const KS = R.keepsake;
  const f = (at.nearHearth && KS.nearHearth?.[at.layer]) || KS.families[at.layer];
  if (!f) return null;
  if (typeof f === 'string') return f === 'sherd' && !at.potFired ? null : f;
  const shares = Object.entries(f).filter(([k]) => k !== 'sherd' || at.potFired);
  const total = shares.reduce((a, [, w]) => a + /** @type {number} */ (w), 0);
  let t = u * total;
  for (const [k, w] of shares) { if (t < /** @type {number} */ (w)) return k; t -= /** @type {number} */ (w); }
  return shares.length ? shares[shares.length - 1][0] : null;
}

/**
 * What one dig gives.
 * @param {DigAt} at @param {any} R recipes/world/dig.json @param {any} K recipes/world/keepsakes.json
 * @returns {{ worm: 'small' | 'big' | null, clay: 'yes' | 'winter' | null, keepsake: any | null, seep: boolean, rolled: boolean }}
 *   rolled: the dig held a keepsake before the budget (kept apart so the lab can show what the budget held back)
 */
export function digFinds(at, R, K) {
  const h = (/** @type {number} */ salt) => u01(hash32(at.seed, at.cell, at.day, at.depth, salt));
  // Worms: the layer's chance this season; summer's few come up after rain.
  let worm = /** @type {'small' | 'big' | null} */ (null);
  const WT = R.worms[at.layer] ?? null;
  if (WT) {
    let p = WT[at.season] ?? 0;
    if (at.season === 1 && at.rainBefore) p = Math.min(1, p * R.worms.summerRainBoost);
    if (h(0x3011) < p) worm = at.layer === 'topsoil' ? 'small' : 'big';
  }
  // Clay: a handful every dig of the clay, but not in winter.
  const clayLayer = (R.clay.layers ?? ['clay']).includes(at.layer);
  const clay = clayLayer ? (R.clay.seasons.includes(at.season) ? 'yes' : 'winter') : null;
  const seep = clayLayer && at.moisture >= R.seep.moistureMin;
  // A keepsake: does this dig hold one at all (the layer's chance, thinned), then its rarity and numbers.
  // One family draw only where there is a choice, so a layer with one family rolls as it always did.
  const fam = (at.nearHearth && R.keepsake.nearHearth?.[at.layer]) || R.keepsake.families[at.layer];
  const family = digFamily(at, typeof fam === 'object' && fam ? h(0xfa31) : 0, R);
  let chance = R.keepsake.chance[at.layer] ?? 0;
  if (at.layer === 'sand' && at.season === 1) chance *= R.keepsake.summerSandLean ?? 1;
  const rolled = !!family && h(0x6b51) < chance * at.thin;
  let keepsake = null;
  if (rolled && at.budgetLeft > 0 && K) {
    const rarity = TIERS[pickIndex(h(0x7a12), digRarityWeights(at, R))];
    keepsake = dugKeepsake(family, hash32(at.seed, at.cell, at.day, at.depth, 0x5e7a), rarity, K, R);
  }
  return { worm, clay, keepsake, seep, rolled };
}
