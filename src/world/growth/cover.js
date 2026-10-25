// @ts-check
// Grass and the other cover plants (rushes): a share per habitat cell 0..255 that moves each hour
// toward what the ground supports (docs 10). Pure and worker-safe: seeded randomness only. Split
// out of coarse.js, unchanged.

import { stream, subSeed, det } from '../../core/rng.js';
import { openBox } from '../ecology/fields.js';
import { smooth01, groundAtCell, suitabilityOf } from './ground.js';

/**
 * Cells past the opened island that grass cover still works out each hour: more than the farthest
 * any ground value reaches out from the island (the salt's saltM, 4 cells, growth.json habitat).
 */
const MARGIN = 6;

/**
 * Each cover's target per square depends only on the ground and the recipe, never on the hour, so
 * it is worked out once per habitat (a new habitat comes with every edit to the ground) and kept:
 * habitat -> recipe -> targets over the whole grid. @type {WeakMap<object, WeakMap<object, Uint8Array>>}
 */
const targetCache = new WeakMap();

/**
 * The targets over the whole grid for one habitat and recipe, worked out on first use.
 * @param {any} hab @param {object} key the recipe @param {(k: number) => number} target
 */
function targetsOf(hab, key, target) {
  let byRec = targetCache.get(hab);
  if (!byRec) { byRec = new WeakMap(); targetCache.set(hab, byRec); }
  let t = byRec.get(key);
  if (!t) {
    t = new Uint8Array(hab.n * hab.n);
    for (let k = 0; k < t.length; k++) t[k] = target(k);
    byRec.set(key, t);
  }
  return t;
}

/**
 * Grass cover target per cell, 0..255: how well grass likes the ground (none in water or where the
 * tide reaches, thinning on salt). Painting decides where grass is at once; this cover follows the
 * ground slowly, so a dug pond drowns its grass over a day and a drained one greens again, and grass
 * never spreads down into the tide band, where high water would stand over it.
 * @param {import('./habitat.js').Habitat} hab @param {any} G recipes/world/growth.json grass @param {number} k
 */
export function grassTarget(hab, G, k) {
  if (hab.depthCm[k] > 0 || hab.sea[k] || hab.band?.[k]) return 0;
  const s = hab.salt[k] / 255;
  // The ground axes (docs/future/10): earth rather than sand or rock, and not too steep.
  const at = G.habitat ? groundAtCell(hab, k) : null;
  // Grass stays on the camp pad (kept short by the grass shader), so the clear mask does not apply.
  const ground = at ? suitabilityOf(G, at.clear ? { ...at, clear: 0 } : at).suit : 1;
  return Math.floor(255 * ground * (1 - smooth01((s - G.saltFrom) / (G.saltFull - G.saltFrom))));
}

/**
 * Cover target per cell, 0..255, for a cover plant other than grass: how well it likes the ground.
 * @param {any} rec its flora recipe @param {import('./habitat.js').Habitat} hab @param {number} k
 */
export function coverTarget(rec, hab, k) {
  return Math.floor(255 * suitabilityOf(rec, groundAtCell(hab, k)).suit);
}

/** The first cover plant other than grass (rushes), as it stands in this growth state. @param {any} g @param {any} env */
export function firstCover(g, env) {
  const id = env.recipes.growth.cover?.[0];
  return id ? g.cover?.[id] ?? null : null;
}

/**
 * Grass's target where rushes stand: it gives way by yieldToCover of the rushes' share.
 * @param {number} target @param {number | undefined} rush 0..255 @param {any} G recipes/world/growth.json grass
 */
export function yieldTo(target, rush, G) {
  if (!rush || !G.yieldToCover) return target;
  return Math.floor(target * (1 - (G.yieldToCover * rush) / 255));
}

/** The cover plants other than grass that this world grows: [id, recipe]. @param {any} env */
export function coverSpecies(env) {
  return (env.recipes.growth.cover ?? []).map((/** @type {string} */ sp) => [sp, env.recipes.covers?.[sp]]).filter((/** @type {any[]} */ e) => e[1]);
}

/**
 * One hour of grass cover: toward what the ground supports, a share of the gap each hour (integers).
 * Where rushes stand thick on soaked ground, grass gives way to them. Only the opened island and a
 * margin past it (MARGIN: more than the salt's reach) can change from hour to hour; past that the
 * ground never does, its cover sits at its target from the first hour on, and it is copied as it was.
 * @param {any} prev last hour's growth state @param {import('./habitat.js').Habitat} hab @param {any} env
 * @returns {Uint8Array}
 */
export function grassHour(prev, hab, env) {
  const n = hab.n * hab.n;
  const grass = prev.grass ? prev.grass.slice() : new Uint8Array(n);
  const G2 = env.recipes.growth.grass;
  const rival = firstCover(prev, env);
  const B = prev.grass ? openBox(hab, MARGIN) : openBox(hab, hab.n);
  const grassTargets = targetsOf(hab, G2, (k) => grassTarget(hab, G2, k));
  for (let j = B.j0; j <= B.j1; j++) {
    for (let k = j * hab.n + B.i0; k <= j * hab.n + B.i1; k++) {
      const target = yieldTo(grassTargets[k], rival?.[k], G2);
      grass[k] = prev.grass ? approach(prev.grass[k], target, G2.ratePerH) : target;
    }
  }
  return grass;
}

/**
 * One hour of the other cover plants (rushes): the same rule toward how well each likes the ground,
 * but bare ground is only taken from a stand next to it (creeping), or now and then by a seed that
 * lands within reach of a stand, so a new marsh has to be found by them. Null when the world grows
 * none; took counts the cells each species newly took.
 * @param {any} prev last hour's growth state @param {import('./habitat.js').Habitat} hab @param {any} env @param {number} hourIndex
 * @returns {{ cover: Record<string, Uint8Array>, took: Record<string, number> } | null}
 */
export function coverHour(prev, hab, env, hourIndex) {
  const covers = coverSpecies(env);
  if (!covers.length) return null;
  const n = hab.n * hab.n;
  /** @type {Record<string, Uint8Array>} */ const cover = {};
  /** @type {Record<string, number>} */ const took = {};
  for (const [sp, rec] of covers) {
    const was = prev.cover?.[sp];
    // A cover plant grows only on the opened island (its target is 0 past it, and so is it), so
    // only that box is worked out after the first hour; the rest is copied as it was.
    const c = was ? was.slice() : new Uint8Array(n);
    const SP = rec.spread ?? {};
    const from = Math.round(255 * (SP.fromShare ?? 0));
    let newly = 0;
    const CB = was ? openBox(hab, 1) : openBox(hab, hab.n);
    const targets = targetsOf(hab, rec, (k) => coverTarget(rec, hab, k));
    for (let j = CB.j0; j <= CB.j1; j++) {
      for (let k = j * hab.n + CB.i0; k <= j * hab.n + CB.i1; k++) {
        const target = targets[k];
        if (!was) { c[k] = target; continue; }
        if (was[k] === 0 && target > 0 && from > 0 && !standNear(was, hab.n, k, from)) continue;
        c[k] = approach(was[k], target, rec.growth.ratePerH);
        if (was[k] === 0 && c[k] > 0) newly++;
      }
    }
    if (was && SP.jumpPerH > 0) newly += seedJump(c, was, rec, hab, from, subSeed(env.seed, `cover-seed-${sp}`), hourIndex);
    cover[sp] = c;
    if (newly) took[sp] = newly;
  }
  return { cover, took };
}

/**
 * Is there a stand (a share of at least `from`) in one of the eight cells around k?
 * @param {Uint8Array} c @param {number} n grid side @param {number} k @param {number} from
 */
function standNear(c, n, k, from) {
  const i = k % n, j = Math.floor(k / n);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n && c[jj * n + ii] >= from) return true;
    }
  }
  return false;
}

/**
 * Now and then a cover plant's seed is carried off a stand (wind, birds, water) and lands within
 * reach of it: if the ground there suits it well and it is not already growing there or beside
 * there, a new tussock starts. Seeded by the hour, so the same island grows the same way.
 * @param {Uint8Array} c this hour's cover (changed in place) @param {Uint8Array} was last hour's
 * @param {any} rec the flora recipe (spread: jumpPerH, jumpM, jumpMinSuit, jumpStart)
 * @param {import('./habitat.js').Habitat} hab @param {number} from @param {number} seed @param {number} hourIndex
 * @returns {number} 1 when a seed took, else 0
 */
function seedJump(c, was, rec, hab, from, seed, hourIndex) {
  const SP = rec.spread;
  const r = stream(seed, hourIndex);
  if (r.next() >= SP.jumpPerH) return 0;
  /** @type {number[]} */ const stands = [];
  const n = hab.n;
  // Stands grow only on the opened island: its box, read in grid order, finds the same stands.
  const SB = openBox(hab, 1);
  for (let j = SB.j0; j <= SB.j1; j++) for (let k = j * n + SB.i0; k <= j * n + SB.i1; k++) if (was[k] >= from) stands.push(k);
  if (!stands.length) return 0;
  // Most seeds land on ground that will not do; a few tries per carried seed find the wet places.
  for (let tries = 0; tries < (SP.jumpTries ?? 4); tries++) {
    const s = stands[r.int(stands.length)];
    const a = r.next() * 2 * det.PI, d = 2 + r.next() * (SP.jumpM - 2);
    const i = (s % n) + Math.round(det.cos(a) * d), j = Math.floor(s / n) + Math.round(det.sin(a) * d);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const k = j * n + i;
    if (c[k] > 0 || standNear(was, n, k, 1)) continue;
    if (coverTarget(rec, hab, k) < 255 * SP.jumpMinSuit) continue;
    c[k] = SP.jumpStart;
    return 1;
  }
  return 0;
}

/**
 * One hour's move of a cover share toward its target: ratePerH of the gap, at least one step
 * (integers). @param {number} cur @param {number} target @param {number} ratePerH
 */
function approach(cur, target, ratePerH) {
  const diff = target - cur;
  let step = Math.floor(Math.abs(diff) * ratePerH);
  if (step === 0 && diff !== 0) step = 1;
  return diff > 0 ? cur + step : diff < 0 ? cur - step : cur;
}
