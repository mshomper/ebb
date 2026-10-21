// @ts-check
// Every keepsake family by id (docs/future/12): how its numbers are drawn from a seed, how they turn
// into a mesh, and the plain line on its card. Rarity is picked first, from the conditions
// (rarity.js), then the family's tier shapes the numbers. A kept keepsake saves its numbers (with
// its family and gen), so it rebuilds the same for good.

import { hash32 } from '../../../core/rng.js';
import { pickRarity } from '../rarity.js';
import { u01 } from './common.js';
import { shellNumbers, shellMesh, shellWords } from './shell.js';
import { stoneNumbers, stoneMesh, stoneWords } from './stone.js';
import { fossilNumbers, fossilMesh, fossilWords } from './fossil.js';
import { driftwoodNumbers, driftwoodMesh, driftwoodWords } from './driftwood.js';
import { featherNumbers, featherMesh, featherWords } from './feather.js';
import { bottleNumbers, bottleMesh, bottleWords } from './bottle.js';

/**
 * @typedef {{ salt: number, numbers: (h0: number, rarity: any, K: any) => any,
 *   mesh: (n: any, K: any) => import('../../finds/procedural.js').Mesh, words: (n: any, K: any) => string,
 *   view: (n: any) => [number, number] }} Family
 */

/** Families by id. view is [yaw, pitch] in degrees, the side its sketch is traced from. */
export const FAMILIES = /** @type {Record<string, Family>} */ ({
  shell: { salt: 0x5e11, numbers: shellNumbers, mesh: (n, K) => shellMesh(n, K.shells.mesh), words: shellWords, view: (n) => (n.form === 'coil' || n.form === 'ear' ? [0, 70] : [25, 18]) },
  stone: { salt: 0x570e, numbers: stoneNumbers, mesh: stoneMesh, words: stoneWords, view: (n) => (n.mark === 'holed' ? [20, 62] : [20, 35]) },
  fossil: { salt: 0xf055, numbers: fossilNumbers, mesh: fossilMesh, words: fossilWords, view: () => [10, 62] },
  driftwood: { salt: 0xd1f7, numbers: driftwoodNumbers, mesh: driftwoodMesh, words: driftwoodWords, view: () => [-15, 35] },
  feather: { salt: 0xfea7, numbers: featherNumbers, mesh: featherMesh, words: featherWords, view: () => [135, 80] },
  bottle: { salt: 0xb071, numbers: bottleNumbers, mesh: bottleMesh, words: bottleWords, view: () => [-20, 25] },
});

/**
 * The keepsake of a family the sea leaves for seed and slot n under these conditions, or of a
 * given rarity. Pure. @param {string} family @param {number} seed @param {number} n @param {any} K
 * @param {import('../rarity.js').Conditions} cond @param {import('../rarity.js').Rarity} [force]
 */
export function rollKeepsake(family, seed, n, K, cond, force) {
  const F = FAMILIES[family];
  const h0 = hash32(seed, n, F.salt);
  const rarity = force ?? pickRarity(u01(hash32(h0, 1)), K.rarity, cond);
  return F.numbers(h0, rarity, K);
}

/** A keepsake's mesh from its numbers. @param {any} n @param {any} K */
export const keepsakeMesh = (n, K) => FAMILIES[n.family].mesh(n, K);
/** A keepsake's card line. @param {any} n @param {any} K */
export const keepsakeWords = (n, K) => FAMILIES[n.family].words(n, K);
/** The side a keepsake's sketch is traced from. @param {any} n */
export const keepsakeView = (n) => FAMILIES[n.family].view(n);
