// @ts-check
// The growth step of the hourly tick (docs 10, 11). Pure and worker-safe: no GPU, DOM, store or
// events; seeded randomness only (core/rng.js stream), and only + - * / and Math.floor/min/max/abs
// on numbers, so a watched hour and an hour simulated while away give the same island.
//
// Each hour every plant asks: is the ground right (moisture, water depth, still water, salt from
// the habitat grid, each axis only if its recipe names it), is it the season to grow, and is it
// drowning? It grows toward full size by the answer, changes stage, and a mature plant of a
// spreading species sends a rhizome along the best bearing or drops a seed nearby.
// The grass cover per square meter moves toward what the ground supports. A new island gets a few
// starter clumps the first time the habitat is known.
//
// State contract: coarseStep never mutates its input; it returns a shallow copy of `state` with a
// fresh `state.growth`.
//
// env.habitat() returns the current Habitat (world/growth/habitat.js) or null; env.recipes.growth
// is recipes/world/growth.json and env.recipes.flora maps species id to its recipe.

import { stream, subSeed, hash32, det } from '../../core/rng.js';
import { HABITAT_CELLS, HABITAT_ORIGIN, habitatCell } from './habitat.js';
import { arrivedOf, volunteerAt } from './volunteers.js';
import { plantSeasonPos } from './phenology.js';

/** Stages, in order. */
export const STAGE = Object.freeze({ seed: 0, sprout: 1, young: 2, mature: 3, flowering: 4, dormant: 5 });

/**
 * @typedef {Object} Plant
 * @property {number} id @property {string} sp  species id (recipes/flora/<sp>.json)
 * @property {number} x  @property {number} z   world meters
 * @property {number} age   game hours since planted
 * @property {number} size  0..1 of the species' full size
 * @property {number} best  largest size reached
 * @property {number} stage STAGE
 * @property {number} low   hours in a row of poor ground
 * @property {number} drown hours in a row under too much water
 * @property {number} last  hour index of its last rhizome
 */

/**
 * cover: the cover plants other than grass (recipes/world/growth.json `cover`), each a share per
 * habitat cell 0..255, like `grass`. arrived: the species on the island, by the hour each came
 * (the starters at the first hour, the rest as volunteers, volunteers.js); since: the island's first
 * growth hour. Both are set at the first hour, and are missing from a save made before them.
 * @typedef {{ nextId: number, starterDone: boolean, plants: Plant[], grass: Uint8Array | null,
 *   cover: Record<string, Uint8Array> | null, habitatHash: number,
 *   arrived?: Record<string, number>, since?: number }} GrowthState
 */

/** @returns {GrowthState} */
export function initialGrowth() {
  return { nextId: 1, starterDone: false, plants: [], grass: null, cover: null, habitatHash: 0 };
}

const smooth01 = (/** @type {number} */ t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * Plateau bell: 1 inside [lo, hi], easing to 0 a tolerance beyond either side.
 * @param {number} x @param {number[]} r [lo, hi, tolerance]
 */
function bell(x, r) {
  if (x < r[0]) return smooth01((x - (r[0] - r[2])) / r[2]);
  if (x > r[1]) return smooth01(((r[1] + r[2]) - x) / r[2]);
  return 1;
}

/**
 * What the ground offers a plant at a world point: moisture and salt 0..1, water depth (m; the
 * sea counts as far too deep), still 1 in still water and damp ground, or null off the grid or
 * outside the opened island.
 * @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 */
export function groundAt(hab, x, z) {
  return groundAtCell(hab, habitatCell(x, z));
}

/** groundAt() for a habitat cell index (-1 off the grid). @param {import('./habitat.js').Habitat} hab @param {number} k */
function groundAtCell(hab, k) {
  if (k < 0 || !hab.open[k]) return null;
  // Water can only move where there is water: ground with none standing on it counts as still, so a
  // plant refused there hears that it is too dry, not that the water moves too much.
  const still = !hab.sea[k] && hab.depthCm[k] === 0 ? 1 : hab.still[k];
  // The ground-type, slope and height axes (docs/future/10); undefined where the habitat has none.
  // Soil is earth, bare or turfed: the painted soil and grass shares together, since grass is
  // painted over soil (a pond floor is grass paint with a little soil).
  return { moisture: hab.moisture[k] / 255, salt: hab.salt[k] / 255, depth: hab.sea[k] ? 9 : hab.depthCm[k] / 100, still, k,
    sand: hab.sand ? hab.sand[k] / 255 : undefined, rock: hab.rock ? hab.rock[k] / 255 : undefined,
    soil: hab.soil ? Math.min(255, hab.soil[k] + hab.grass[k]) / 255 : undefined, slope: hab.slopeDeg ? hab.slopeDeg[k] : undefined,
    // Height above mean sea level, m.
    shore: hab.heightDm ? hab.heightDm[k] / 10 : undefined,
    // The keeper's camp pad (CP-16, habitat.js padClearMask): no plant takes there; grass stays.
    clear: hab.clear ? hab.clear[k] : 0 };
}

/** @typedef {'dry'|'wet'|'shallow'|'deep'|'fresh'|'salt'|'flow'|'outside'|'ground'|'steep'|'flat'|'low'|'high'|'camp'} Need */

/**
 * The habitat axes a recipe may use, in the order a tie names the need: [recipe key, ground key,
 * need when too low, need when too high]. A recipe leaves out the axes it does not care about, and
 * an axis the habitat does not have (an older test habitat) counts as met. The last five
 * (docs/future/10): the painted shares of sand, rock and soil (0..1; soil counts grass too), slope
 * (degrees) and height above mean sea level (m).
 * @type {[string, 'moisture'|'depth'|'salt'|'still'|'sand'|'rock'|'soil'|'slope'|'shore', Need, Need][]}
 */
const AXES = [
  ['waterDepthM', 'depth', 'shallow', 'deep'],
  ['still', 'still', 'flow', 'flow'],
  ['moisture', 'moisture', 'dry', 'wet'],
  ['salt', 'salt', 'fresh', 'salt'],
  ['sand', 'sand', 'ground', 'ground'],
  ['rock', 'rock', 'ground', 'ground'],
  ['soil', 'soil', 'ground', 'ground'],
  ['slopeDeg', 'slope', 'flat', 'steep'],
  ['shoreM', 'shore', 'low', 'high'],
];

/**
 * How well a species likes a point, 0..1, and which need is furthest from met.
 * @param {any} rec the species recipe @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 * @returns {{ suit: number, worst: Need }}
 */
export function suitability(rec, hab, x, z) {
  return suitabilityOf(rec, groundAt(hab, x, z));
}

/**
 * suitability() for ground already read. @param {any} rec @param {ReturnType<typeof groundAt>} g
 * @returns {{ suit: number, worst: Need }}
 */
function suitabilityOf(rec, g) {
  if (!g) return { suit: 0, worst: 'outside' };
  // The camp ground stays clear (CP-16): nothing seeds, spreads, volunteers or is planted there.
  if (g.clear) return { suit: 0, worst: 'camp' };
  const H = rec.habitat;
  let suit = 1, low = 2;
  /** @type {Need} */ let worst = 'dry';
  for (const [key, at, tooLow, tooHigh] of AXES) {
    const r = H[key];
    if (!r) continue;
    const v = g[at];
    if (v === undefined) continue;
    const b = bell(v, r);
    suit *= b;
    if (b < low) { low = b; worst = v < r[0] ? tooLow : tooHigh; }
  }
  return { suit, worst };
}

/** Season position (0 spring .. 4) inside a [from, to) window, wrapping. @param {number} pos @param {number[]} w */
const inWindow = (pos, w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]);

/**
 * A plant's stage from its age, size and the season. The season windows are read on the plant's own
 * calendar (phenology.js: a few days ahead of or behind its species), so the stored stage, which the
 * shaders, the journal, the almanac and the trails all read, is the jittered one.
 * @param {any} rec @param {Plant} p @param {number} worldPos the world's season position
 */
function stageOf(rec, p, worldPos) {
  const S = rec.growth.stages;
  if (p.age < S.sproutH) return STAGE.seed;
  if (p.size >= S.matureSize) {
    const pos = plantSeasonPos(rec, p.id, worldPos);
    if (rec.dormant && inWindow(pos, rec.dormant)) return STAGE.dormant;
    if (rec.flowering && inWindow(pos, rec.flowering)) return STAGE.flowering;
    return STAGE.mature;
  }
  return p.size >= S.youngSize ? STAGE.young : STAGE.sprout;
}

/** Plants per 1 m cell, for spacing checks. @param {Plant[]} plants */
function cellIndex(plants) {
  /** @type {Map<number, number[]>} */ const m = new Map();
  plants.forEach((p, i) => {
    const k = habitatCell(p.x, p.z);
    if (k < 0) return;
    const a = m.get(k);
    if (a) a.push(i); else m.set(k, [i]);
  });
  return m;
}

/**
 * Is any plant of `sp` closer than `r` (m) to (x, z)? r is at most a couple of meters.
 * @param {Map<number, number[]>} index @param {Plant[]} plants @param {string} sp @param {number} x @param {number} z @param {number} r
 */
function crowded(index, plants, sp, x, z, r) {
  const ci = Math.floor(x - HABITAT_ORIGIN), cj = Math.floor(z - HABITAT_ORIGIN);
  const reach = Math.floor(r) + 1;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS) continue;
      const list = index.get(j * HABITAT_CELLS + i);
      if (!list) continue;
      for (const n of list) {
        const p = plants[n];
        if (p.sp !== sp) continue;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  return false;
}

/** The eight bearings, as unit steps (diagonals pre-normalized). */
const BEARINGS = [[1, 0], [0.7071067811865476, 0.7071067811865476], [0, 1], [-0.7071067811865476, 0.7071067811865476],
  [-1, 0], [-0.7071067811865476, -0.7071067811865476], [0, -1], [0.7071067811865476, -0.7071067811865476]];

/**
 * Grass cover target per cell, 0..255: how well grass likes the ground (none in water, thinning on
 * salt). Painting decides where grass is at once; this cover follows the ground slowly, so a dug
 * pond drowns its grass over a day and a drained one greens again.
 * @param {import('./habitat.js').Habitat} hab @param {any} G recipes/world/growth.json grass @param {number} k
 */
function grassTarget(hab, G, k) {
  if (hab.depthCm[k] > 0 || hab.sea[k]) return 0;
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
function coverTarget(rec, hab, k) {
  return Math.floor(255 * suitabilityOf(rec, groundAtCell(hab, k)).suit);
}

/** The first cover plant other than grass (rushes), as it stands in this growth state. @param {any} g @param {any} env */
function firstCover(g, env) {
  const id = env.recipes.growth.cover?.[0];
  return id ? g.cover?.[id] ?? null : null;
}

/**
 * Grass's target where rushes stand: it gives way by yieldToCover of the rushes' share.
 * @param {number} target @param {number | undefined} rush 0..255 @param {any} G recipes/world/growth.json grass
 */
function yieldTo(target, rush, G) {
  if (!rush || !G.yieldToCover) return target;
  return Math.floor(target * (1 - (G.yieldToCover * rush) / 255));
}

/** The cover plants other than grass that this world grows: [id, recipe]. @param {any} env */
function coverSpecies(env) {
  return (env.recipes.growth.cover ?? []).map((/** @type {string} */ sp) => [sp, env.recipes.covers?.[sp]]).filter((/** @type {any[]} */ e) => e[1]);
}

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
function plantStarters(g, hab, env, pos = 0) {
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
 * Plant a seed by hand (the Plant tool). Returns the new state, or the reason it would not take.
 * @param {any} state @param {string} sp @param {number} x @param {number} z @param {any} env
 * @returns {{ state: any, ok: boolean, id?: number, reason?: Need|'crowded'|'full'|'unknown' }}
 */
export function plantSeed(state, sp, x, z, env) {
  const hab = env.habitat?.();
  const rec = env.recipes.flora?.[sp];
  if (!hab || !rec) return { state, ok: false, reason: 'unknown' };
  const g = state.growth ?? initialGrowth();
  if (g.plants.length >= env.recipes.growth.maxPlants) return { state, ok: false, reason: 'full' };
  const s = suitability(rec, hab, x, z);
  if (s.suit < 0.2) return { state, ok: false, reason: s.worst };
  if (crowded(cellIndex(g.plants), g.plants, sp, x, z, rec.spread?.minSpacingM ?? 0.5)) return { state, ok: false, reason: 'crowded' };
  const p = { id: g.nextId, sp, x, z, age: 0, size: 0, best: 0, stage: STAGE.seed, low: 0, drown: 0, last: 0 };
  return { state: { ...state, growth: { ...g, nextId: g.nextId + 1, plants: [...g.plants, p] } }, ok: true, id: p.id };
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

/**
 * One game hour of growth.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  const hab = env.habitat?.();
  const GR = env.recipes?.growth;
  if (!hab || !GR || !env.recipes.flora) return { state, events: [] };
  const prev = state.growth ?? initialGrowth();
  /** @type {GrowthState} */
  const g = { ...prev, plants: prev.plants.map((p) => ({ ...p })), habitatHash: hab.hash };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  if (!g.starterDone) {
    plantStarters(g, hab, env);
    g.starterDone = true;
  }
  g.since ??= hourIndex;
  g.arrived = { ...arrivedOf(g, env, hourIndex) };
  const pos =(state.seasons?.index ?? 0) + (state.seasons?.phase ?? 0);
  const season = Math.min(3, Math.max(0, state.seasons?.index ?? 0));
  const seed = subSeed(env.seed, 'growth');

  // Grow, age, change stage; drop the dead (counted per species and reason for the journal).
  /** @type {Plant[]} */ const alive = [];
  /** @type {Map<string, number>} */ const lost = new Map();
  const lose = (/** @type {string} */ sp, /** @type {string} */ why) => lost.set(`${sp}|${why}`, (lost.get(`${sp}|${why}`) ?? 0) + 1);
  for (const p of g.plants) {
    const rec = env.recipes.flora[p.sp];
    if (!rec) continue;
    const G = rec.growth;
    const { suit } = suitability(rec, hab, p.x, p.z);
    const ground = groundAt(hab, p.x, p.z);
    p.age += 1;
    if (p.stage === STAGE.seed) {
      // A seed waits for good ground; in poor ground it gives up after a while.
      p.low = suit < 0.3 ? p.low + 1 : 0;
      if (p.low > G.seedDieHours) { lose(p.sp, 'seed'); continue; }
      if (p.age >= G.stages.sproutH && suit >= 0.3) p.size = Math.max(p.size, 0.05);
    } else {
      p.size += G.ratePerH * G.seasonRate[season] * suit * (1 - p.size);
      if (p.size > p.best) p.best = p.size;
      p.low = suit < G.lowSuit ? p.low + 1 : 0;
      if (p.low > G.lowHours) p.size = Math.max(G.floor * p.best, p.size - G.shrinkPerH);
    }
    p.drown = ground && ground.depth > G.drownDepthM ? p.drown + 1 : 0;
    if (p.drown > G.drownHours) { lose(p.sp, 'drown'); continue; }
    if (!ground) { lose(p.sp, 'outside'); continue; }
    p.stage = p.size <= 0 ? STAGE.seed : stageOf(rec, p, pos);
    alive.push(p);
  }
  g.plants = alive;
  for (const [key, count] of lost) {
    const [sp, why] = key.split('|');
    events.push({ name: 'growth:lost', payload: { species: sp, why, count } });
  }

  // Spread: a rhizome creeps along the best of eight bearings; a dropped seed lands on the one
  // bearing it rolled, and takes only if the ground there is good. A species may drop seed only in
  // its season (spread.window, e.g. willow's early summer) and stops at spread.maxCount plants.
  const index = cellIndex(g.plants);
  const born = [];
  /** @type {Map<string, number>} */ const held = new Map();
  for (const p of g.plants) held.set(p.sp, (held.get(p.sp) ?? 0) + 1);
  for (const p of g.plants) {
    const rec = env.recipes.flora[p.sp];
    const R = rec.spread;
    if (!R || (R.kind !== 'rhizome' && R.kind !== 'seed') || p.stage < STAGE.mature || p.stage === STAGE.dormant) continue;
    if (R.window && !inWindow(plantSeasonPos(rec, p.id, pos), R.window)) continue;
    if (R.maxCount && (held.get(p.sp) ?? 0) >= R.maxCount) continue;
    if (hourIndex - p.last < R.everyH) continue;
    if (g.plants.length + born.length >= GR.maxPlants) break;
    p.last = hourIndex;
    if (suitability(rec, hab, p.x, p.z).suit < R.minSuit) continue;
    const r = stream(seed, hourIndex, p.id);
    const dist = R.distanceM[0] + (R.distanceM[1] - R.distanceM[0]) * r.next();
    const turn = r.int(8);
    let best = -1, bx = 0, bz = 0;
    for (let b = 0; b < (R.kind === 'seed' ? 1 : 8); b++) {
      const dir = BEARINGS[(b + turn) % 8];
      const x = p.x + dir[0] * dist, z = p.z + dir[1] * dist;
      const s = suitability(rec, hab, x, z).suit;
      if (s > best) { best = s; bx = x; bz = z; }
    }
    if (best < R.minSuit) continue;
    if (crowded(index, g.plants, p.sp, bx, bz, R.minSpacingM)) continue;
    if (born.some((q) => q.sp === p.sp && (q.x - bx) * (q.x - bx) + (q.z - bz) * (q.z - bz) < R.minSpacingM * R.minSpacingM)) continue;
    born.push({ id: g.nextId++, sp: p.sp, x: bx, z: bz, age: 0, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex });
    held.set(p.sp, (held.get(p.sp) ?? 0) + 1);
  }
  if (born.length) {
    g.plants = [...g.plants, ...born];
    /** @type {Record<string, number>} */ const bySpecies = {};
    for (const q of born) bySpecies[q.sp] = (bySpecies[q.sp] ?? 0) + 1;
    events.push({ name: 'growth:spread', payload: { count: born.length, bySpecies } });
  }

  // Grass cover: toward what the ground supports, a share of the gap each hour (integers). Where
  // rushes stand thick on soaked ground, grass gives way to them.
  const n = hab.n * hab.n;
  const grass = new Uint8Array(n);
  const G2 = GR.grass;
  const rival = firstCover(prev, env);
  for (let k = 0; k < n; k++) {
    const target = yieldTo(grassTarget(hab, G2, k), rival?.[k], G2);
    grass[k] = prev.grass ? approach(prev.grass[k], target, G2.ratePerH) : target;
  }
  g.grass = grass;

  // The other cover plants (rushes): the same rule toward how well each likes the ground, but bare
  // ground is only taken from a stand next to it (creeping), or now and then by a seed that lands
  // within reach of a stand, so a new marsh has to be found by them.
  const covers = coverSpecies(env);
  if (covers.length) {
    /** @type {Record<string, Uint8Array>} */ const cover = {};
    /** @type {Record<string, number>} */ const took = {};
    for (const [sp, rec] of covers) {
      const was = prev.cover?.[sp];
      const c = new Uint8Array(n);
      const SP = rec.spread ?? {};
      const from = Math.round(255 * (SP.fromShare ?? 0));
      let newly = 0;
      for (let k = 0; k < n; k++) {
        const target = coverTarget(rec, hab, k);
        if (!was) { c[k] = target; continue; }
        if (was[k] === 0 && target > 0 && from > 0 && !standNear(was, hab.n, k, from)) continue;
        c[k] = approach(was[k], target, rec.growth.ratePerH);
        if (was[k] === 0 && c[k] > 0) newly++;
      }
      if (was && SP.jumpPerH > 0) newly += seedJump(c, was, rec, hab, from, subSeed(env.seed, `cover-seed-${sp}`), hourIndex);
      cover[sp] = c;
      if (newly) took[sp] = newly;
    }
    g.cover = cover;
    if (Object.keys(took).length) events.push({ name: 'growth:spread', payload: { count: Object.values(took).reduce((a, b) => a + b, 0), bySpecies: took } });
  }

  // A volunteer (volunteers.js): a species not yet on the island lands on a square that suits it,
  // as a fresh sprout (a plant) or a new tussock (a cover plant).
  if (g.plants.length < GR.maxPlants) {
    const held = cellIndex(g.plants);
    const v = volunteerAt(g, hab, env, hourIndex, (rec, k) => suitabilityOf(rec, groundAtCell(hab, k)).suit, (k) => held.has(k));
    if (v) {
      const x = HABITAT_ORIGIN + (v.k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(v.k / hab.n) + 0.5;
      const cov = g.cover?.[v.sp];
      const rec = env.recipes.flora[v.sp];
      if (cov) cov[v.k] = Math.max(cov[v.k], env.recipes.covers[v.sp].spread?.plantStart ?? 60);
      else if (rec) {
        g.plants = [...g.plants, { id: g.nextId++, sp: v.sp, x, z, age: rec.growth.stages.sproutH, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex }];
      }
      g.arrived[v.sp] = hourIndex;
      events.push({ name: 'growth:arrived', payload: { species: v.sp, x, z } });
    }
  }

  return { state: { ...state, growth: g }, events };
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
  for (let k = 0; k < was.length; k++) if (was[k] >= from) stands.push(k);
  if (!stands.length) return 0;
  const n = hab.n;
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
