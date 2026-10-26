// @ts-check
// Ash patches (docs/future/13 G-42; P2i I3): Spread here on the ash pouch's card tips a handful where
// you stand, and a pale patch lies there for a while. Nettles already on the island may spread onto
// it (src/world/growth/volunteers.js ashSpreadAt): it guides a plant that came by itself and never
// brings a new one. Real basis: ash leaves ground rich in phosphate, and nettle beds mark old hearths.
// The save's gather section keeps them as `ashes`, [x, z, hour] each, oldest first. Pure.

/**
 * @typedef {[number, number, number]} AshPatch  x, z (m, to the cm) and the game hour it was spread
 * @typedef {{ patchM: number, days: number, max: number }} AshRecipe recipes/world/gather.json kinds.ash.spread
 */

/** The ash patches of a saved gather section, made safe. @param {any} v @returns {AshPatch[]} */
export function cleanAshes(v) {
  return (Array.isArray(v) ? v : []).filter((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map((p) => /** @type {AshPatch} */ ([p[0], p[1], p[2]]));
}

/**
 * A handful spread at (x, z) at `hour`: the patches with it at the end, those gone by then dropped
 * and at most max kept (the oldest go first). @param {AshPatch[]} ashes @param {number} x @param {number} z
 * @param {number} hour @param {AshRecipe} S @returns {AshPatch[]}
 */
export function spreadAsh(ashes, x, z, hour, S) {
  const next = [...liveAshes(ashes, hour, S), /** @type {AshPatch} */ ([Math.round(x * 100) / 100, Math.round(z * 100) / 100, hour])];
  return next.slice(Math.max(0, next.length - S.max));
}

/** The patches still lying at `hour`. @param {AshPatch[]} ashes @param {number} hour @param {AshRecipe} S */
export const liveAshes = (ashes, hour, S) => ashes.filter((p) => hour >= p[2] && hour < p[2] + S.days * 24);

/**
 * The patches' marks for the terrain shader (lib-holes.wgsl), written into the holes' list after its
 * last hole: [x, z, radius, -strength] and [ash r, g, b, 0], nearest the view first, as many as
 * there are free slots. The holes' own entries are left as they are. Drawing only.
 * @param {Float32Array} marks the holes' marks (8 floats a slot, a radius of 0 ends the list)
 * @param {{ x: number, z: number, r: number, fresh: number }[]} patches liveAshes, with radius and freshness
 * @param {number[]} focus [x, z] @param {{ rgb: number[], strength: number, nearM: number }} L kinds.ash.spread.look
 * @returns {Float32Array}
 */
export function ashMarks(marks, patches, focus, L) {
  const slots = Math.floor(marks.length / 8);
  let at = 0;
  while (at < slots && marks[at * 8 + 2] > 0) at++;
  const near = patches.map((p) => ({ ...p, d: (p.x - focus[0]) ** 2 + (p.z - focus[1]) ** 2 })).filter((p) => p.d < L.nearM * L.nearM).sort((a, b) => a.d - b.d);
  const out = marks.slice();
  for (const p of near) {
    if (at >= slots) break;
    // Fresh ash stands out; it settles into the ground over its days.
    out.set([p.x, p.z, p.r, -L.strength * (0.35 + 0.65 * p.fresh), L.rgb[0], L.rgb[1], L.rgb[2], 0], at * 8);
    at++;
  }
  if (at < slots) out[at * 8 + 2] = 0;
  return out;
}

/**
 * How fresh a patch is at `hour`: 1 just spread, fading to 0 as its days run out (the drawn mark).
 * @param {AshPatch} p @param {number} hour @param {AshRecipe} S
 */
export const ashFresh = (p, hour, S) => Math.max(0, Math.min(1, 1 - (hour - p[2]) / (S.days * 24)));
