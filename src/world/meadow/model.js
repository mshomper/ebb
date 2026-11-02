// @ts-check
// What the meadow islet's stories keep (F20), saved inside the islet's own section (`islet.meadow`,
// src/world/islet/model.js): when the old pot was dug up under the midsummer spot, which midsummer
// light the walker has already seen, whether the stone's calendar has been read, and the stooks of
// cut rye standing to dry. A save from before F20 has none and reads as nothing found yet. Pure.

/**
 * @typedef {{ x: number, z: number, yaw: number, cutH: number, straw: number, seed: number, wetH: number }} Stook
 * @typedef {{ version: 1, potH: number | null, lightH: number | null, stooks: Stook[] }} MeadowSave
 *   potH: the game hour the pot was found (null: not yet); lightH: the midsummer noon whose light
 *   was last seen live (its line said once)
 */

/** @returns {MeadowSave} */
export const emptyMeadow = () => ({ version: 1, potH: null, lightH: null, stooks: [] });

/** The section as saved, or empty when missing or unreadable. @param {any} v @returns {MeadowSave} */
export function cleanMeadow(v) {
  if (!v || typeof v !== 'object' || v.version !== 1) return emptyMeadow();
  const num = (/** @type {any} */ n, /** @type {number} */ d) => (Number.isFinite(n) ? n : d);
  const stooks = Array.isArray(v.stooks) ? v.stooks.filter((/** @type {any} */ s) => s && Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.cutH))
    .map((/** @type {any} */ s) => ({ x: s.x, z: s.z, yaw: num(s.yaw, 0), cutH: s.cutH, straw: Math.max(0, Math.floor(num(s.straw, 1))), seed: Math.max(0, Math.floor(num(s.seed, 0))), wetH: Math.max(0, num(s.wetH, 0)) })) : [];
  return { version: 1, potH: Number.isFinite(v.potH) ? v.potH : null, lightH: Number.isFinite(v.lightH) ? v.lightH : null, stooks };
}
