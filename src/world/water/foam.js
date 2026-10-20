// @ts-check
// Foam on the live water (docs/07): a coverage field on the water cells, made at little falls,
// where flows meet and where fast shallow water churns, carried by the current and fading over a few seconds
// (water-foam.wgsl). One dispatch per frame after the water simulation, ping-ponging two r32float
// textures. Visual only, real seconds, never saved. Drawn by water-draw.wgsl.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';
import { WATER_CELLS } from './grid.js';

const FOAM_BYTES = 80;

/**
 * @param {GPUDevice} device
 * @param {{ water: import('./index.js').Water, terrain: import('../terrain/index.js').Terrain, recipe: any }} opts
 *   recipe: water.json `foam`
 */
export async function createFoam(device, opts) {
  const { water, recipe } = opts;
  const N = WATER_CELLS;
  const textures = [0, 1].map((i) => makeTexture(device, {
    label: `water-foam-${i}`, size: [N, N], format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  }));
  const uniforms = makeBuffer(device, { label: 'water-foam', size: FOAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = await makeShaderModule(device, 'water-foam');
  const pipeline = await device.createComputePipelineAsync({ label: 'water-foam', layout: 'auto', compute: { module, entryPoint: 'csFoam' } });
  const heightView = opts.terrain.gpu.height.createView();
  const velView = water.sim.vel.createView();
  const depthViews = water.sim.depthTextures.map((t) => t.createView());
  const foamViews = textures.map((t) => t.createView());
  // Group [depth index][foam parity p]: reads foam[p], writes foam[1 - p].
  const groups = depthViews.map((dv) => [0, 1].map((p) => device.createBindGroup({
    label: `water-foam-${p}`, layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: heightView },
      { binding: 2, resource: dv },
      { binding: 3, resource: velView },
      { binding: 4, resource: foamViews[p] },
      { binding: 5, resource: foamViews[1 - p] },
    ],
  })));

  const data = new ArrayBuffer(FOAM_BYTES);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);
  let cur = 0;
  let dt = 0;

  return {
    id: 'foam',
    /** Both foam textures, for draw bind groups picked by `current`. */
    textures,
    get current() { return cur; },

    /** @param {import('../../sim/live-sim.js').FrameInfo} fi */
    tick(fi) { dt = Math.min(fi.realDt, 0.1); },

    /** @param {GPUCommandEncoder} encoder */
    encode(encoder) {
      const r = water.rect;
      if (r.w < 3 || r.h < 3 || dt <= 0) return;
      u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
      f[4] = dt; f[5] = recipe.fadeS;
      f[6] = recipe.fallFromM; f[7] = recipe.fallGain;
      f[8] = recipe.convergenceGain; f[9] = recipe.churnGain;
      f[10] = recipe.churnDepthM; f[11] = recipe.churnSpeed[0];
      f[12] = 0.001; f[13] = recipe.maxCover; f[14] = recipe.churnSpeed[1]; f[15] = recipe.fadeStillS;
      f[16] = recipe.spreadPerS; f[17] = recipe.stillBelowMs;
      f[18] = recipe.plungeGain ?? 0; f[19] = recipe.plungeFromM ?? 0.5;
      device.queue.writeBuffer(uniforms, 0, data);
      const pass = encoder.beginComputePass({ label: 'water-foam' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, groups[water.sim.current][cur]);
      pass.dispatchWorkgroups(Math.ceil(r.w / 8), Math.ceil(r.h / 8));
      pass.end();
      cur = 1 - cur;
    },

    dispose() {
      for (const t of textures) t.destroy();
      uniforms.destroy();
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof createFoam>>} WaterFoam */
