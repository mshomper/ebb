// @ts-check
// Beach glints (Matt, October 29, 2026: finds are hard to notice among the stones, wrack and driftwood):
// the things worth finding on the shore (keepsakes, bottles most of all, and a few finds) now and then
// catch the light in a brief twinkle, like sun on wet glass or shell. Each one keeps its own slow
// rhythm, seeded by what it is, so they never flash together; each flash tilts a small facet that
// reflects the sun (or the moon) toward you or not, so it is view-dependent light, drawn in linear HDR
// by src/render/passes/glints.js (glint-draw.wgsl mirrors flashAt and facetAt below). The ground
// pickups (pebbles, flat stones, wrack, kelp, twigs, shell handfuls) never glint. Live only, never
// saved; the twinkle runs on real seconds. Pure. Numbers: recipes/world/glints.json.

import { hash32 } from '../core/rng.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ everyS: number[], flashS: number, chance: number, facetDeg: number }} GlintTiming
 *   everyS: the gap between chances to flash (s), each object's own between the two; flashS: one
 *   flash's length (s); chance: the share of chances that flash; facetDeg: how far a flash's facet tilts from up
 * @typedef {{ x: number, y: number, z: number, seed: number, boost: number }} Glint
 *   a point that may glint: where (m), its seed, and its strength (1, more for a bottle)
 */

/** A glint's seed from an object's id (a keepsake's `tide:cell`). @param {string} id */
export function glintSeed(id) {
  let h = hash32(id.length);
  for (let i = 0; i < id.length; i++) h = hash32(h, id.charCodeAt(i));
  return h;
}

/**
 * How bright a glint's flash is at real time t (0 between flashes, up to 1 at a flash's middle), and
 * which chance it is in (for its facet). GPU twin: glint-draw.wgsl flash().
 * @param {number} t real seconds @param {number} seed @param {GlintTiming} G
 * @returns {{ env: number, cycle: number }}
 */
export function flashAt(t, seed, G) {
  const period = G.everyS[0] + (G.everyS[1] - G.everyS[0]) * u01(hash32(seed, 0));
  const tt = t + period * u01(hash32(seed, 1));
  const cycle = Math.floor(tt / period), local = tt - cycle * period;
  const on = u01(hash32(seed, (cycle + 2) >>> 0)) < G.chance;
  const env = on && local < G.flashS ? Math.sin((Math.PI * local) / G.flashS) ** 2 : 0;
  return { env, cycle };
}

/**
 * The facet a flash tilts: a unit normal within facetDeg of straight up, new each chance.
 * GPU twin: glint-draw.wgsl facet(). @param {number} seed @param {number} cycle @param {GlintTiming} G
 * @returns {number[]}
 */
export function facetAt(seed, cycle, G) {
  const h = hash32(seed, (cycle + 2) >>> 0);
  const tilt = ((G.facetDeg * Math.PI) / 180) * Math.sqrt(u01(hash32(h, 1))), az = 2 * Math.PI * u01(hash32(h, 2));
  return [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
}

/**
 * The keepsakes on the shore as glint points: bottles boosted. @param {{ id: string, x: number, y: number, z: number, n: any }[]} list
 * @param {{ bottle: number, liftM: number }} R @returns {Glint[]}
 */
export function keepsakeGlints(list, R) {
  return list.map((s) => ({ x: s.x, y: s.y + R.liftM, z: s.z, seed: glintSeed(s.id), boost: s.n?.family === 'bottle' ? R.bottle : 1 }));
}

/**
 * The finds that glint (the recipe's kinds, and storm shells if it says so) as glint points; living
 * finds and ground pickups never do. @param {{ sp: string, x: number, z: number, storm: boolean }[]} shown
 * @param {(x: number, z: number) => number} heightAt @param {{ finds: string[], stormShells: boolean, liftM: number, findBoost: number }} R
 * @returns {Glint[]}
 */
export function findGlints(shown, heightAt, R) {
  return shown.filter((f) => R.finds.includes(f.sp) || (R.stormShells && f.storm && f.sp === 'shells'))
    .map((f) => ({ x: f.x, y: heightAt(f.x, f.z) + R.liftM, z: f.z, seed: hash32(Math.round(f.x * 100) | 0, Math.round(f.z * 100) | 0, 7), boost: R.findBoost }));
}
