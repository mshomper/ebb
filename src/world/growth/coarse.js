// @ts-check
// The growth step of the hourly tick (docs 10, 11). Pure and worker-safe: no GPU, DOM, store or
// events; seeded randomness only (core/rng.js stream), and only + - * / and Math.floor/min/max/abs
// on numbers, so a watched hour and an hour simulated while away give the same island.
//
// Each hour every plant asks: is the ground right (moisture, water depth, salt from the habitat
// grid), is it the season to grow, and is it drowning? It grows toward full size by the answer,
// changes stage, and a mature clump of a spreading species sends a rhizome along the best bearing.
// The grass cover per square meter moves toward what the ground supports. A new island gets a few
// starter clumps the first time the habitat is known.
//
// State contract: coarseStep never mutates its input; it returns a shallow copy of `state` with a
// fresh `state.growth`.
//
// env.habitat() returns the current Habitat (world/growth/habitat.js) or null; env.recipes.growth
// is recipes/world/growth.json and env.recipes.flora maps species id to its recipe.

import { stream, subSeed, hash32 } from '../../core/rng.js';
import { HABITAT_CELLS, HABITAT_ORIGIN, habitatCell } from './habitat.js';

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

/** @typedef {{ nextId: number, starterDone: boolean, plants: Plant[], grass: Uint8Array | null, habitatHash: number }} GrowthState */

/** @returns {GrowthState} */
export function initialGrowth() {
  return { nextId: 1, starterDone: false, plants: [], grass: null, habitatHash: 0 };
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
 * sea counts as far too deep), or null off the grid.
 * @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 */
export function groundAt(hab, x, z) {
  const k = habitatCell(x, z);
  if (k < 0) return null;
  return { moisture: hab.moisture[k] / 255, salt: hab.salt[k] / 255, depth: hab.sea[k] ? 9 : hab.depthCm[k] / 100, k };
}

/**
 * How well a species likes a point, 0..1, and which need is furthest from met.
 * @param {any} rec the species recipe @param {import('./habitat.js').Habitat} hab @param {number} x @param {number} z
 * @returns {{ suit: number, worst: 'moisture'|'depth'|'salt'|'outside' }}
 */
export function suitability(rec, hab, x, z) {
  const g = groundAt(hab, x, z);
  if (!g) return { suit: 0, worst: 'outside' };
  const H = rec.habitat;
  const m = bell(g.moisture, H.moisture);
  const d = bell(g.depth, H.waterDepthM);
  const s = bell(g.salt, H.salt);
  const worst = m <= d && m <= s ? 'moisture' : d <= s ? 'depth' : 'salt';
  return { suit: m * d * s, worst };
}

/** Season position (0 spring .. 4) inside a [from, to) window, wrapping. @param {number} pos @param {number[]} w */
const inWindow = (pos, w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]);

/**
 * A plant's stage from its age, size and the season.
 * @param {any} rec @param {Plant} p @param {number} pos season position
 */
function stageOf(rec, p, pos) {
  const S = rec.growth.stages;
  if (p.age < S.sproutH) return STAGE.seed;
  if (p.size >= S.matureSize) {
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
  return Math.floor(255 * (1 - smooth01((s - G.saltFrom) / (G.saltFull - G.saltFrom))));
}

/**
 * Bring a world up to its habitat right away, without waiting for the next hour: the starter
 * plants of a new island and a first grass cover. A no-op once both exist. Pure.
 * @param {any} state @param {any} env
 */
export function settleGrowth(state, env) {
  const hab = env.habitat?.();
  if (!hab || !env.recipes?.growth || !env.recipes.flora) return state;
  const prev = state.growth ?? initialGrowth();
  if (prev.starterDone && prev.grass) return state;
  const g = { ...prev, plants: prev.plants.map((/** @type {Plant} */ p) => ({ ...p })) };
  if (!g.starterDone) { plantStarters(g, hab, env); g.starterDone = true; }
  if (!g.grass) {
    const grass = new Uint8Array(hab.n * hab.n);
    for (let k = 0; k < grass.length; k++) grass[k] = grassTarget(hab, env.recipes.growth.grass, k);
    g.grass = grass;
  }
  return { ...state, growth: g };
}

/**
 * New island: a few mature clumps of each species with a starter, on its most suitable cells.
 * @param {GrowthState} g @param {import('./habitat.js').Habitat} hab @param {any} env
 */
function plantStarters(g, hab, env) {
  const seed = subSeed(env.seed, 'growth-starter');
  for (const sp of env.recipes.growth.species) {
    const rec = env.recipes.flora[sp];
    if (!rec?.starter) continue;
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
      const p = { id: g.nextId++, sp, x, z, age: 48, size: rec.growth.stages.matureSize + 0.1, best: 0, stage: STAGE.mature, low: 0, drown: 0, last: 0 };
      p.best = p.size;
      placed.push(p);
    }
    g.plants.push(...placed);
  }
}

/**
 * Plant a seed by hand (the Plant tool). Returns the new state, or the reason it would not take.
 * @param {any} state @param {string} sp @param {number} x @param {number} z @param {any} env
 * @returns {{ state: any, ok: boolean, reason?: 'moisture'|'depth'|'salt'|'outside'|'crowded'|'full'|'unknown' }}
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
  return { state: { ...state, growth: { ...g, nextId: g.nextId + 1, plants: [...g.plants, p] } }, ok: true };
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
  const pos = (state.seasons?.index ?? 0) + (state.seasons?.phase ?? 0);
  const season = Math.min(3, Math.max(0, state.seasons?.index ?? 0));
  const seed = subSeed(env.seed, 'growth');

  // Grow, age, change stage; drop the dead.
  /** @type {Plant[]} */ const alive = [];
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
      if (p.low > G.seedDieHours) continue;
      if (p.age >= G.stages.sproutH && suit >= 0.3) p.size = Math.max(p.size, 0.05);
    } else {
      p.size += G.ratePerH * G.seasonRate[season] * suit * (1 - p.size);
      if (p.size > p.best) p.best = p.size;
      p.low = suit < G.lowSuit ? p.low + 1 : 0;
      if (p.low > G.lowHours) p.size = Math.max(G.floor * p.best, p.size - G.shrinkPerH);
    }
    p.drown = ground && ground.depth > G.drownDepthM ? p.drown + 1 : 0;
    if (p.drown > G.drownHours || !ground) continue;
    p.stage = p.size <= 0 ? STAGE.seed : stageOf(rec, p, pos);
    alive.push(p);
  }
  g.plants = alive;

  // Rhizomes: mature clumps creep along the best of eight bearings.
  const index = cellIndex(g.plants);
  const born = [];
  for (const p of g.plants) {
    const rec = env.recipes.flora[p.sp];
    const R = rec.spread;
    if (!R || R.kind !== 'rhizome' || p.stage < STAGE.mature || p.stage === STAGE.dormant) continue;
    if (hourIndex - p.last < R.everyH) continue;
    if (g.plants.length + born.length >= GR.maxPlants) break;
    p.last = hourIndex;
    if (suitability(rec, hab, p.x, p.z).suit < R.minSuit) continue;
    const r = stream(seed, hourIndex, p.id);
    const dist = R.distanceM[0] + (R.distanceM[1] - R.distanceM[0]) * r.next();
    const turn = r.int(8);
    let best = -1, bx = 0, bz = 0;
    for (let b = 0; b < 8; b++) {
      const dir = BEARINGS[(b + turn) % 8];
      const x = p.x + dir[0] * dist, z = p.z + dir[1] * dist;
      const s = suitability(rec, hab, x, z).suit;
      if (s > best) { best = s; bx = x; bz = z; }
    }
    if (best < R.minSuit) continue;
    if (crowded(index, g.plants, p.sp, bx, bz, R.minSpacingM)) continue;
    if (born.some((q) => q.sp === p.sp && (q.x - bx) * (q.x - bx) + (q.z - bz) * (q.z - bz) < R.minSpacingM * R.minSpacingM)) continue;
    born.push({ id: g.nextId++, sp: p.sp, x: bx, z: bz, age: 0, size: 0.05, best: 0.05, stage: STAGE.sprout, low: 0, drown: 0, last: hourIndex });
  }
  if (born.length) {
    g.plants = [...g.plants, ...born];
    events.push({ name: 'growth:spread', payload: { count: born.length } });
  }

  // Grass cover: toward what the ground supports, a share of the gap each hour (integers).
  const n = hab.n * hab.n;
  const grass = new Uint8Array(n);
  const G2 = GR.grass;
  for (let k = 0; k < n; k++) {
    const target = grassTarget(hab, G2, k);
    if (!prev.grass) { grass[k] = target; continue; }
    const cur = prev.grass[k];
    const diff = target - cur;
    let step = Math.floor(Math.abs(diff) * G2.ratePerH);
    if (step === 0 && diff !== 0) step = 1;
    grass[k] = diff > 0 ? cur + step : diff < 0 ? cur - step : cur;
  }
  g.grass = grass;

  return { state: { ...state, growth: g }, events };
}
