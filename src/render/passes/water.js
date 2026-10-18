// @ts-check
// Water pass (docs/04, 07): copies the HDR and depth targets (WebGPU cannot sample a texture
// while it is an attachment), then draws the simulated water grid and the open sea plane with
// reflection, refraction and absorption. Runs after opaque and before the sky; writes depth, so
// the sky never draws over the sea. Reads the water simulation; never changes it.

import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 320;
const DEG = Math.PI / 180;
/** Open sea mesh: rings x segments around the camera (SEA_RINGS, SEA_SEGMENTS in water-draw.wgsl). */
const SEA_RINGS = 28;
const SEA_SEGMENTS = 48;

/**
 * @param {{ water: import('../../world/water/index.js').Water, terrain: import('../../world/terrain/index.js').Terrain,
 *   atmosphere: import('../sky/atmosphere.js').Atmosphere, recipe: any, seaExtent: number, getTime: () => number,
 *   seabed: { y: number, albedo: number[], wetDarkening: number }, detailFadeM?: number }} opts
 *   recipe: recipes/world/water.json; getTime: real seconds for the moving surface; seabed: the land's sea
 *   floor height and wet sand albedo, continued beyond the terrain as open sea floor
 */
export function createWaterPass(opts) {
  const { water, recipe } = opts;
  /** @type {GPURenderPipeline} */ let simPipeline;
  /** @type {GPURenderPipeline} */ let seaPipeline;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUBuffer} */ let drawBuffer;
  /** @type {GPUSampler} */ let clampSampler;
  /** @type {GPUTexture | null} */ let sceneCopy = null;
  /** @type {GPUTexture | null} */ let depthCopy = null;
  /** @type {GPUBindGroup[]} */ let groups = [];
  const data = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);

  // Static part of the uniform: optics, ripple layers and swell from the recipe.
  {
    const L = recipe.look;
    f[6] = L.refraction; f[7] = L.edgeFadeM;
    f.set(L.absorptionSea, 8); f[11] = L.f0;
    f.set(L.absorptionPond, 12); f[15] = L.roughness;
    f.set(L.scatterAlbedo, 16); f[19] = L.seaFadeDepthM;
    L.waves.slice(0, 3).forEach((/** @type {any} */ w, /** @type {number} */ i) => {
      f[20 + i * 4] = Math.cos(w.dirDeg * DEG); f[21 + i * 4] = Math.sin(w.dirDeg * DEG);
      f[22 + i * 4] = 1 / w.wavelengthM; f[23 + i * 4] = w.strength;
      f[32 + i] = w.speed;
    });
    f[35] = L.flowNormalScale;
    L.sea.slice(0, 4).forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      f[36 + i * 4] = Math.cos(s.dirDeg * DEG); f[37 + i * 4] = Math.sin(s.dirDeg * DEG);
      f[38 + i * 4] = (2 * Math.PI) / s.wavelengthM; f[39 + i * 4] = s.amplitudeM;
    });
    f[52] = opts.seaExtent; f[53] = recipe.sim.dryDepthM;
    f[54] = opts.seabed.y; f[55] = L.openSeaFloorSlope;
    f.set(opts.seabed.albedo, 56); f[59] = opts.seabed.wetDarkening;
    f[60] = L.coherentDepthM[0]; f[61] = L.coherentDepthM[1];
    // ?waterdbg=1..4 shows one shading term at a time (water-draw.wgsl, debugView).
    f[64] = Number(new URLSearchParams(location.search).get('waterdbg') ?? 0) || 0;
    f[65] = opts.detailFadeM ?? 120;
    const R = L.riffle;
    f[68] = R.speed[0]; f[69] = R.speed[1]; f[70] = R.depthM; f[71] = R.coverage;
    f[72] = R.streakM; f[73] = R.albedo;
    f.set(L.scatterAlbedoPond, 76);
  }

  /** @param {PassContext} ctx */
  function makeGroups(ctx) {
    if (!sceneCopy || !depthCopy) return;
    const sim = water.sim;
    groups = [0, 1].map((p) => ctx.device.createBindGroup({
      label: `water-draw-${p}`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: drawBuffer } },
        { binding: 1, resource: opts.terrain.gpu.height.createView() },
        { binding: 2, resource: sim.depthTextures[p].createView() },
        { binding: 3, resource: sim.vel.createView() },
        { binding: 4, resource: /** @type {GPUTexture} */ (sceneCopy).createView() },
        { binding: 5, resource: /** @type {GPUTexture} */ (depthCopy).createView() },
        { binding: 6, resource: clampSampler },
        { binding: 7, resource: opts.atmosphere.skyView.createView() },
        { binding: 8, resource: opts.atmosphere.skySampler },
        { binding: 9, resource: { buffer: opts.atmosphere.uniforms } },
        { binding: 10, resource: { buffer: opts.atmosphere.state } },
      ],
    }));
  }

  return {
    name: 'water',

    /** Apply a quality tier's ripple distance (the startup probe may step down). @param {number} m */
    setDetailFade(m) { f[65] = m; },
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const F = GPUShaderStage.FRAGMENT;
      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      layout = device.createBindGroupLayout({
        label: 'group2-water',
        entries: [
          { binding: 0, visibility: VF, buffer: {} },
          { binding: 1, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
          { binding: 3, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
          { binding: 4, visibility: F, texture: { sampleType: 'float' } },
          { binding: 5, visibility: F, texture: { sampleType: 'depth' } },
          { binding: 6, visibility: F, sampler: { type: 'filtering' } },
          { binding: 7, visibility: F, texture: { sampleType: 'float' } },
          { binding: 8, visibility: F, sampler: { type: 'filtering' } },
          { binding: 9, visibility: F, buffer: {} },
          { binding: 10, visibility: F, buffer: { type: 'read-only-storage' } },
        ],
      });
      const module = await makeShaderModule(device, 'water-draw');
      const pipeLayout = device.createPipelineLayout({ label: 'water', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      /** @param {string} vs */
      const make = (vs) => device.createRenderPipelineAsync({
        label: `water-${vs}`,
        layout: pipeLayout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: 'fsWater', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      [simPipeline, seaPipeline] = await Promise.all([make('vsSim'), make('vsSea')]);
      drawBuffer = makeBuffer(device, { label: 'water-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      clampSampler = device.createSampler({ label: 'water-clamp', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      sceneCopy?.destroy();
      depthCopy?.destroy();
      untrack('water-scene-copy');
      untrack('water-depth-copy');
      const size = ctx.size;
      sceneCopy = makeTexture(ctx.device, { label: 'water-scene-copy', size, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      depthCopy = makeTexture(ctx.device, { label: 'water-depth-copy', size, format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      makeGroups(ctx);
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!sceneCopy || !depthCopy || groups.length === 0) return;
      const r = water.rect;
      u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
      f[4] = water.tide; f[5] = opts.getTime() % 3600;
      ctx.device.queue.writeBuffer(drawBuffer, 0, data);

      const size = [ctx.size[0], ctx.size[1]];
      encoder.copyTextureToTexture({ texture: ctx.targets.hdr }, { texture: sceneCopy }, size);
      encoder.copyTextureToTexture({ texture: ctx.targets.depth }, { texture: depthCopy }, size);

      const pass = encoder.beginRenderPass({
        label: 'water',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('water'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, groups[water.sim.current]);
      if (r.w > 3 && r.h > 3) {
        pass.setPipeline(simPipeline);
        pass.draw((r.w - 3) * (r.h - 3) * 6);
      }
      pass.setPipeline(seaPipeline);
      pass.draw(SEA_RINGS * SEA_SEGMENTS * 6);
      pass.end();
    },
  };
}
