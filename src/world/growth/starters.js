// @ts-check
// Plants that come without growing: a new island's starters, the first cover of grass and rushes,
// and a seed or tussock set by hand (docs 10). Pure and worker-safe: seeded hashes only. Split out
// of coarse.js, unchanged.

import { subSeed, hash32 } from '../../core/rng.js';
import { HABITAT_ORIGIN, habitatCell } from './habitat.js';
import { suitability, suitabilityOf, groundAtCell } from './ground.js';
import { STAGE, initialGrowth, stageOf, cellIndex, crowded } from './plant.js';
import { coverSpecies, coverTarget, firstCover, grassTarget, yieldTo } from './cover.js';

/** @typedef {import('./plant.js').Plant} Plant @typedef {import('./plant.js').GrowthState} GrowthState @typedef {import('./ground.js').Need} Need */

/**
 * Bring a world up to its habitat right away, without waiting for the next hour: the starter
 * plants of a new island and a first cover of grass and the other cover plants. A no-op once they
 * all exist. Pure.
 * @param {any} state @param {any} env
 */
export function settleGrowth(state, env) {
  const hab = env.habitat?.();
  if (!hab || !env.recipes?.growth || !env.recipes.flora) return state;
  const prev = state.growth ?? initialGrowth();
  const covers = coverSpecies(env);
  const coverDone = covers.every(([sp]) => prev.cover?.[sp]);
  if (prev.starterDone && prev.grass && coverDone) return state;
  const g = { ...prev, plants: prev.plants.map((/** @type {Plant} */ p) => ({ ...p })) };
  if (!g.starterDone) { plantStarters(g, hab, env, (state.seasons?.index ?? 0) + (state.seasons?.phase ?? 0)); g.starterDone = true; }
  // The cover plants first (the rushes were here when you arrived), then grass, which gives way to them.
  if (!coverDone) {
    g.cover = { ...(prev.cover ?? {}) };
    for (const [sp, rec] of covers) {
      if (g.cover[sp]) continue;
      // A cover plant that is not a starter starts with none: it comes later, as a volunteer.
      const c = new Uint8Array(hab.n * hab.n);
      if (isStarter(env, sp)) for (let k = 0; k < c.length; k++) c[k] = coverTarget(rec, hab, k);
      g.cover[sp] = c;
    }
  }
  if (!g.grass) {
    const grass = new Uint8Array(hab.n * hab.n);
    const rival = firstCover(g, env);
    for (let k = 0; k < grass.length; k++) grass[k] = yieldTo(grassTarget(hab, env.recipes.growth.grass, k), rival?.[k], env.recipes.growth.grass);
    g.grass = grass;
  }
  return { ...state, growth: g };
}

/**
 * Does a species start on a new island? Those in growth.json `starters` (every species when the
 * recipe has no such list). @param {any} env @param {string} sp
 */
const isStarter = (env, sp) => !env.recipes.growth.starters || env.recipes.growth.starters.includes(sp);

/**
 * New island: a few mature clumps of each starter species, on its most suitable cells.
 * @param {GrowthState} g @param {import('./habitat.js').Habitat} hab @param {any} env
 * @param {number} [pos] season position (0 spring .. 4), for the starters' stage
 */
export function plantStarters(g, hab, env, pos = 0) {
  const seed = subSeed(env.seed, 'growth-starter');
  for (const sp of env.recipes.growth.species) {
    const rec = env.recipes.flora[sp];
    if (!rec?.starter || !isStarter(env, sp)) continue;
    /** @type {{ k: number, h: number }[]} */ const cand = [];
    for (let k = 0; k < hab.n * hab.n; k++) {
      const x = HABITAT_ORIGIN + (k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5;
      if (suitability(rec, hab, x, z).suit >= rec.starter.minSuit) cand.push({ k, h: hash32(seed, k) });
    }
    cand.sort((a, b) => a.h - b.h || a.k - b.k);
    /** @type {Plant[]} */ const placed = [];
    for (const c of cand) {
      if (placed.length >= rec.starter.count) break;
      const x = HABITAT_ORIGIN + (c.k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(c.k / hab.n) + 0.5;
      const sp2 = rec.starter.spacingM * rec.starter.spacingM;
      if (placed.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < sp2)) continue;
      // Not on a plant of a species placed before (marsh marigold and iris like the same bank);
      // the species placed first are unchanged by this.
      if (g.plants.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < 0.36)) continue;
      const p = { id: g.nextId++, sp, x, z, age: 48, size: rec.growth.stages.matureSize + 0.1, best: 0, stage: STAGE.mature, low: 0, drown: 0, last: 0 };
      p.best = p.size;
      // In the season's stage at once (in flower in its window), not only from the next hour.
      p.stage = stageOf(rec, p, pos);
      placed.push(p);
    }
    g.plants.push(...placed);
  }
  basinStarters(g, hab, env, pos);
}

/**
 * An island recipe may give a basin starter plants of its own (recipes/land `basins[].starters`,
 * species id to count), so a marsh starts with reeds and iris even when the island-wide starters
 * landed elsewhere. They go on the suitable cells within the basin's reach, in seeded hash order,
 * the species' starter spacing apart (from every plant of that species). Islands without them are
 * unchanged.
 * @param {GrowthState} g @param {import('./habitat.js').Habitat} hab @param {any} env
 * @param {number} [pos] season position, for the starters' stage
 */
function basinStarters(g, hab, env, pos = 0) {
  const basins = env.recipes.land?.basins;
  if (!basins) return;
  const seed = subSeed(env.seed, 'growth-basin-starter');
  basins.forEach((/** @type {any} */ b, /** @type {number} */ bi) => {
    if (!b.starters) return;
    const reach = b.outerRadius + (b.jitter ?? 0);
    for (const sp of Object.keys(b.starters).sort()) {
      const rec = env.recipes.flora[sp];
      if (!rec?.starter || !isStarter(env, sp)) continue;
      /** @type {{ k: number, h: number }[]} */ const cand = [];
      const i0 = Math.max(0, Math.floor(b.x - reach - HABITAT_ORIGIN)), i1 = Math.min(hab.n - 1, Math.floor(b.x + reach - HABITAT_ORIGIN));
      const j0 = Math.max(0, Math.floor(b.z - reach - HABITAT_ORIGIN)), j1 = Math.min(hab.n - 1, Math.floor(b.z + reach - HABITAT_ORIGIN));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = HABITAT_ORIGIN + i + 0.5, z = HABITAT_ORIGIN + j + 0.5;
          if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) > reach * reach) continue;
          const k = j * hab.n + i;
          if (suitabilityOf(rec, groundAtCell(hab, k)).suit >= rec.starter.minSuit) cand.push({ k, h: hash32(seed, bi, k) });
        }
      }
      cand.sort((a, b2) => a.h - b2.h || a.k - b2.k);
      const sp2 = rec.starter.spacingM * rec.starter.spacingM;
      let placed = 0;
      for (const c of cand) {
        if (placed >= b.starters[sp]) break;
        const x = HABITAT_ORIGIN + (c.k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(c.k / hab.n) + 0.5;
        if (g.plants.some((p) => p.sp === sp && (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < sp2)) continue;
        const size = rec.growth.stages.matureSize + 0.1;
        const p = { id: g.nextId++, sp, x, z, age: 48, size, best: size, stage: STAGE.mature, low: 0, drown: 0, last: 0 };
        p.stage = stageOf(rec, p, pos);
        g.plants.push(p);
        placed++;
      }
    }
  });
}

/**
 * @typedef {Object} PlantOpts  how a planting by hand goes in (P2g: seed balls, moved clumps, cuttings)
 * @property {number} [minSuit] the least suitability it takes on (0.2; a seed ball a little less)
 * @property {number} [size] it goes in grown this far (a clump at the size it was lifted, a cutting
 *   rooted young), its age past sprouting, its stage from its size; else a seed
 * @property {number} [best] the largest it had been (a moved clump keeps it)
 * @property {boolean} [capped] the species' island cap (spread.maxCount) applies, as to its own spread
 */

/**
 * Plant a seed by hand (the Plant tool), or set a grown plant in (P2g). Returns the new state, or
 * the reason it would not take.
 * @param {any} state @param {string} sp @param {number} x @param {number} z @param {any} env
 * @param {PlantOpts} [o]
 * @returns {{ state: any, ok: boolean, id?: number, reason?: Need|'crowded'|'full'|'unknown' }}
 */
export function plantSeed(state, sp, x, z, env, o = {}) {
  const hab = env.habitat?.();
  const rec = env.recipes.flora?.[sp];
  if (!hab || !rec) return { state, ok: false, reason: 'unknown' };
  const g = state.growth ?? initialGrowth();
  if (g.plants.length >= env.recipes.growth.maxPlants) return { state, ok: false, reason: 'full' };
  const s = suitability(rec, hab, x, z);
  if (s.suit < (o.minSuit ?? 0.2)) return { state, ok: false, reason: s.worst };
  if (crowded(cellIndex(g.plants), g.plants, sp, x, z, rec.spread?.minSpacingM ?? 0.5)) return { state, ok: false, reason: 'crowded' };
  if (o.capped && rec.spread?.maxCount && g.plants.filter((q) => q.sp === sp).length >= rec.spread.maxCount) return { state, ok: false, reason: 'full' };
  const p = { id: g.nextId, sp, x, z, age: 0, size: 0, best: 0, stage: STAGE.seed, low: 0, drown: 0, last: 0 };
  if (o.size !== undefined) {
    // Set in grown: past sprouting, its stage from its size (the next hour reads the season too).
    const S = rec.growth.stages, size = Math.max(0, Math.min(1, o.size));
    Object.assign(p, { age: S.sproutH, size, best: Math.max(size, o.best ?? 0), stage: size >= S.matureSize ? STAGE.mature : size >= S.youngSize ? STAGE.young : STAGE.sprout });
  }
  return { state: { ...state, growth: { ...g, nextId: g.nextId + 1, plants: [...g.plants, p] } }, ok: true, id: p.id };
}

/**
 * Lift a plant out whole (P2g, the shovel): it leaves the island, and its record comes back to be
 * set in elsewhere at the size it was. @param {any} state @param {number} id
 * @returns {{ state: any, plant: any | null }}
 */
export function liftPlant(state, id) {
  const g = state.growth;
  const plant = g?.plants?.find((/** @type {any} */ p) => p.id === id) ?? null;
  if (!plant) return { state, plant: null };
  return { state: { ...state, growth: { ...g, plants: g.plants.filter((/** @type {any} */ p) => p.id !== id) } }, plant: { ...plant } };
}

/**
 * Start a tussock of a cover plant (rushes) at a world point: the Plant tool. Like plantSeed: it
 * says which need the ground misses most, or that one already grows there.
 * @param {any} state @param {string} sp @param {number} x @param {number} z @param {any} env
 * @returns {{ state: any, ok: boolean, reason?: string }}
 */
export function plantCover(state, sp, x, z, env) {
  const hab = env.habitat?.();
  const rec = env.recipes.covers?.[sp];
  const g = state.growth ?? initialGrowth();
  const cur = g.cover?.[sp];
  if (!hab || !rec || !cur) return { state, ok: false, reason: 'unknown' };
  const k = habitatCell(x, z);
  if (k < 0 || !hab.open[k]) return { state, ok: false, reason: 'outside' };
  const s = suitability(rec, hab, x, z);
  if (s.suit < 0.2) return { state, ok: false, reason: s.worst };
  const start = rec.spread?.plantStart ?? 60;
  if (cur[k] >= start) return { state, ok: false, reason: 'crowded' };
  const c = cur.slice();
  c[k] = start;
  return { state: { ...state, growth: { ...g, cover: { ...g.cover, [sp]: c } } }, ok: true };
}
