// @ts-check
// The mats' test ground (B3a): a patch of machair for growing the meadow islet's thyme, clover and
// trefoil with the real hourly rule (src/world/growth/cover.js), shared by the islet tests and
// tools/mat-growth-sim.mjs. Pure: runs in the browser test page and in node.

import { coverHour } from '../src/world/growth/cover.js';
import { HABITAT_CELLS } from '../src/world/growth/habitat.js';

/** A test habitat: open machair in cells 40..100 x 60..90, sandy turf below i 70, a grassy patch from it. @returns {any} */
export function testMachair() {
  const N = HABITAT_CELLS, n2 = N * N;
  const z = () => new Uint8Array(n2);
  const hab = { n: N, depthCm: z(), moisture: z(), salt: z(), still: z(), sea: z(), grass: z(), open: z(), band: z(),
    sand: z(), rock: z(), soil: z(), slopeDeg: z(), heightDm: z() };
  for (let j = 60; j <= 90; j++) for (let i = 40; i <= 100; i++) {
    const k = j * N + i;
    hab.open[k] = 1; hab.moisture[k] = 40; hab.heightDm[k] = 15;
    const patch = i >= 70;
    hab.sand[k] = patch ? 38 : 184; hab.grass[k] = patch ? 190 : 50; hab.soil[k] = 0;
  }
  return hab;
}

/**
 * Grow the mats for `days` game days from `day`, hour by hour; returns the maps.
 * @param {any} hab @param {any} env @param {Record<string, Uint8Array>} maps @param {number} day @param {number} days
 */
export function grow(hab, env, maps, day, days) {
  /** @type {any} */ let prev = { cover: maps };
  for (let h = day * 24; h < (day + days) * 24; h++) {
    const season = Math.floor(h / 24 / 14) % 4;
    const r = coverHour(prev, hab, env, h, season);
    prev = { cover: { ...prev.cover, ...r?.cover } };
  }
  return prev.cover;
}
