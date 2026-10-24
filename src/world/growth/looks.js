// @ts-check
// How a plant looks from what its record already holds (docs/future/13 5.6): picked, thin and
// drowned, each 0..1, packed into the last vec4 of its draw instance (index.js) and read by every
// flora shader through lib-flora.wgsl. Derived each upload, never saved. Pure.

/**
 * The share a pick takes from each species that gives a gather part (gather.json plants.parts,
 * keyed '<species>.<part>'; the largest of its parts), or an empty map with no gather recipe.
 * @param {any} gather gather.json, or undefined @returns {Map<string, number>}
 */
export function pickShares(gather) {
  /** @type {Map<string, number>} */ const m = new Map();
  const P = gather?.plants;
  if (!P?.parts) return m;
  for (const [key, part] of Object.entries(P.parts)) {
    const sp = key.slice(0, key.indexOf('.'));
    const share = /** @type {any} */ (part).share ?? P.defaults?.[/** @type {any} */ (part).type]?.share ?? 0;
    if (share > 0) m.set(sp, Math.max(m.get(sp) ?? 0, share));
  }
  return m;
}

/**
 * A plant's looks. picked: how far below its best a pick left it, one full pick being 1 (only for
 * species that give a gather part, and not while it is thin); thin: hours past the poor-ground wait,
 * over looks.thinRampH; drowned: its drown counter over its drown hours.
 * @param {{ size: number, best: number, low: number, drown: number }} p the plant record
 * @param {any} rec its flora recipe @param {any} L growth.json `looks`
 * @param {number | undefined} take the share a pick takes (pickShares), undefined if none
 * @returns {[number, number, number]} picked, thin, drowned
 */
export function plantLooks(p, rec, L, take) {
  const G = rec?.growth;
  const clamp = (/** @type {number} */ v) => (v > 0 ? (v < 1 ? v : 1) : 0);
  const thin = G ? clamp((p.low - G.lowHours) / (L?.thinRampH ?? 24)) : 0;
  const picked = take && p.best > 0 && thin === 0 ? clamp((p.best - p.size) / (take * p.best)) : 0;
  const drowned = G?.drownHours > 0 ? clamp(p.drown / G.drownHours) : 0;
  return [picked, thin, drowned];
}
