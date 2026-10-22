// @ts-check
// Visual wetness (docs/08, Wetness: simulation vs. look): a 0.25 m map of how wet the ground looks,
// on the terrain grid over the water rect, rebuilt on the GPU every half real second
// (terrain-wetness.wgsl). Live water, the sea below the tide line, rain and damp hollows wet it;
// capillary spread carries it about 1.5 m into banks; where nothing holds it, it dries over game
// time, faster in sun and wind, slower at night, and not at all while paused. So the flats the tide
// just uncovered stay dark and shiny for a while, then dull. Look only: never saved, never read by
// the simulation, and it follows the live water, which is not deterministic either.
// The map is an rgba8unorm ping-pong pair (r wetness 0..1, g puddle level 0..1, b drying margin
// 0..1) the terrain draw samples filtered. The drying margin (A8, recipe wetness.dryingMargin) is 1
// where fresh water stands and falls to 0 over dryingMarginDays game days once the bed is exposed,
// so a lowering pond leaves a band of drying, cracking mud. It is never set in the tide band, and,
// like the rest of the map, it starts fresh on each load.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';
import { WATER_CELLS } from '../water/grid.js';

const WET_BYTES = 96;
const DEG = Math.PI / 180;
/** Meters one spread step reaches (the shader's SPREAD_R texels of 0.25 m). */
const SPREAD_REACH_M = 0.5;

/** @param {number} a @param {number} b @param {number} x */
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param {GPUDevice} device
 * @param {{ terrain: import('./index.js').Terrain, water: import('../water/index.js').Water, recipe: any,
 *   dampWet: number, getRain: () => number, getSun: () => number, getWind?: () => number,
 *   puddles?: { fillPerHour: number, drainHours: number } }} opts
 *   recipe: terrain.json `wetness`; dampWet: water.json `look.dampHollowWet`; getRain: rain intensity
 *   0..1; getSun: sine of the sun's elevation (the sun direction's y); getWind: wind strength 0..1;
 *   puddles: terrain.json `wetGround.puddles` (the g channel's fill and drain rates)
 */
export async function createWetness(device, opts) {
  const { terrain, water, recipe } = opts;
  const getWind = opts.getWind ?? (() => 0);
  const N = WATER_CELLS * 2;
  const T = GPUTextureUsage;
  const textures = ['a', 'b'].map((k) => makeTexture(device, {
    label: `terrain-wetness-${k}`, size: [N, N], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING,
  }));
  const uniforms = makeBuffer(device, { label: 'terrain-wetness', size: WET_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    label: 'terrain-wetness',
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: C, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
    ],
  });
  const pipeLayout = device.createPipelineLayout({ label: 'terrain-wetness', bindGroupLayouts: [layout] });
  const module = await makeShaderModule(device, 'terrain-wetness');
  const [initPipe, stepPipe] = await Promise.all(['csInit', 'csStep'].map((entryPoint) =>
    device.createComputePipelineAsync({ label: `terrain-wetness-${entryPoint}`, layout: pipeLayout, compute: { module, entryPoint } })));

  // groups[p][d] reads wetness p and water depth d, writes wetness 1 - p.
  const heightView = terrain.gpu.height.createView();
  const dampView = water.sim.damp.createView();
  const wetViews = textures.map((t) => t.createView());
  const depthViews = water.sim.depthTextures.map((/** @type {GPUTexture} */ t) => t.createView());
  const groups = [0, 1].map((p) => depthViews.map((dv) => device.createBindGroup({
    label: `terrain-wetness-${p}`, layout,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: heightView },
      { binding: 2, resource: dv },
      { binding: 3, resource: dampView },
      { binding: 4, resource: wetViews[p] },
      { binding: 5, resource: wetViews[1 - p] },
    ],
  })));

  const data = new ArrayBuffer(WET_BYTES);
  const fv = new Float32Array(data);
  const uv = new Uint32Array(data);
  let cur = 0;          // which texture holds the latest wetness
  let first = true;     // the next update builds from the sources only
  let due = false;
  let clockS = 0;       // real seconds since the last update
  let pendingS = 0;     // game seconds waiting to be dried
  /** @type {number | null} */ let lastWorldT = null;
  let salt = 0;

  return {
    id: 'wetness',

    /** @param {import('../../sim/live-sim.js').FrameInfo} fi */
    tick(fi) {
      // Game time from worldT, so 2x and 4x dry faster and a pause holds everything.
      if (lastWorldT !== null) pendingS += Math.max(0, fi.worldT - lastWorldT);
      lastWorldT = fi.worldT;
      clockS += fi.realDt;
      const interval = fi.tier === 'low' ? recipe.lowTierIntervalS : recipe.intervalS;
      if (first || clockS >= interval) due = true;
    },

    /** @param {GPUCommandEncoder} encoder */
    encode(encoder) {
      if (!due) return;
      due = false;
      clockS = 0;
      const r = water.rect;
      if (r.w < 1 || r.h < 1) return;
      const hours = first ? 0 : pendingS / 3600;
      pendingS = 0;
      const rain = Math.min(1, Math.max(0, opts.getRain()));
      // Drying speed: slow at night, fastest in high sun, more with wind, none while it rains.
      const sun = smoothstep(-0.05, Math.sin(recipe.sunFullDeg * DEG), opts.getSun());
      const sf = recipe.sunFactor;
      const speed = (sf[0] + (sf[1] - sf[0]) * sun) * (1 + recipe.windFactor * Math.min(1, Math.max(0, getWind())))
        * (1 - smoothstep(0, recipe.rainStopsDrying, rain));
      uv[0] = r.x * 2; uv[1] = r.y * 2; uv[2] = r.w * 2; uv[3] = r.h * 2;
      fv[4] = water.tide; fv[5] = recipe.tideBandM;
      fv[6] = recipe.waterDepthM[0]; fv[7] = recipe.waterDepthM[1];
      fv[8] = (hours * speed) / recipe.dryHours;
      fv[9] = hours * rain * recipe.rainSoakPerHour;
      fv[10] = 1 / recipe.bankSpreadM; fv[11] = recipe.bankRiseWeight;
      fv[12] = opts.dampWet; fv[13] = rain > recipe.rainStopsDrying ? 1 : 0;
      uv[14] = salt = (salt + 1) >>> 0;
      // Puddles (G3, terrain.json wetGround): fill with sustained rain, drain as the ground dries.
      const pg = opts.puddles;
      fv[15] = pg ? hours * rain * pg.fillPerHour : 0;
      fv[16] = pg ? (hours * speed) / pg.drainHours : 1;
      // The drying margin (A8): bed that fresh water left loses its memory over game days.
      const dm = recipe.dryingMargin;
      fv[17] = dm ? hours / (24 * dm.dryingMarginDays) : 1;
      fv[18] = dm ? dm.bedDepthM[0] : 1; fv[19] = dm ? dm.bedDepthM[1] : 2;
      fv[20] = dm ? dm.freshAboveTideM[0] : 0.2; fv[21] = dm ? dm.freshAboveTideM[1] : 0.45;
      device.queue.writeBuffer(uniforms, 0, data);

      const d = water.sim.current;
      const gx = Math.ceil((r.w * 2) / 8);
      const gy = Math.ceil((r.h * 2) / 8);
      const pass = encoder.beginComputePass({ label: 'terrain-wetness' });
      // The first build runs the sources, then enough spread steps (with no drying) to reach the
      // full bank width, so the first picture already has soaked banks.
      const steps = first ? 1 + Math.ceil(recipe.bankSpreadM / SPREAD_REACH_M) : 1;
      for (let k = 0; k < steps; k++) {
        pass.setPipeline(first && k === 0 ? initPipe : stepPipe);
        pass.setBindGroup(0, groups[cur][d]);
        pass.dispatchWorkgroups(gx, gy);
        cur = 1 - cur;
      }
      pass.end();
      first = false;
    },

    dispose() {
      for (const t of textures) t.destroy();
      uniforms.destroy();
    },

    /** The wetness ping-pong pair (rgba8unorm, 0.25 m on the terrain grid; r wetness, g puddle level, b drying margin, all 0..1). */
    textures,
    /** Index into `textures` of the latest wetness. */
    current: () => cur,
  };
}

/** @typedef {Awaited<ReturnType<typeof createWetness>>} Wetness */
