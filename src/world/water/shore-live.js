// @ts-check
// The shore's look on the ground (docs/future/10, Z2): the shore zones (shore.js) as an rgba8 cover
// texture at the water cells' 0.5 m, which the terrain reads. r wrack (seaweed on rock), g ripples
// (in the sand) or kelp (on rock), b lichen (black crust on splash rock), a mud (soft wet soil). Rebuilt when the water
// summary is rebuilt and after a paint stroke, so shaping or painting the coast rezones it. Visual
// only and never saved.

import { makeTexture } from '../../core/gpu.js';
import { on, emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { WATER_CELLS } from './grid.js';
import { shoreZones, shoreHeightM } from './shore.js';

/** Cover names by texture channel. Kelp shares g with the ripples: ripples lie on sand, kelp on rock. */
const CHANNELS = /** @type {const} */ ([['wrack'], ['ripples', 'kelp'], ['lichen'], ['mud']]);

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
  const covers = [[0, 0, 0, 0], ...recipe.zones.map((/** @type {any} */ z) =>
    CHANNELS.map((names) => Math.round(255 * Math.min(1, Math.max(0, ...names.map((c) => z.cover?.[c] ?? 0))))))];
  /** How much each zone's cover thins from its bottom to its top (0 none), by zone value. */
  const tapers = [0, ...recipe.zones.map((/** @type {any} */ z) => z.taper ?? 0)];
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
    for (let k = 0; k < zone.length; k++) {
      const z = zone[k];
      if (!z) continue;
      bytes.set(covers[z], k * 4);
      // A tapering zone thins out toward its top, so it has no hard upper edge.
      const taper = tapers[z];
      if (!taper) continue;
      const Z = recipe.zones[z - 1];
      const t = (shoreHeightM(summary.shore[k], summary.shoreRange) - Z.fromA0 * amplitudeM) / ((Z.toA0 - Z.fromA0) * amplitudeM);
      const f = 1 - taper * Math.min(1, Math.max(0, t));
      for (let c = 0; c < 4; c++) bytes[k * 4 + c] = Math.round(bytes[k * 4 + c] * f);
    }
    device.queue.writeTexture({ texture, origin: [rect.x, rect.y] }, bytes, { bytesPerRow: rect.w * 4, rowsPerImage: rect.h }, [rect.w, rect.h]);
    // The journal's Web looks again at what the shore holds (src/world/journal).
    emitDeferred('shore:zoned', {});
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
