// @ts-check
// Opaque pass for M1: the heightfield terrain (one LOD'd grid mesh per open chunk) and the sea
// plane, into the HDR target (docs/04, 08). Reads the terrain's GPU textures; never changes them.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { CHUNK_CELLS, CHUNK_SIZE, CHUNK_MIN } from '../../world/terrain/grid.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 160;
const MAX_CHUNKS = 36;
const LODS = [128, 64, 32];
const DEG = Math.PI / 180;

/**
 * Index buffer for one chunk grid of n quads a side, plus skirts on all four edges.
 * Vertex ids follow vsLand: grid vertices first (row-major), then four edges of skirt vertices.
 * @param {number} n
 */
function buildIndices(n) {
  const row = n + 1;
  const grid = (/** @type {number} */ i, /** @type {number} */ j) => j * row + i;
  const edgeVertex = [
    (/** @type {number} */ t) => grid(t, 0),
    (/** @type {number} */ t) => grid(n, t),
    (/** @type {number} */ t) => grid(t, n),
    (/** @type {number} */ t) => grid(0, t),
  ];
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = grid(i, j), b = grid(i + 1, j), c = grid(i, j + 1), d = grid(i + 1, j + 1);
      out.push(a, c, b, b, c, d);
    }
  }
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < n; t++) {
      const a = edgeVertex[e](t), b = edgeVertex[e](t + 1);
      const sa = row * row + e * row + t, sb = sa + 1;
      out.push(a, sa, b, b, sa, sb);
    }
  }
  return new Uint16Array(out);
}

/**
 * @param {{ terrain: import('../../world/terrain/index.js').Terrain, recipe: any, seed: number,
 *   getEye: () => ArrayLike<number>, tier: string }} opts
 */
export function createTerrainPass(opts) {
  const { terrain, recipe } = opts;
  /** @type {GPURenderPipeline} */ let landPipeline;
  /** @type {GPURenderPipeline} */ let seaPipeline;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBuffer} */ let drawBuffer;
  /** @type {GPUBuffer} */ let chunkBuffer;
  /** @type {{ buffer: GPUBuffer, count: number }[]} */ const indexBuffers = [];
  const draw = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(draw);
  const u = new Uint32Array(draw);
  const chunkData = new Float32Array(MAX_CHUNKS * 4);
  const maxQuads = opts.tier === 'low' ? recipe.render.lowTierMaxQuads : LODS[0];

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
        ],
      });
      const layout = device.createPipelineLayout({ label: 'opaque', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout2] });
      /** @param {string} vs @param {string} fs */
      const make = (vs, fs) => device.createRenderPipelineAsync({
        label: `opaque-${vs}`,
        layout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      [landPipeline, seaPipeline] = await Promise.all([make('vsLand', 'fsLand'), make('vsSea', 'fsSea')]);

      drawBuffer = makeBuffer(device, { label: 'terrain-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      chunkBuffer = makeBuffer(device, { label: 'terrain-chunks', size: MAX_CHUNKS * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      for (const n of LODS) {
        const idx = buildIndices(n);
        // 6n^2 + 24n indices is always even, so the byte length is a multiple of 4 as writeBuffer needs.
        const buffer = makeBuffer(device, { label: `terrain-index-${n}`, size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, idx);
        indexBuffers.push({ buffer, count: idx.length });
      }
      const sampler = device.createSampler({ label: 'terrain-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      group = device.createBindGroup({
        label: 'terrain-draw',
        layout: layout2,
        entries: [
          { binding: 0, resource: { buffer: drawBuffer } },
          { binding: 1, resource: { buffer: chunkBuffer } },
          { binding: 2, resource: terrain.gpu.height.createView() },
          { binding: 3, resource: terrain.gpu.material.createView() },
          { binding: 4, resource: sampler },
        ],
      });
      packStatic();
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const { device } = ctx;
      const ring = terrain.ring;
      f[24] = ring.x; f[25] = ring.z; f[26] = ring.radius; f[27] = ring.hardness; f[28] = ring.visible ? 1 : 0;
      device.queue.writeBuffer(drawBuffer, 0, draw);

      // Pick a LOD per open chunk by distance from the eye, grouped so each LOD is one draw.
      const eye = opts.getEye();
      /** @type {number[][]} */ const byLod = [[], [], []];
      for (let cz = CHUNK_MIN; cz < CHUNK_MIN + 6; cz++) {
        for (let cx = CHUNK_MIN; cx < CHUNK_MIN + 6; cx++) {
          if (terrain.chunkState(cx, cz) !== 'open') continue;
          const d = Math.hypot(eye[0] - cx * CHUNK_SIZE, eye[1] - 2, eye[2] - cz * CHUNK_SIZE) - CHUNK_SIZE * 0.5;
          let lod = d < recipe.render.lodDistances[0] ? 0 : d < recipe.render.lodDistances[1] ? 1 : 2;
          while (LODS[lod] > maxQuads && lod < 2) lod++;
          byLod[lod].push(cx, cz);
        }
      }
      let k = 0;
      /** @type {{ lod: number, first: number, count: number }[]} */ const draws = [];
      byLod.forEach((list, lod) => {
        const first = k;
        for (let i = 0; i < list.length; i += 2) {
          chunkData[k * 4] = (list[i] - CHUNK_MIN) * CHUNK_CELLS;
          chunkData[k * 4 + 1] = (list[i + 1] - CHUNK_MIN) * CHUNK_CELLS;
          chunkData[k * 4 + 2] = CHUNK_CELLS / LODS[lod];
          chunkData[k * 4 + 3] = LODS[lod];
          k++;
        }
        if (k > first) draws.push({ lod, first, count: k - first });
      });
      device.queue.writeBuffer(chunkBuffer, 0, chunkData, 0, Math.max(4, k * 4));

      const pass = encoder.beginRenderPass({
        label: 'opaque',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
        timestampWrites: ctx.timestampWrites('opaque'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(landPipeline);
      for (const d of draws) {
        const ib = indexBuffers[d.lod];
        pass.setIndexBuffer(ib.buffer, 'uint16');
        pass.drawIndexed(ib.count, d.count, 0, 0, d.first);
      }
      pass.setPipeline(seaPipeline);
      pass.draw(6);
      pass.end();
    },
  };
}
