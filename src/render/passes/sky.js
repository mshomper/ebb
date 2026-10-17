// @ts-check
// Physical sky pass (docs/06): fills every pixel the opaque passes left at the far plane with the
// sky-view LUT, sun disk, moon impostor and starfield. Reads group 0 (frame) and group 1 (shared
// lighting: transmittance LUT, sampler), plus its own group 2 (sky-view LUT and sky uniforms).
// The atmosphere's update() must be recorded earlier in the same frame.

import { makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

/**
 * @param {import('../sky/atmosphere.js').Atmosphere} atmosphere
 * @param {any} [recipe]   recipes/world/sky.json (the tunables already live in the atmosphere's uniforms)
 */
export function createSkyPass(atmosphere, recipe) {
  void recipe;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'sky',
    reads: ['depth'],
    writes: ['hdr'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const F = GPUShaderStage.FRAGMENT;
      const layout = device.createBindGroupLayout({
        label: 'group2-sky',
        entries: [
          { binding: 0, visibility: F, texture: { sampleType: 'float' } },
          { binding: 1, visibility: F, sampler: { type: 'filtering' } },
          { binding: 2, visibility: F, buffer: { type: 'uniform' } },
          { binding: 3, visibility: F, buffer: { type: 'read-only-storage' } },
        ],
      });
      group = device.createBindGroup({
        label: 'sky-draw',
        layout,
        entries: [
          { binding: 0, resource: atmosphere.skyView.createView() },
          { binding: 1, resource: atmosphere.skySampler },
          { binding: 2, resource: { buffer: atmosphere.uniforms } },
          { binding: 3, resource: { buffer: atmosphere.state } },
        ],
      });
      const module = await makeShaderModule(device, 'sky-draw');
      pipeline = await device.createRenderPipelineAsync({
        label: 'sky',
        layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
      });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const pass = encoder.beginRenderPass({
        label: 'sky',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('sky'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.draw(3);
      pass.end();
    },
  };
}
