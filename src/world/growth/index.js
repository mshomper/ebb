// @ts-check
// Live side of growth (docs 10, 11): keeps the habitat grid current (rebuilt from the water summary
// and the painted ground whenever the summary changes) and hands it to the hourly tick through
// env.habitat; after each game hour it uploads what the drawing needs: one instance per plant and
// the grass cover map. The growth itself runs in the tick (coarse.js), never here.

import { makeBuffer, makeTexture } from '../../core/gpu.js';
import { on } from '../../core/events.js';
import { get as getStore, subscribe as subscribeStore } from '../../core/store.js';
import { hash32 } from '../../core/rng.js';
import { WORLD_CELLS } from '../terrain/grid.js';
import { buildHabitat, HABITAT_CELLS } from './habitat.js';
import { suitability, plantSeed, plantCover, settleGrowth } from './coarse.js';
import { lushField } from './lush.js';
import { plantHash } from './phenology.js';
import { pickShares, plantLooks } from './looks.js';

/**
 * Floats per plant instance: x, z, size, stage, species index, hash 0..1, age (h), ground height (m),
 * then the looks (looks.js): picked, thin, drowned (0..1) and a spare.
 */
export const PLANT_FLOATS = 12;

/**
 * @param {GPUDevice} device
 * @param {{ terrain: import('../terrain/index.js').Terrain, water: import('../water/index.js').Water,
 *   world: { state: any, env: any }, recipes: { growth: any, flora: Record<string, any>, covers?: Record<string, any>, land?: any, grass?: any } }} opts
 *   world: the live world (state and env of the hourly tick); env.habitat is set here.
 *   recipes.covers: the cover plants other than grass (growth.json `cover`); recipes.land: the
 *   island's land recipe (its basins may carry starter plants); recipes.grass: flora/grass.json (its
 *   `lush` block shapes the wet-to-dry look field, lush.js)
 */
export function createGrowth(device, opts) {
  const { terrain, water, world, recipes } = opts;
  const cap = recipes.growth.maxPlants;
  const instances = makeBuffer(device, { label: 'flora-instances', size: cap * PLANT_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // Cover per square meter: r grass, g rushes (the first of growth.json `cover`), b how lush the
  // grass looks (lush.js: wet by the water, dry on the rise; look only).
  const coverTex = makeTexture(device, {
    label: 'plant-cover', size: [HABITAT_CELLS, HABITAT_CELLS], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const coverData = new Uint8Array(HABITAT_CELLS * HABITAT_CELLS * 4);
  for (let k = 0; k < HABITAT_CELLS * HABITAT_CELLS; k++) { coverData[4 * k] = 255; coverData[4 * k + 2] = 90; }
  const writeCover = () => device.queue.writeTexture({ texture: coverTex }, coverData, { bytesPerRow: HABITAT_CELLS * 4 }, [HABITAT_CELLS, HABITAT_CELLS]);
  writeCover();
  /** The lush field (lush.js), rebuilt with the habitat. @type {Uint8Array | null} */ let lush = null;
  const coverIds = /** @type {string[]} */ (recipes.growth.cover ?? []);
  const data = new Float32Array(cap * PLANT_FLOATS);
  const speciesIndex = (/** @type {string} */ sp) => recipes.flora[sp]?.index ?? 0;
  const kinds = 1 + Math.max(0, ...Object.values(recipes.flora).map((r) => r.index ?? 0));
  /** Per species index: [first instance, instances], so each species draws only its own plants. */
  const ranges = Array.from({ length: kinds }, () => [0, 0]);

  /** @type {import('./habitat.js').Habitat | null} */ let habitat = null;
  let count = 0;
  /** @type {any} */ let shown = null;   // the growth state last uploaded
  world.env.habitat = () => habitat;
  world.env.recipes.growth = recipes.growth;
  world.env.recipes.flora = recipes.flora;
  world.env.recipes.covers = recipes.covers ?? {};
  world.env.recipes.land = recipes.land ?? null;

  /**
   * The camp pad as the habitat takes it (CP-16): center and radius from the store slice `campPad`,
   * or null on an older island before its pad is stamped. Plain numbers, so catch-up gets the same.
   */
  const padNow = () => {
    const p = getStore('campPad');
    return p ? { x: p.x, z: p.z, r: p.r } : null;
  };

  /** Rebuild the habitat from the latest water summary and the painted ground. */
  function rebuildHabitat() {
    const s = water.getSummary();
    const live = getStore('terrainLive');
    const mirror = live?.mirror;
    if (!s || !mirror) return;
    // baseQ: the island as generated, so the habitat knows which ground the player shaped (dragonflies).
    // pad: the camp ground, where no plant takes (CP-16).
    habitat = buildHabitat({ eco: s.eco, material: mirror.material, materialCells: WORLD_CELLS, params: recipes.growth.habitat,
      heightQ: mirror.heightQ, baseQ: live.baseQ ?? null, pad: padNow() });
    lush = recipes.grass?.lush ? lushField(habitat, recipes.grass.lush) : null;
    // A new island gets its starter plants and grass cover now rather than at the next hour.
    world.state = settleGrowth(world.state, world.env);
    shown = null;   // the lush field changed: upload the cover again
  }
  const unSummary = on('water:summary-updated', rebuildHabitat);
  // The pad is stamped on an older island (or moved) while playing: the habitat follows at once.
  let padKey = JSON.stringify(padNow());
  const unPad = subscribeStore('campPad', () => {
    const key = JSON.stringify(padNow());
    if (key !== padKey) { padKey = key; rebuildHabitat(); }
  });
  rebuildHabitat();
  // What the habitat is built from, so catch-up can follow the season day by day (A9; habitat-days.js).
  world.env.habitatInputs = () => {
    const live = getStore('terrainLive');
    const summary = water.summaryInputs?.();
    if (!summary || !live?.mirror) return null;
    return { summary, habitat: { material: live.mirror.material, materialCells: WORLD_CELLS, params: recipes.growth.habitat,
      heightQ: live.mirror.heightQ, baseQ: live.baseQ ?? null, pad: padNow() } };
  };

  /**
   * The reveal's time-lapse (S7c): every plant, of whatever species, and the drawn cover grow from
   * the island before catch-up to the island now, each starting a little apart (by its hash) so
   * growth ripples rather than snaps. Plants gone while away shrink out.
   * @type {null | { t: number, dur: number, spread: number, size: Map<number, number>, gone: any[], grass: Uint8Array | null, rush: Uint8Array | null }}
   */
  let lapse = null;
  /** How far along one thing is (0..1), starting `spread` of the way apart by hash. @param {number} h 0..1 */
  const along = (h) => {
    if (!lapse) return 1;
    const start = h * lapse.spread, f = Math.min(1, Math.max(0, (lapse.t / lapse.dur - start) / Math.max(1e-6, 1 - lapse.spread)));
    return f * f * (3 - 2 * f);
  };
  const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => a + (b - a) * k;

  /** Upload the plants and the grass cover if the growth state changed (each frame of a time-lapse). */
  function upload() {
    const g = world.state?.growth;
    if (!g || (g === shown && !lapse)) return;
    shown = g;
    // During a time-lapse the plants gone while away are drawn too, shrinking out.
    const all = lapse ? [...g.plants, ...lapse.gone] : g.plants;
    count = Math.min(all.length, cap);
    // Grouped by species (in plant order within each), one range per species.
    const order = all.slice(0, count).map((p, i) => ({ s: speciesIndex(p.sp), i }));
    order.sort((a, b) => a.s - b.s || a.i - b.i);
    for (const r of ranges) { r[0] = 0; r[1] = 0; }
    for (let n = order.length - 1; n >= 0; n--) { const r = ranges[order[n].s]; r[0] = n; r[1]++; }
    const takes = pickShares(world.env.recipes.gather);
    for (let i = 0; i < count; i++) {
      const p = all[order[i].i];
      const o = i * PLANT_FLOATS;
      // The plant's draw hash; also its phenology offset (phenology.js), which the shrub shader reads.
      const h = plantHash(p.id);
      const size = lapse ? lerp(lapse.size.get(p.id) ?? 0, p.gone ? 0 : p.size, along(h)) : p.size;
      data[o] = p.x; data[o + 1] = p.z; data[o + 2] = size; data[o + 3] = p.stage;
      data[o + 4] = speciesIndex(p.sp); data[o + 5] = h;
      data[o + 6] = p.age; data[o + 7] = terrain.sampleHeight(p.x, p.z);
      const lk = plantLooks(p, recipes.flora[p.sp], recipes.growth.looks, takes.get(p.sp));
      data[o + 8] = lk[0]; data[o + 9] = lk[1]; data[o + 10] = lk[2]; data[o + 11] = 0;
    }
    if (count) device.queue.writeBuffer(instances, 0, data, 0, count * PLANT_FLOATS);
    if (g.grass) {
      const rush = coverIds.length ? g.cover?.[coverIds[0]] : null;
      for (let k = 0; k < g.grass.length; k++) {
        const c = lapse ? along(hash32(k, 0xc0e7) / 4294967296) : 1;
        coverData[4 * k] = lapse?.grass ? lerp(lapse.grass[k], g.grass[k], c) : g.grass[k];
        coverData[4 * k + 1] = rush ? (lapse?.rush ? lerp(lapse.rush[k], rush[k], c) : rush[k]) : 0;
        coverData[4 * k + 2] = lush ? lush[k] : 90;
      }
      writeCover();
    }
  }

  return {
    id: 'growth',
    /** Plant instances for drawing (storage buffer, PLANT_FLOATS floats each). */
    instances,
    /** Plants in `instances`. */
    count: () => count,
    /** The instances of one species (its recipe index): [first, count]. @param {number} index */
    range: (index) => ranges[index] ?? [0, 0],
    /** Cover 0..1 on the 1 m world grid (rgba8unorm, 192 x 192 from -80 m): r grass, g rushes, b lush (look). */
    coverTex,
    /** The lush field (lush.js), 0..255 a square, or null before the first habitat. */
    lush: () => lush,
    /** The current habitat grid, or null before the first water summary. */
    habitat: () => habitat,

    /** @param {{ realDt: number }} [f] */
    tick(f) {
      if (lapse) {
        lapse.t += f?.realDt ?? 0;
        if (lapse.t >= lapse.dur) { lapse = null; shown = null; }
      }
      upload();
    },

    /**
     * Grow the drawing from an earlier growth state to the one now over `seconds` (the reveal).
     * The world's state is untouched: this is drawing only.
     * @param {any} before the growth state before catch-up @param {number} seconds
     * @param {number} spread share of the time by which plants start apart
     */
    timeLapse(before, seconds, spread) {
      if (!before || !(seconds > 0)) return;
      const now = new Set((world.state?.growth?.plants ?? []).map((/** @type {any} */ p) => p.id));
      lapse = {
        t: 0, dur: seconds, spread: Math.min(0.9, Math.max(0, spread)),
        size: new Map((before.plants ?? []).map((/** @type {any} */ p) => [p.id, p.size])),
        gone: (before.plants ?? []).filter((/** @type {any} */ p) => !now.has(p.id)).map((/** @type {any} */ p) => ({ ...p, gone: true })),
        grass: before.grass ?? null, rush: coverIds.length ? before.cover?.[coverIds[0]] ?? null : null,
      };
      shown = null;
    },
    /** Land the time-lapse at its end now (any input ends the reveal). */
    endTimeLapse() { if (lapse) { lapse = null; shown = null; } },
    /** Is a time-lapse running? */
    lapsing: () => !!lapse,

    /**
     * How well a species likes a point (0..1) and its least-met need, for the Plant tool.
     * @param {string} sp @param {number} x @param {number} z
     */
    suitabilityAt(sp, x, z) {
      const rec = recipes.flora[sp];
      if (!habitat || !rec) return { suit: 0, worst: 'outside' };
      return suitability(rec, habitat, x, z);
    },

    /**
     * Plant a seed at a world point (the Plant tool). Changes the world state, so it is part of what
     * the hourly tick and a later catch-up see.
     * @param {string} sp @param {number} x @param {number} z
     */
    plant(sp, x, z) {
      // A cover plant (rushes) starts a tussock in its cover; the others plant a seed.
      const r = world.env.recipes.covers?.[sp] ? plantCover(world.state, sp, x, z, world.env) : plantSeed(world.state, sp, x, z, world.env);
      if (r.ok) world.state = r.state;
      return { ok: r.ok, id: 'id' in r ? r.id : undefined, reason: r.reason };
    },

    dispose() {
      unSummary();
      unPad();
      instances.destroy();
      coverTex.destroy();
    },
  };
}

/** @typedef {ReturnType<typeof createGrowth>} Growth */
