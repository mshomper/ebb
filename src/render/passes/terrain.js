// @ts-check
// Opaque pass for M1: the heightfield terrain (one LOD'd grid mesh per open chunk) into the HDR
// target (docs/04, 08). The sea is the water pass's (passes/water.js). Reads the terrain's GPU
// textures; never changes them.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { CHUNK_SIZE, CHUNK_MIN } from '../../world/terrain/grid.js';
import { LODS, MAX_CHUNKS, createIndexBuffers, packChunks } from '../terrain-mesh.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 160;
const GROUND_BYTES = 176;
const DEG = Math.PI / 180;
/** @type {Record<string, number>} GroundDetail.tiling.x in lib-ground.wgsl */
const TILING_MODES = { grid: 0, hex: 1, two: 2 };

/**
 * @param {{ terrain: import('../../world/terrain/index.js').Terrain, recipe: any, seed: number,
 *   getEye: () => ArrayLike<number>, tier: string, getTide?: () => number, lodDistances?: number[],
 *   water: { depthTextures: GPUTexture[], current: () => number },
 *   ground: { views: { a: GPUTextureView, b: GPUTextureView }, sampler: GPUSampler, version: number, fade: number },
 *   groundTier: any }} opts  ground: src/render/ground-detail.js; groundTier: the tier's `ground` block
 */
export function createTerrainPass(opts) {
  const { terrain, recipe } = opts;
  /** @type {GPURenderPipeline} */ let landPipeline;
  /** @type {GPUBindGroup[]} */ let groups = [];
  /** @type {GPUBuffer} */ let drawBuffer;
  /** @type {GPUBuffer} */ let chunkBuffer;
  /** @type {{ buffer: GPUBuffer, count: number }[]} */ let indexBuffers = [];
  const draw = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(draw);
  const u = new Uint32Array(draw);
  const chunkData = new Float32Array(MAX_CHUNKS * 4);
  const maxQuads = opts.tier === 'low' ? recipe.render.lowTierMaxQuads : LODS[0];
  /** Mesh LOD switch distances (m): the tier's, else the terrain recipe's. @type {number[]} */
  let lodDistances = opts.lodDistances ?? recipe.render.lodDistances;
  /** @type {GPUBuffer} */ let groundBuffer;
  /** @type {() => void} */ let makeGroup = () => {};
  let groundVersion = -1;
  // GroundDetail uniform (lib-ground.wgsl): per-layer params, then the shared settings.
  const gf = new Float32Array(GROUND_BYTES / 4);
  {
    const d = recipe.detail;
    ['grass', 'sand', 'rock', 'soil'].forEach((id, i) => {
      const l = d.layers[id];
      gf.set([l.heightAmplitudeM, l.normalStrength, l.roughness[0], l.roughness[1]], i * 4);
    });
    gf[16] = 0; gf[17] = d.heightInfluence; gf[18] = d.blendDepth; gf[19] = 0;
    gf[20] = d.sunTerminator[0]; gf[21] = d.sunTerminator[1]; gf[22] = d.f0; gf[23] = opts.groundTier.detailFadeMeters;
    gf[24] = opts.groundTier.specular === 'full' ? 2 : opts.groundTier.specular === 'sun' ? 1 : 0;
    // Cliff projection (triplanar) on steep slopes, per tier; cos of the from and full slope angles.
    gf[25] = opts.groundTier.triplanar ? 1 : 0;
    gf[26] = Math.cos(d.steepDeg[0] * DEG); gf[27] = Math.cos(d.steepDeg[1] * DEG);
    // Each material repeats at its own tile size (rock finer than grass and sand).
    ['grass', 'sand', 'rock', 'soil'].forEach((id, i) => { gf[28 + i] = 1 / (d.layers[id].tileMeters ?? d.tileMeters); });
    // Repeat hiding (G2): hex tiling on desktop tiers, the two-scale mix on low. `?tiling=grid|hex|two`
    // forces one for side-by-side checks.
    const forced = new URLSearchParams(location.search).get('tiling');
    const mode = forced ? (TILING_MODES[forced] ?? 1) : opts.groundTier.hexTiling ? 1 : 2;
    gf[32] = mode; gf[33] = d.hex.density; gf[34] = d.hex.sharpness; gf[35] = d.twoScale.size;
    gf[36] = 1 / d.macro.scalesM[0]; gf[37] = 1 / d.macro.scalesM[1]; gf[38] = d.macro.strength; gf[39] = d.macro.hue;
    gf[40] = d.macro.second; gf[41] = 1 / d.twoScale.noiseMeters;
  }

  function packStatic() {
    const m = recipe.materials;
    f.set(m.albedoGrass, 0); f[3] = m.variation;
    f.set(m.albedoSand, 4); f[7] = m.variationScale;
    f.set(m.albedoRock, 8); f[11] = m.blendSharpness;
    f.set(m.albedoSoil, 12); f[15] = m.wetDarkening;
    f.set(recipe.sea.albedo, 16); f[19] = recipe.sea.specular;
    f.set(recipe.ring.color, 20); f[23] = recipe.ring.opacity;
    f[29] = recipe.ring.width;
    f[30] = Math.cos((recipe.steepRockDeg - recipe.steepRockSoftDeg) * DEG);
    f[31] = Math.cos((recipe.steepRockDeg + recipe.steepRockSoftDeg) * DEG);
    f[32] = recipe.beachBand[0]; f[33] = recipe.beachBand[1];
    f[34] = recipe.render.skirtDepth; f[35] = recipe.sea.extent;
    f[36] = recipe.sea.shallowDepth; u[37] = opts.seed >>> 0;
  }

  return {
    name: 'opaque',

    /**
     * Apply a quality tier's distances without rebuilding (the startup probe may step down).
     * @param {{ lodDistances?: number[], ground: { detailFadeMeters: number } }} t
     */
    setTier(t) {
      lodDistances = t.lodDistances ?? recipe.render.lodDistances;
      gf[23] = t.ground.detailFadeMeters;
    },
    reads: [],
    writes: ['hdr', 'depth'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'terrain-draw');
      const layout2 = device.createBindGroupLayout({
        label: 'terrain-draw',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {} },
          { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        ],
      });
      const layout = device.createPipelineLayout({ label: 'opaque', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout2] });
      /** @param {string} vs @param {string} fs */
      const make = (vs, fs) => device.createRenderPipelineAsync({
        label: `opaque-${vs}`,
        layout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      landPipeline = await make('vsLand', 'fsLand');

      drawBuffer = makeBuffer(device, { label: 'terrain-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      chunkBuffer = makeBuffer(device, { label: 'terrain-chunks', size: MAX_CHUNKS * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      indexBuffers = createIndexBuffers(device);

      const sampler = device.createSampler({ label: 'terrain-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      groundBuffer = makeBuffer(device, { label: 'ground-detail', size: GROUND_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // Rebuilt whenever the ground detail arrays are replaced (placeholder, then the loaded set).
      makeGroup = () => {
        // One group per water depth texture (the simulation ping-pongs them each step).
        groups = opts.water.depthTextures.map((/** @type {GPUTexture} */ wt) => device.createBindGroup({
          label: 'terrain-draw',
          layout: layout2,
          entries: [
            { binding: 0, resource: { buffer: drawBuffer } },
            { binding: 1, resource: { buffer: chunkBuffer } },
            { binding: 2, resource: terrain.gpu.height.createView() },
            { binding: 3, resource: terrain.gpu.material.createView() },
            { binding: 4, resource: sampler },
            { binding: 5, resource: opts.ground.views.a },
            { binding: 6, resource: opts.ground.views.b },
            { binding: 7, resource: opts.ground.sampler },
            { binding: 8, resource: { buffer: groundBuffer } },
            { binding: 9, resource: wt.createView() },
          ],
        }));
        groundVersion = opts.ground.version;
      };
      makeGroup();
      packStatic();
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const { device } = ctx;
      const ring = terrain.ring;
      f[24] = ring.x; f[25] = ring.z; f[26] = ring.radius; f[27] = ring.hardness; f[28] = ring.visible ? 1 : 0;
      f[38] = opts.getTide?.() ?? 0;
      device.queue.writeBuffer(drawBuffer, 0, draw);
      if (opts.ground.version !== groundVersion) makeGroup();
      gf[19] = opts.ground.fade;
      device.queue.writeBuffer(groundBuffer, 0, gf);

      // Pick a LOD per open chunk by distance from the eye, grouped so each LOD is one draw.
      const eye = opts.getEye();
      /** @type {number[][]} */ const byLod = [[], [], []];
      for (let cz = CHUNK_MIN; cz < CHUNK_MIN + 6; cz++) {
        for (let cx = CHUNK_MIN; cx < CHUNK_MIN + 6; cx++) {
          if (terrain.chunkState(cx, cz) !== 'open') continue;
          const d = Math.hypot(eye[0] - cx * CHUNK_SIZE, eye[1] - 2, eye[2] - cz * CHUNK_SIZE) - CHUNK_SIZE * 0.5;
          let lod = d < lodDistances[0] ? 0 : d < lodDistances[1] ? 1 : 2;
          while (LODS[lod] > maxQuads && lod < 2) lod++;
          byLod[lod].push(cx, cz);
        }
      }
      const draws = packChunks(chunkData, byLod);
      device.queue.writeBuffer(chunkBuffer, 0, chunkData);


      const pass = encoder.beginRenderPass({
        label: 'opaque',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: ctx.targets.normalId.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 0, 0] },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
        timestampWrites: ctx.timestampWrites('opaque'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, groups[opts.water.current()]);
      pass.setPipeline(landPipeline);
      for (const d of draws) {
        const ib = indexBuffers[d.lod];
        pass.setIndexBuffer(ib.buffer, 'uint16');
        pass.drawIndexed(ib.count, d.count, 0, 0, d.first);
      }
      pass.end();
    },
  };
}
