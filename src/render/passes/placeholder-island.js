// @ts-check
// Opaque pass for M0: the placeholder island and the sea plane into the HDR target.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { loadRecipe } from '../../core/recipes.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const ISLAND_BYTES = 96;

/** @param {{ seed: number }} opts */
export function createPlaceholderIslandPass(opts) {
  /** @type {GPURenderPipeline} */ let landPipeline;
  /** @type {GPURenderPipeline} */ let seaPipeline;
  /** @type {GPUBindGroup} */ let islandGroup;
  /** @type {any} */ let recipe;

  return {
    name: 'opaque',
    reads: [],
    writes: ['hdr', 'depth'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      recipe = await loadRecipe('world/placeholder-island');
      const module = await makeShaderModule(device, 'placeholder-island');
      const islandLayout = device.createBindGroupLayout({
        label: 'island',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
      });
      const layout = device.createPipelineLayout({
        label: 'opaque',
        bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, islandLayout],
      });
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

      const buf = makeBuffer(device, {
        label: 'island-uniforms', size: ISLAND_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const data = new ArrayBuffer(ISLAND_BYTES);
      const f = new Float32Array(data);
      const u = new Uint32Array(data);
      f.set([recipe.radius, recipe.coastNoise, recipe.coastNoiseScale, recipe.plateauHeight,
        recipe.beachWidth, recipe.seabedDepth, recipe.gridSize, recipe.gridExtent,
        recipe.seaExtent, recipe.seaSpecular], 0);
      u[10] = opts.seed >>> 0;
      f.set(recipe.albedoSand, 12);
      f.set(recipe.albedoGrass, 16);
      f.set(recipe.albedoSea, 20);
      device.queue.writeBuffer(buf, 0, data);
      islandGroup = device.createBindGroup({ layout: islandLayout, entries: [{ binding: 0, resource: { buffer: buf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const pass = encoder.beginRenderPass({
        label: 'opaque',
        colorAttachments: [{
          view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
        }],
        depthStencilAttachment: {
          view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0,
        },
        timestampWrites: ctx.timestampWrites('opaque'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, islandGroup);
      pass.setPipeline(landPipeline);
      pass.draw(recipe.gridSize * recipe.gridSize * 6);
      pass.setPipeline(seaPipeline);
      pass.draw(6);
      pass.end();
    },
  };
}

/**
 * CPU estimate of ground height for camera clearance (a coarse stand-in for the heightfield).
 * @param {any} recipe
 * @returns {(x: number, z: number) => number}
 */
export function placeholderGroundProbe(recipe) {
  return (x, z) => (Math.hypot(x, z) < recipe.radius + recipe.coastNoise ? recipe.plateauHeight : 0);
}
