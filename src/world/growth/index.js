// @ts-check
// Live side of growth (docs 10, 11): keeps the habitat grid current (rebuilt from the water summary
// and the painted ground whenever the summary changes) and hands it to the hourly tick through
// env.habitat; after each game hour it uploads what the drawing needs: one instance per plant and
// the grass cover map. The growth itself runs in the tick (coarse.js), never here.

import { makeBuffer, makeTexture } from '../../core/gpu.js';
import { on } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { hash32 } from '../../core/rng.js';
import { WORLD_CELLS } from '../terrain/grid.js';
import { buildHabitat, HABITAT_CELLS } from './habitat.js';
import { suitability, plantSeed, settleGrowth } from './coarse.js';

/** Floats per plant instance: x, z, size, stage, species index, hash 0..1, age (h), ground height (m). */
export const PLANT_FLOATS = 8;

/**
 * @param {GPUDevice} device
 * @param {{ terrain: import('../terrain/index.js').Terrain, water: import('../water/index.js').Water,
 *   world: { state: any, env: any }, recipes: { growth: any, flora: Record<string, any> } }} opts
 *   world: the live world (state and env of the hourly tick); env.habitat is set here
 */
export function createGrowth(device, opts) {
  const { terrain, water, world, recipes } = opts;
  const cap = recipes.growth.maxPlants;
  const instances = makeBuffer(device, { label: 'flora-instances', size: cap * PLANT_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const coverTex = makeTexture(device, {
    label: 'grass-cover', size: [HABITAT_CELLS, HABITAT_CELLS], format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: coverTex }, new Uint8Array(HABITAT_CELLS * HABITAT_CELLS).fill(255),
    { bytesPerRow: HABITAT_CELLS }, [HABITAT_CELLS, HABITAT_CELLS]);
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

  /** Rebuild the habitat from the latest water summary and the painted ground. */
  function rebuildHabitat() {
    const s = water.getSummary();
    const mirror = getStore('terrainLive')?.mirror;
    if (!s || !mirror) return;
    habitat = buildHabitat({ eco: s.eco, material: mirror.material, materialCells: WORLD_CELLS, params: recipes.growth.habitat });
    // A new island gets its starter plants and grass cover now rather than at the next hour.
    world.state = settleGrowth(world.state, world.env);
  }
  const unSummary = on('water:summary-updated', rebuildHabitat);
  rebuildHabitat();

  /** Upload the plants and the grass cover if the growth state changed. */
  function upload() {
    const g = world.state?.growth;
    if (!g || g === shown) return;
    shown = g;
    count = Math.min(g.plants.length, cap);
    // Grouped by species (in plant order within each), one range per species.
    const order = g.plants.slice(0, count).map((p, i) => ({ s: speciesIndex(p.sp), i }));
    order.sort((a, b) => a.s - b.s || a.i - b.i);
    for (const r of ranges) { r[0] = 0; r[1] = 0; }
    for (let n = order.length - 1; n >= 0; n--) { const r = ranges[order[n].s]; r[0] = n; r[1]++; }
    for (let i = 0; i < count; i++) {
      const p = g.plants[order[i].i];
      const o = i * PLANT_FLOATS;
      data[o] = p.x; data[o + 1] = p.z; data[o + 2] = p.size; data[o + 3] = p.stage;
      data[o + 4] = speciesIndex(p.sp); data[o + 5] = hash32(p.id, 0x51ed) / 4294967296;
      data[o + 6] = p.age; data[o + 7] = terrain.sampleHeight(p.x, p.z);
    }
    if (count) device.queue.writeBuffer(instances, 0, data, 0, count * PLANT_FLOATS);
    if (g.grass) device.queue.writeTexture({ texture: coverTex }, g.grass, { bytesPerRow: HABITAT_CELLS }, [HABITAT_CELLS, HABITAT_CELLS]);
  }

  return {
    id: 'growth',
    /** Plant instances for drawing (storage buffer, PLANT_FLOATS floats each). */
    instances,
    /** Plants in `instances`. */
    count: () => count,
    /** The instances of one species (its recipe index): [first, count]. @param {number} index */
    range: (index) => ranges[index] ?? [0, 0],
    /** Grass cover 0..1 on the 1 m world grid (r8unorm, 192 x 192 from -80 m): how well grass likes the ground. */
    coverTex,
    /** The current habitat grid, or null before the first water summary. */
    habitat: () => habitat,

    tick() { upload(); },

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
      const r = plantSeed(world.state, sp, x, z, world.env);
      if (r.ok) world.state = r.state;
      return { ok: r.ok, id: r.id, reason: r.reason };
    },

    dispose() {
      unSummary();
      instances.destroy();
      coverTex.destroy();
    },
  };
}

/** @typedef {ReturnType<typeof createGrowth>} Growth */
