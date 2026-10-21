// @ts-check
// What each high tide leaves on the strandline (docs/future/12, piece K2). Pure: the same world
// seed, tide and shore give the same keepsakes, live or after time away, and nothing is saved
// until one is kept. A tide leaves a small budget for the whole island (more at spring tides),
// never more for walking the beach; the cells it uses are drawn by seed among that tide's
// strandline cells, weighted toward sheltered ones, and kept apart.

import { det, hash32 } from '../../core/rng.js';
import { pickIndex, pickRarity } from './rarity.js';
import { FAMILIES } from './families/index.js';
import { u01 } from './families/common.js';

/** Salts the strandline roll apart from the families' own. */
const SALT = 0x5703;

/**
 * @typedef {{ k: number, x: number, z: number, weight?: number }} StrandCell a cell on a tide's
 *   strandline: its index, its centre (m), and how sheltered it is (cove field, 1 when unknown)
 * @typedef {{ id: string, tideId: number, k: number, x: number, z: number, yaw: number, n: any }} ShoreKeepsake
 */

/**
 * The keepsakes one high tide leaves. @param {number} seed subSeed(world seed, 'keepsakes')
 * @param {number} tideId which high water @param {StrandCell[]} cells that tide's strandline cells
 * @param {{ spring: number, season?: string }} cond @param {any} K keepsakes.json
 * @param {{ budget?: number[] }} [o] budget: weights for 0, 1, 2, 3 (tests)
 * @returns {ShoreKeepsake[]}
 */
export function tideKeepsakes(seed, tideId, cells, cond, K, o = {}) {
  const S = K.shore;
  if (!cells.length) return [];
  const weights = o.budget ?? (cond.spring >= S.springMin ? S.springBudget : S.budget);
  const want = pickIndex(u01(hash32(seed, tideId, SALT, 1)), weights);
  if (!want) return [];
  // A weighted draw without replacement: each cell's key is u^(1/weight), the largest win.
  const keyed = cells.map((c) => ({ c, key: det.pow(u01(hash32(seed, tideId, c.k, SALT)) || 1e-9, 1 / Math.max(0.05, c.weight ?? 1)) }));
  keyed.sort((a, b) => b.key - a.key || a.c.k - b.c.k);
  /** @type {StrandCell[]} */ const chosen = [];
  for (const { c } of keyed) {
    if (chosen.length >= want) break;
    if (chosen.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < S.spacingM)) continue;
    chosen.push(c);
  }
  const fams = Object.keys(S.families);
  const fw = fams.map((f) => S.families[f]);
  return chosen.map((c) => {
    const h = hash32(seed, tideId, c.k, SALT, 2);
    const family = fams[pickIndex(u01(hash32(h, 1)), fw)];
    const rarity = pickRarity(u01(hash32(h, 2)), K.rarity, cond);
    const n = FAMILIES[family].numbers(hash32(h, 3, FAMILIES[family].salt), rarity, K);
    return { id: `${tideId}:${c.k}`, tideId, k: c.k, x: c.x, z: c.z, yaw: u01(hash32(h, 4)) * Math.PI * 2, n };
  });
}

/**
 * The keepsakes on the shore now: those the recent tides left, newest first, up to the island's
 * cap, less any let go. @param {ShoreKeepsake[][]} byTide each tide's, newest tide first
 * @param {number} max @param {Set<string>} [gone] ids let go or kept
 */
export function onShore(byTide, max, gone) {
  /** @type {ShoreKeepsake[]} */ const out = [];
  for (const list of byTide) for (const s of list) {
    if (out.length >= max) return out;
    if (!gone?.has(s.id)) out.push(s);
  }
  return out;
}
