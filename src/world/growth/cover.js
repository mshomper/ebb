// @ts-check
// Grass and the other cover plants (rushes): a share per habitat cell 0..255 that moves each hour
// toward what the ground supports (docs 10). Pure and worker-safe: seeded randomness only. Split
// out of coarse.js, unchanged.

import { stream, subSeed, det, hash32 } from '../../core/rng.js';
import { makeFbm, fbm } from '../terrain/landform.js';
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

/**
 * A mat (the meadow islet's wild thyme, red clover and bird's-foot trefoil): a cover plant that is
 * only ever planted, so its map is absent until the first clump goes in, and it spreads from there.
 * @param {any} rec its flora recipe
 */
export const isMat = (rec) => !!rec?.spread?.planted;

/**
 * Grass's target where mats stand: it gives way by each mat's grassYield of its share (thyme takes
 * the ground outright, clover grows in the sward).
 * @param {number} target @param {[any, Uint8Array][]} mats [recipe, last hour's map] @param {number} k
 */
function yieldToMats(target, mats, k) {
  let keep = 1;
  for (const [rec, c] of mats) if (c[k]) keep -= (rec.spread.grassYield ?? 0) * c[k] / 255;
  return keep >= 1 ? target : Math.floor(target * Math.max(0, keep));
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
  /** @type {[any, Uint8Array][]} */ const mats = [];
  for (const [sp, rec] of coverSpecies(env)) if (isMat(rec) && prev.cover?.[sp]) mats.push([rec, prev.cover[sp]]);
  const B = prev.grass ? openBox(hab, MARGIN) : openBox(hab, hab.n);
  const grassTargets = targetsOf(hab, G2, (k) => grassTarget(hab, G2, k));
  for (let j = B.j0; j <= B.j1; j++) {
    for (let k = j * hab.n + B.i0; k <= j * hab.n + B.i1; k++) {
      let target = yieldTo(grassTargets[k], rival?.[k], G2);
      if (mats.length) target = yieldToMats(target, mats, k);
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
 * Mats (isMat) follow matHour instead.
 * @param {any} prev last hour's growth state @param {import('./habitat.js').Habitat} hab @param {any} env @param {number} hourIndex
 * @param {number} [season] the season now, 0 spring .. 3 winter (mats grow and seed by it)
 * @returns {{ cover: Record<string, Uint8Array>, took: Record<string, number> } | null}
 */
export function coverHour(prev, hab, env, hourIndex, season = 0) {
  const covers = coverSpecies(env);
  if (!covers.length) return null;
  const n = hab.n * hab.n;
  /** @type {Record<string, Uint8Array>} */ const cover = {};
  /** @type {Record<string, number>} */ const took = {};
  /** @type {Uint8Array[]} */ const matMaps = [];
  for (const [sp, rec] of covers) if (isMat(rec) && prev.cover?.[sp]) matMaps.push(prev.cover[sp]);
  for (const [sp, rec] of covers) {
    const was = prev.cover?.[sp];
    if (isMat(rec)) {
      // Absent until planted; then it grows and seeds by the season, sharing the ground with the other mats.
      if (!was) continue;
      const r = matHour(sp, rec, was, matMaps.filter((m) => m !== was), hab, env, hourIndex, season);
      cover[sp] = r.c;
      if (r.newly) took[sp] = r.newly;
      continue;
    }
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
 * A mat's target per cell, 0..255: how well it likes the ground, less where the painted turf is
 * thick for a mat that grass shades out (thyme wants the thinnest turf). Depends only on the
 * habitat, so it is cached with it.
 * @param {any} rec @param {import('./habitat.js').Habitat} hab @param {number} k
 */
export function matTarget(rec, hab, k) {
  if (!hab.open[k] || hab.sea[k] || hab.band?.[k] || hab.depthCm[k] > 0) return 0;
  const shade = (rec.spread.shadedBy ?? 0) * hab.grass[k] / 255;
  return Math.floor(255 * suitabilityOf(rec, groundAtCell(hab, k)).suit * Math.max(0, 1 - shade));
}

/**
 * The squares a mat never creeps into: the high ground of a slow seeded noise over patchM meters,
 * about half of patchiness of them, so a mat grows in cushions and drifts with open ground between
 * rather than as one even sheet. A seed or a planted clump can still start there. Cached per
 * habitat with the targets. @param {any} rec @param {import('./habitat.js').Habitat} hab @param {number} seed
 */
function gapsOf(rec, hab, seed) {
  const SP = rec.spread;
  if (!SP.patchM || !SP.patchiness) return null;
  const f = makeFbm(seed, 0, { octaves: 2, scale: 1 / SP.patchM });
  const cut = 1 - 0.5 * SP.patchiness;
  return targetsOf(hab, SP, (k) => (Math.min(1, Math.max(0, 0.5 + 2.5 * fbm(f, k % hab.n, Math.floor(k / hab.n)))) > cut ? 1 : 0));
}

/**
 * One hour of a mat. It creeps only into a square beside a stand at least fromShare full, filling
 * toward its target at ratePerH of the gap (times the season's seasonRate, so it rests in winter),
 * and never past the room the other mats leave (the first to hold a square keeps it). Now and then
 * (jumpPerH, times the season's jumpSeason: seed is set after flowering) a seed lands 2 to jumpM
 * meters off a stand and starts a new patch where the ground suits it at least jumpMinSuit. Only the
 * stands' own box and a square past it are worked out, so a mat costs nothing until it grows.
 * @param {string} sp @param {any} rec @param {Uint8Array} was last hour's map @param {Uint8Array[]} others the other mats' last maps
 * @param {import('./habitat.js').Habitat} hab @param {any} env @param {number} hourIndex @param {number} season
 * @returns {{ c: Uint8Array, newly: number }}
 */
export function matHour(sp, rec, was, others, hab, env, hourIndex, season) {
  const n = hab.n, SP = rec.spread;
  const c = was.slice();
  const rate = rec.growth.ratePerH * (rec.growth.seasonRate?.[season] ?? 1);
  const from = Math.round(255 * (SP.fromShare ?? 0.5));
  const targets = targetsOf(hab, rec, (k) => matTarget(rec, hab, k));
  const gaps = gapsOf(rec, hab, subSeed(env.seed, `mat-gaps-${sp}`));
  // A square beside a stand is taken only now and then (creepChance an hour, by a seeded hash), so
  // a patch's edge grows ragged rather than as the grid's square.
  const creepSeed = subSeed(env.seed, `mat-creep-${sp}`);
  const creeps = (/** @type {number} */ k) => !(SP.creepChance < 1) || hash32(creepSeed, k, hourIndex) / 4294967296 < SP.creepChance;
  const room = (/** @type {number} */ k) => { let r = 255; for (const o of others) r -= o[k]; return Math.max(0, r); };
  // The stands' box (any share), read in grid order.
  let i0 = n, j0 = n, i1 = -1, j1 = -1;
  for (let k = 0; k < was.length; k++) {
    if (!was[k]) continue;
    const i = k % n, j = (k - i) / n;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  }
  if (i1 < 0) return { c, newly: 0 };
  let newly = 0;
  if (rate > 0) {
    for (let j = Math.max(0, j0 - 1); j <= Math.min(n - 1, j1 + 1); j++) {
      for (let i = Math.max(0, i0 - 1); i <= Math.min(n - 1, i1 + 1); i++) {
        const k = j * n + i;
        const target = Math.min(targets[k], room(k));
        if (was[k] === 0 && (target === 0 || gaps?.[k] || !standNear(was, n, k, from) || !creeps(k))) continue;
        c[k] = approach(was[k], target, rate);
        if (was[k] === 0 && c[k] > 0) newly++;
      }
    }
  }
  const jump = (SP.jumpPerH ?? 0) * (SP.jumpSeason?.[season] ?? 1);
  if (jump > 0) {
    const r = stream(subSeed(env.seed, `cover-seed-${sp}`), hourIndex);
    if (r.next() < jump) {
      /** @type {number[]} */ const stands = [];
      for (let j = j0; j <= j1; j++) for (let k = j * n + i0; k <= j * n + i1; k++) if (was[k] >= from) stands.push(k);
      for (let tries = 0; stands.length && tries < (SP.jumpTries ?? 4); tries++) {
        const s = stands[r.int(stands.length)];
        const a = r.next() * 2 * det.PI, d = 2 + r.next() * (SP.jumpM - 2);
        const i = (s % n) + Math.round(det.cos(a) * d), j = Math.floor(s / n) + Math.round(det.sin(a) * d);
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = j * n + i;
        if (c[k] > 0 || standNear(was, n, k, 1)) continue;
        if (targets[k] < 255 * SP.jumpMinSuit || room(k) < SP.jumpStart) continue;
        c[k] = SP.jumpStart;
        newly++;
        break;
      }
    }
  }
  return { c, newly };
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
