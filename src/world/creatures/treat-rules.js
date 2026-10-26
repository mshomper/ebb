// @ts-check
// Treat rules (P2h, docs/future/13 section 8): the saved list of treats lying on the ground, when
// each fades, and which species likes a pouch kind. Pure and worker-safe; the live side is treats.js.

/**
 * A treat on the ground: [kind, x, z, hour set (game hours, two places), id].
 * @typedef {[string, number, number, number, number]} LyingTreat
 */

/** The most treats lying at once; the oldest goes first. */
export const TREATS_MAX = 24;

/** @param {number} v @param {number} p */
const round = (v, p) => Math.round(v * p) / p;

/**
 * A saved list made safe: well-formed entries only, at most TREATS_MAX, newest kept. Pure.
 * @param {any} v @returns {LyingTreat[]}
 */
export function cleanTreats(v) {
  if (!Array.isArray(v)) return [];
  /** @type {LyingTreat[]} */ const out = [];
  for (const t of v) {
    if (!Array.isArray(t) || t.length !== 5 || typeof t[0] !== 'string' || !t[0]) continue;
    if (![t[1], t[2], t[3], t[4]].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    out.push([t[0], round(t[1], 100), round(t[2], 100), round(t[3], 100), Math.floor(t[4])]);
  }
  return out.slice(-TREATS_MAX);
}

/**
 * The treats still lying at a game hour (set within fadeH hours). Pure.
 * @param {LyingTreat[]} list @param {number} hour @param {{ fadeH: number }} R recipes/world/treats.json
 */
export const lyingAt = (list, hour, R) => list.filter((t) => hour >= t[3] && hour - t[3] < R.fadeH);

/**
 * How pale a lying treat is, 0 fresh to 1 all but gone, over its last paleH hours. Pure.
 * @param {LyingTreat} t @param {number} hour @param {{ fadeH: number, paleH: number }} R
 */
export function paleOf(t, hour, R) {
  const left = R.fadeH - (hour - t[3]);
  return left >= R.paleH ? 0 : Math.max(0, Math.min(1, 1 - left / Math.max(1e-6, R.paleH)));
}

/**
 * Who likes a pouch kind: each species whose recipe's treat block lists it, in the species order.
 * Pure. @param {string} kind @param {{ key: string, rec: any }[]} species
 * @returns {{ key: string, T: { id: string, kinds: string[], reachM: number } }[]}
 */
export function likersOf(kind, species) {
  return species.filter((s) => s.rec?.treat?.kinds?.includes(kind)).map((s) => ({ key: s.key, T: s.rec.treat }));
}

/** Is a pouch kind a treat some species likes? Pure. @param {string} kind @param {{ key: string, rec: any }[]} species */
export const isTreatKind = (kind, species) => likersOf(kind, species).length > 0;
