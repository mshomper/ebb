// @ts-check
// The meadow islet's save section (`islet`, format 9's list, src/save/migrate-format9.js): when the
// Tier 1 milestone was earned, the low water it first shows at, how far its rise has been written
// into the ground, and which starter clumps are planted. A save from before the islet has no section
// and reads as not earned, so an older island loads without it; one that has risen stays risen.
// Pure.

/**
 * @typedef {Object} IsletSave
 * @property {1} version
 * @property {number | null} earnedH  game hour the milestone was earned (null: not yet)
 * @property {number | null} lowH     game hour of the low water it first shows at (null: not earned)
 * @property {number} applied         how far its rise is written into the saved ground, 0..1 (1: risen)
 * @property {string[]} planted       the starter clumps' species planted on it so far
 */

/** @returns {IsletSave} */
export const emptyIslet = () => ({ version: 1, earnedH: null, lowH: null, applied: 0, planted: [] });

/**
 * The section as saved, or empty when missing or unreadable. Only the saved fields are kept (the
 * live slice also carries its layout and phase, rebuilt on every load).
 * @param {any} v @returns {IsletSave}
 */
export function cleanIslet(v) {
  if (!v || typeof v !== 'object' || v.version !== 1) return emptyIslet();
  const num = (/** @type {any} */ n) => (Number.isFinite(n) ? n : null);
  const lowH = num(v.lowH), earnedH = num(v.earnedH);
  return {
    version: 1, earnedH, lowH: earnedH === null ? null : lowH,
    applied: Number.isFinite(v.applied) ? Math.max(0, Math.min(1, v.applied)) : 0,
    planted: Array.isArray(v.planted) ? v.planted.filter((/** @type {any} */ s) => typeof s === 'string') : [],
  };
}
