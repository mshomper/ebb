// @ts-check
// The shore's look on the ground (docs/future/10, Z2): the shore zones (shore.js) as an rgba8 cover
// texture at the water cells' 0.5 m, which the terrain reads. r wrack (seaweed on rock), g ripples
// (in the sand), b lichen (black crust on splash rock), a mud (soft wet soil). Rebuilt when the water
// summary is rebuilt and after a paint stroke, so shaping or painting the coast rezones it. Visual
// only and never saved.

import { makeTexture } from '../../core/gpu.js';
import { on } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { WATER_CELLS } from './grid.js';
import { shoreZones } from './shore.js';

const CHANNELS = /** @type {const} */ (['wrack', 'ripples', 'lichen', 'mud']);

/**
 * @param {GPUDevice} device
 * @param {{ water: import('./index.js').Water, recipe: any, amplitudeM: number }} opts
 *   recipe: recipes/world/shore.json; amplitudeM: water.json tide.amplitudeM
 */
export function createShoreLive(device, opts) {
  const { water, recipe, amplitudeM } = opts;
  const texture = makeTexture(device, {
    label: 'shore-cover', size: [WATER_CELLS, WATER_CELLS], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  // Each zone's cover as four bytes, by zone value (0 is no zone).
  const covers = [[0, 0, 0, 0], ...recipe.zones.map((/** @type {any} */ z) => CHANNELS.map((c) => Math.round(255 * Math.min(1, Math.max(0, z.cover?.[c] ?? 0)))))];
  /** @type {any} */ let summary = null;
  let dirty = false;
  /** @type {ReturnType<typeof shoreZones> | null} */ let last = null;
  const unStroke = on('terrain:stroke-ended', () => { dirty = true; });

  function rebuild() {
    const material = getStore('terrainLive')?.mirror?.material;
    if (!summary?.shore || !material) return;
    last = shoreZones({ summary, material, recipe, amplitudeM });
    const { rect, zone } = last;
    const bytes = new Uint8Array(rect.w * rect.h * 4);
    for (let k = 0; k < zone.length; k++) if (zone[k]) bytes.set(covers[zone[k]], k * 4);
    device.queue.writeTexture({ texture, origin: [rect.x, rect.y] }, bytes, { bytesPerRow: rect.w * 4, rowsPerImage: rect.h }, [rect.w, rect.h]);
  }

  return {
    id: 'shore',
    texture,
    /** The shore recipe (its `look` block is the terrain pass's). */
    recipe,
    /** The zones last drawn (tools). */
    zones: () => last,
    tick() {
      const s = water.getSummary();
      if (s && s !== summary) { summary = s; dirty = true; }
      if (dirty) { dirty = false; rebuild(); }
    },
    dispose() { unStroke(); texture.destroy(); },
  };
}

/** @typedef {ReturnType<typeof createShoreLive>} ShoreLive */
