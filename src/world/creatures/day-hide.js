// @ts-check
// Day hides (doc 11): frogs sit out the day tucked into cover near home (reeds, rushes, iris, thick
// grass), half hidden among the stems, and come out to the water's edge at dusk. Cover is what the
// island has grown: rush and grass cover per 1 m square (state.growth.cover, state.growth.grass)
// and reed and iris clumps (growth plants, each its flora recipe's clumpRadius). A frog with no
// cover near home stays at the edge. Live look only; nothing here is saved.

import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { hash32 } from '../../core/rng.js';

/**
 * How good a hide a point is, 0..1: the best cover there, each kind weighted by D.cover.
 * @param {any} growth state.growth @param {Record<string, any>} flora flora recipes by id
 * @param {any} D recipes/species/frog.json motion.dayHide @param {number} x @param {number} z
 */
export function coverAt(growth, flora, D, x, z) {
  if (!growth) return 0;
  const n = Math.round(Math.sqrt(growth.grass?.length ?? 0));
  let s = 0;
  if (n) {
    const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
    if (i >= 0 && j >= 0 && i < n && j < n) {
      const k = j * n + i;
      for (const [sp, w] of Object.entries(D.cover)) {
        const g = sp === 'grass' ? growth.grass : growth.cover?.[sp];
        if (g) s = Math.max(s, /** @type {number} */ (w) * (g[k] / 255));
      }
    }
  }
  // In a clump: best toward its middle, nothing past its rim.
  for (const p of growth.plants ?? []) {
    const w = D.cover[p.sp], R = flora?.[p.sp]?.shape?.clumpRadius;
    if (!w || !R) continue;
    const r = R * Math.min(1, Math.max(0.3, p.size));
    const d2 = ((p.x - x) ** 2 + (p.z - z) ** 2) / (r * r);
    if (d2 < 1) s = Math.max(s, w * (1 - 0.5 * d2));
  }
  return s;
}

/**
 * The best hide within D.reachM of a frog's home: cover of at least D.minScore, nearer is better,
 * on land or in the shallowest water among the stems; each frog its own spot (seeded by its id).
 * @param {{ growth: any, flora: Record<string, any>, water: (x: number, z: number) => { depth: number } }} env
 * @param {{ x: number, z: number }} home @param {number} id @param {any} D
 * @returns {{ x: number, z: number } | null}
 */
export function findHide(env, home, id, D) {
  let best = null, bestS = -Infinity;
  const R = D.reachM, step = D.stepM;
  for (let dz = -R; dz <= R; dz += step) {
    for (let dx = -R; dx <= R; dx += step) {
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      // A little seeded jitter, so two frogs from one bank pick different spots.
      const h = hash32(id, Math.round(dx / step) + 64, Math.round(dz / step) + 64);
      const x = home.x + dx + ((h & 255) / 255 - 0.5) * step, z = home.z + dz + (((h >>> 8) & 255) / 255 - 0.5) * step;
      const c = coverAt(env.growth, env.flora, D, x, z);
      if (c < D.minScore || env.water(x, z).depth > D.maxDepthM) continue;
      const s = c - D.perM * d + ((h >>> 16) & 255) / 255 * 0.05;
      if (s > bestS) { bestS = s; best = { x, z }; }
    }
  }
  return best;
}
