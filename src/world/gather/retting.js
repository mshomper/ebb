// @ts-check
// Retting flax (F1, Matt, October 30, 2026): Steep here on the flax pouch's card lays the whole
// pouch in a pond's shallows as one bundle, weighed down with a stone. After about three game days
// in the water the stems have softened and the fibre comes free: Lift out on the bundle's card takes
// it back a handful at a time as flax fibre, for cloth at the workbench. A minnow school keeps clear
// of a bundle while it lies there (school.js avoid): retting water loses its oxygen, and old laws
// kept flax out of fish rivers.
//
// Whether a bundle is ready is worked out from the hour it was laid alone, so a reload and a long
// away agree and nothing needs to tick. The save's gather section keeps them as `retting`,
// [x, z, hour, handfuls] each, oldest first. Pure.

/**
 * @typedef {[number, number, number, number]} Bundle  x, z (m, to the cm), the game hour it was laid, handfuls left
 * @typedef {{ hours: number, max: number, minDepthM: number, maxDepthM: number, avoidM: number, tapM: number }} RettingRecipe recipes/world/gather.json retting
 */

/** The bundles of a saved gather section, made safe. @param {any} v @returns {Bundle[]} */
export function cleanRetting(v) {
  return (Array.isArray(v) ? v : []).filter((b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n)) && b[3] >= 1)
    .map((b) => /** @type {Bundle} */ ([b[0], b[1], b[2], Math.round(b[3])]));
}

/** Is there room for another bundle? @param {Bundle[]} list @param {RettingRecipe} S */
export const roomToSteep = (list, S) => list.length < S.max;

/**
 * A pouch of `handfuls` laid at (x, z) at `hour`: the list with it at the end, or the same list when
 * there is no room. @param {Bundle[]} list @param {number} x @param {number} z @param {number} hour
 * @param {number} handfuls @param {RettingRecipe} S @returns {Bundle[]}
 */
export function laySteep(list, x, z, hour, handfuls, S) {
  if (!roomToSteep(list, S) || handfuls < 1) return list;
  return [...list, /** @type {Bundle} */ ([Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(hour * 100) / 100, Math.round(handfuls)])];
}

/** Game hours still to steep (0 once ready). @param {Bundle} b @param {number} hour @param {RettingRecipe} S */
export const hoursLeft = (b, hour, S) => Math.max(0, b[2] + S.hours - hour);

/** Is the fibre ready to lift? @param {Bundle} b @param {number} hour @param {RettingRecipe} S */
export const isRetted = (b, hour, S) => hoursLeft(b, hour, S) <= 0;

/**
 * One handful lifted from bundle i: the list with it one handful lighter, gone when empty. A bundle
 * not ready yet is left as it is. @param {Bundle[]} list @param {number} i @param {number} hour
 * @param {RettingRecipe} S @returns {Bundle[]}
 */
export function liftOne(list, i, hour, S) {
  const b = list[i];
  if (!b || !isRetted(b, hour, S)) return list;
  return b[3] > 1 ? list.map((c, k) => (k === i ? /** @type {Bundle} */ ([c[0], c[1], c[2], c[3] - 1]) : c)) : list.filter((_, k) => k !== i);
}

/** The bundle nearest (x, z) within tapM, or -1. @param {Bundle[]} list @param {number} x @param {number} z @param {RettingRecipe} S */
export function bundleAt(list, x, z, S) {
  let best = -1, bd = S.tapM;
  list.forEach((b, i) => { const d = Math.hypot(b[0] - x, b[1] - z); if (d <= bd) { bd = d; best = i; } });
  return best;
}

/**
 * Can a bundle lie here? Water of a steeping class (a pond, not the sea or a running stream), between
 * minDepthM and maxDepthM deep. @param {number} depth the water's depth there (m) @param {boolean} still
 * whether the water is of a steeping class @param {RettingRecipe} S
 */
export const steepable = (depth, still, S) => still && depth >= S.minDepthM && depth <= S.maxDepthM;

/**
 * The card's line for a bundle: how long it still wants, said in days or hours, or ready.
 * @param {Bundle} b @param {number} hour @param {RettingRecipe} S
 * @param {{ ready: string, steeping: string, days: string, aDay: string, hours: string }} W words.retting
 */
export function steepLine(b, hour, S, W) {
  const h = hoursLeft(b, hour, S);
  if (h <= 0) return W.ready;
  const left = h > 30 ? W.days.replace('{n}', String(Math.round(h / 24))) : h > 12 ? W.aDay : W.hours;
  return W.steeping.replace('{left}', left);
}

/** Where the minnows keep away from: every bundle lying, with its radius. @param {Bundle[]} list @param {RettingRecipe} S */
export const avoidOf = (list, S) => list.map((b) => ({ x: b[0], z: b[1], r: S.avoidM }));
